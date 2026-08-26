// 요청 한도(rate limit) 추적 키를 결정한다 — 인증된 요청은 사용자 ID, 그 외에는 클라이언트 IP.
import { ExecutionContext } from '@nestjs/common';

/** JwtService 가 그대로 들어맞는 최소 인터페이스. 테스트에서 가짜 검증기를 넣기 위해 분리했다. */
export interface RateLimitTokenVerifier {
  verify(
    token: string,
    options?: { ignoreExpiration?: boolean },
  ): { sub?: unknown };
}

/**
 * 인증 전 라우트 — 여기서는 사용자 식별자를 쓸 수 없고, 요청자가 제시하는 토큰을 신원으로 인정하면
 * 계정 하나로 IP 한도를 우회하는 길이 열린다. 그래서 항상 IP 로만 추적한다.
 */
const IP_ONLY_ROUTES = new Set(['AuthController.login', 'AuthController.signup']);

function isIpOnlyRoute(context: ExecutionContext | undefined): boolean {
  const className = context?.getClass?.()?.name;
  const handlerName = context?.getHandler?.()?.name;
  // 라우트를 알 수 없으면 안전한 쪽(IP)으로 떨어진다.
  if (!className || !handlerName) return true;
  return IP_ONLY_ROUTES.has(`${className}.${handlerName}`);
}

/** Express 가 계산한 req.ip 만 쓴다. 헤더를 직접 읽으면 trust proxy 설정을 우회해 위조를 받아들이게 된다. */
export function resolveClientIp(req: Record<string, any>): string {
  const candidate =
    req?.ip ?? req?.socket?.remoteAddress ?? req?.connection?.remoteAddress;
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : 'unknown';
}

function readVerifiedUserId(
  req: Record<string, any>,
  verifier: RateLimitTokenVerifier,
): string | null {
  // 인증 가드를 이미 통과한 요청은 서버가 채운 값을 그대로 쓴다.
  const injected = req?.user?.id;
  if (typeof injected === 'number' || typeof injected === 'string') {
    return String(injected);
  }

  const cookies = req?.cookies ?? {};
  for (const token of [cookies.access_token, cookies.refresh_token]) {
    if (typeof token !== 'string' || token.length === 0) continue;
    try {
      // 서명 검증은 생략할 수 없다. payload 를 그냥 디코드하면 클라이언트가 sub 를 바꿔가며
      // 새 버킷을 무한히 만들어 한도를 완전히 우회한다.
      // 만료는 무시한다 — 만료된 액세스 토큰으로 /auth/refresh 를 부르는 것이 정상 경로이고,
      // 여기서 필요한 것은 권한이 아니라 "누구인지"뿐이다.
      const payload = verifier.verify(token, { ignoreExpiration: true });
      const sub = payload?.sub;
      if (typeof sub === 'number' && Number.isFinite(sub)) return String(sub);
      if (typeof sub === 'string' && sub.length > 0) return sub;
    } catch {
      // 위조·손상·서명 불일치 — 다음 후보 토큰이나 IP 로 폴백한다.
    }
  }
  return null;
}

/**
 * @nestjs/throttler 의 getTracker 로 넘길 함수를 만든다.
 *
 * 기본 추적자는 req.ip 하나뿐이라, TLS 종단 프록시 뒤에서는 동시 접속자 전원이 같은 버킷을 공유한다.
 * (액세스 토큰 수명 1시간 → 작전 준비 시간대에 로그인한 인원의 토큰이 한 시간 뒤 몇 분 안에 몰려 만료되고,
 *  /auth/refresh 한도를 넘긴 인원이 429 를 받아 작전 도중 강제 로그아웃된다.)
 * 인증된 요청을 사용자 단위로 쪼개면 이 경합이 사라진다.
 */
export function createRateLimitTracker(verifier: RateLimitTokenVerifier) {
  return (req: Record<string, any>, context: ExecutionContext): string => {
    if (!isIpOnlyRoute(context)) {
      const userId = readVerifiedUserId(req, verifier);
      if (userId) return `user:${userId}`;
    }
    return `ip:${resolveClientIp(req)}`;
  };
}
