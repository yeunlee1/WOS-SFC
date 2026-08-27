// Express 의 'trust proxy' 홉 수를 환경변수에서 안전하게 해석하고, 그 값이 실제 배포와 맞는지 알려준다.
import type { NextFunction, Request, Response } from 'express';

/**
 * 신뢰할 프록시 홉의 상한.
 * 홉 수가 실제 프록시 단 수보다 크면 클라이언트가 넣은 X-Forwarded-For 항목까지 신뢰하게 되어
 * req.ip 를 마음대로 위조할 수 있다 — 즉 IP 기반 요청 한도가 통째로 무력화된다.
 */
const MAX_HOPS = 8;

/** 부팅 후 X-Forwarded-For 체인을 기록할 표본 건수. 이 수를 채우면 영구히 멈춘다. */
export const TRUST_PROXY_PROBE_SAMPLE_LIMIT = 5;

/** console 과 Nest 의 Logger 가 모두 그대로 들어맞는 최소 로거 형태. */
export interface TrustProxyLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * 십진 정수 문자열만 홉 수로 받는다.
 * 'true'/'-1'/'1.5' 같은 값을 그대로 Express 에 넘기면 전체 신뢰로 해석되거나
 * 예측하기 어려운 동작이 되므로 여기서 걸러 낸다.
 */
function parseHops(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const hops = Number(trimmed);
  if (!Number.isInteger(hops) || hops < 0 || hops > MAX_HOPS) return null;
  return hops;
}

/**
 * 반환값은 항상 정수다. 절대 boolean(true)을 돌려주지 않는다.
 * Express 에 'trust proxy' = true 를 주면 X-Forwarded-For 의 맨 앞 값을 그대로 req.ip 로 쓰므로
 * 누구나 헤더 한 줄로 새 요청 한도 버킷을 무한히 만들어낼 수 있다.
 *
 * 기본값 —
 * - production: 1. 배포 구성은 TLS 를 종단하는 리버스 프록시를 한 단 포함한다. 그 한 단만 신뢰한다.
 * - 그 외: 0. 개발에서는 프록시가 없으므로 X-Forwarded-For 를 전혀 믿지 않는다.
 *
 * 프록시를 2단 이상 두는 배포(예: CDN + 리버스 프록시)는 TRUST_PROXY_HOPS 로 실제 단 수를 지정한다.
 * 실제 단 수보다 크게 잡으면 위조 경로가 열리므로 반드시 실측한 값을 넣어야 한다.
 */
export function resolveTrustProxyHops(env: NodeJS.ProcessEnv): number {
  const fallback = env.NODE_ENV === 'production' ? 1 : 0;
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined) return fallback;

  const hops = parseHops(raw);
  return hops === null ? fallback : hops;
}

/** 부팅 시점에 발견한 trust proxy 설정 문제. */
export type TrustProxyConfigIssue =
  | { kind: 'unset'; hops: number }
  | { kind: 'invalid'; raw: string; hops: number };

/**
 * 설정이 "조용히 기본값으로 넘어간" 상태인지 판정한다.
 * - unset: production 인데 값이 없다. 기본값 1 이 실제 단 수와 같다는 보장이 없다.
 * - invalid: 값을 넣었지만 해석할 수 없어 무시됐다. 운영자는 설정했다고 믿고 있으므로 더 위험하다.
 * 개발 환경의 미설정은 기본값 0(= XFF 전면 불신)이 안전하므로 문제로 보지 않는다.
 */
export function inspectTrustProxyConfig(
  env: NodeJS.ProcessEnv,
): TrustProxyConfigIssue | null {
  const hops = resolveTrustProxyHops(env);
  const raw = env.TRUST_PROXY_HOPS;

  if (raw === undefined) {
    return env.NODE_ENV === 'production' ? { kind: 'unset', hops } : null;
  }

  return parseHops(raw) === null ? { kind: 'invalid', raw, hops } : null;
}

function unsetMessage(hops: number): string {
  return [
    `TRUST_PROXY_HOPS 가 설정되지 않았다. production 기본값 ${hops} 로 동작한다.`,
    '  이 값이 앞단 프록시의 실제 단 수와 다르면 요청 한도가 잘못 걸린다.',
    '  - 실제 단 수가 더 많으면(예: CDN + 리버스 프록시 = 2) 접속자 전원의 IP 가 프록시 주소 하나로 잡혀',
    '    로그인·토큰 갱신 요청 한도를 통째로 공유한다. 한 사람이 한도를 채우면 나머지가 전부 막힌다.',
    '  - 실제 단 수가 더 적으면(예: 프록시 없이 직접 노출) 클라이언트가 X-Forwarded-For 를 위조해',
    '    요청마다 새 IP 버킷을 만든다. 계정 단위 게이트도 "처음 보는 IP"의 첫 시도는 통과시키므로',
    '    로그인 무차별 대입이 사실상 무제한이 된다.',
    '  값을 모르면 부팅 직후 남는 [trust proxy 진단] 로그의 "체인 길이"를 그대로 넣어라.',
  ].join('\n');
}

function invalidMessage(raw: string, hops: number): string {
  return [
    `TRUST_PROXY_HOPS 값 "${raw}" 을(를) 해석할 수 없어 무시했다. 기본값 ${hops} 로 동작한다.`,
    `  0 이상 ${MAX_HOPS} 이하의 십진 정수만 받는다. 설정했다고 믿고 있으면 요청 한도가 조용히 잘못 걸린다.`,
  ].join('\n');
}

/**
 * 설정 문제를 부팅 로그에 남긴다. 문제를 남겼으면 true.
 *
 * 부팅을 거부하지 않고 경고만 하는 이유 —
 * 오설정의 결과는 가볍지 않다. 홉 수가 실제보다 크면 로그인 무차별 대입 한도가 통째로 뚫린다.
 * 그런데도 거부하지 않는 것은, 거부해도 그 구멍이 막히지 않기 때문이다 —
 * 부팅이 막히면 운영자는 실측 없이 아무 값이나 넣게 되고, "미설정"이 "찍은 값"으로 바뀔 뿐이다.
 * 반면 부팅 거부는 컨테이너 재시작 루프가 되어 100명이 쓰는 서비스 전체를 멈춘다.
 * 게다가 배포 구성에 포함된 리버스 프록시는 1단이라 기본값 1 이 그 구성에서는 맞다.
 * 실제로 위험한 상태(설정 홉 수 > 실제 체인)는 아래 createTrustProxyProbe 가
 * 첫 진짜 요청에서 오류 로그로 잡아내고 무엇으로 바꿔야 하는지까지 알려 준다.
 */
export function warnOnTrustProxyConfig(
  env: NodeJS.ProcessEnv,
  logger: TrustProxyLogger = console,
): boolean {
  const issue = inspectTrustProxyConfig(env);
  if (issue === null) return false;

  logger.warn(
    issue.kind === 'unset'
      ? unsetMessage(issue.hops)
      : invalidMessage(issue.raw, issue.hops),
  );
  return true;
}

/** 설정한 홉 수와 실제로 들어온 X-Forwarded-For 체인 길이를 맞춰 본 결과. */
export type TrustProxyChainVerdict = 'ok' | 'too-few-hops' | 'too-many-hops';

/**
 * 클라이언트가 XFF 를 보내지 않는 정상 요청에서는 프록시가 한 단 지날 때마다 항목이 하나씩 붙으므로
 * "체인 길이 == 실제 프록시 단 수" 가 성립한다. 그래서 체인 길이와 홉 수를 그대로 비교한다.
 * 체인 길이는 클라이언트가 항목을 덧붙여 부풀릴 수 있으니, 여러 표본 중 가장 짧은 값이 실제 단 수다.
 *
 * 이 전제가 깨지는 경우 — 프록시가 XFF 를 이어붙이지 않고 덮어쓰면(nginx 로 치면
 * proxy_add_x_forwarded_for 대신 remote_addr) 단 수와 무관하게 체인 길이가 늘 1이라
 * ok 판정이 나와도 실제 클라이언트 IP 는 이미 유실된 상태다. 그때는 어떤 홉 수로도 복구되지 않으므로
 * 프록시 설정을 고쳐야 한다. RFC 7239 의 Forwarded 헤더만 쓰는 프록시도 마찬가지로 여기 잡히지 않는다
 * (다만 그 경우는 체인 길이 0 이라 too-many-hops 로 경고가 뜬다).
 */
export function evaluateTrustProxyChain(
  chainLength: number,
  hops: number,
): TrustProxyChainVerdict {
  if (chainLength === hops) return 'ok';
  return chainLength > hops ? 'too-few-hops' : 'too-many-hops';
}

/** X-Forwarded-For 헤더를 항목 배열로 쪼갠다. 헤더가 여러 번 오면 Node 가 이미 하나로 합쳐 준다. */
function readForwardedChain(header: string | string[] | undefined): string[] {
  if (header === undefined) return [];
  const raw = Array.isArray(header) ? header.join(',') : header;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const bare = address.startsWith('::ffff:')
    ? address.slice('::ffff:'.length)
    : address;
  return bare === '::1' || /^127\./.test(bare);
}

/**
 * 이 요청을 진단 표본으로 쓸지 정한다.
 * XFF 도 없이 루프백에서 들어온 요청은 컨테이너 안에서 도는 헬스체크일 가능성이 높고
 * 프록시 체인에 대해 아무 정보도 주지 않는다. 그런 요청이 표본을 다 먹으면 진단이 무의미해진다.
 * 반대로 루프백이어도 XFF 가 있으면 같은 호스트에 있는 프록시를 거친 진짜 요청이므로 표본으로 쓴다.
 */
export function shouldSampleTrustProxyRequest(
  socketAddress: string | undefined,
  forwardedHeader: string | string[] | undefined,
): boolean {
  if (readForwardedChain(forwardedHeader).length > 0) return true;
  return !isLoopbackAddress(socketAddress);
}

function verdictLine(verdict: TrustProxyChainVerdict, chainLength: number) {
  if (verdict === 'too-few-hops') {
    return [
      '  판정 위험 — 설정 홉 수가 실제 체인보다 작다.',
      '    앞단 프록시 주소가 req.ip 로 잡혀 접속자 전원이 요청 한도를 공유한다.',
      `    표본 여러 건의 체인 길이가 모두 ${chainLength} 이면 TRUST_PROXY_HOPS=${chainLength} 가 맞다.`,
      '    (체인 길이는 클라이언트가 부풀릴 수 있으니 표본 중 가장 짧은 값을 쓴다.)',
    ].join('\n');
  }

  if (verdict === 'too-many-hops') {
    return [
      '  판정 위험 — 설정 홉 수가 실제 체인보다 크다.',
      '    req.ip 가 클라이언트가 직접 넣은 항목에서 나오므로 요청 한도 위조가 가능하다.',
      `    TRUST_PROXY_HOPS=${chainLength} 로 낮춰라.`,
    ].join('\n');
  }

  return '  판정 정상 — 체인 길이와 설정 홉 수가 같다.';
}

export interface TrustProxyProbeOptions {
  /** 이 프로세스가 실제로 Express 에 넣은 홉 수. */
  hops: number;
  /** 표본 건수. 기본값은 TRUST_PROXY_PROBE_SAMPLE_LIMIT. */
  limit?: number;
  logger?: TrustProxyLogger;
}

/**
 * 부팅 후 첫 몇 건의 요청만 X-Forwarded-For 체인과 그때의 req.ip 를 서버 로그에 남기고 영구히 멈춘다.
 *
 * 접근 제어 — 진단 결과를 HTTP 응답으로 절대 내보내지 않는다. 관리자 전용 엔드포인트를 두면
 * 인증 배선을 새로 만들어야 하고 내부 프록시 주소가 새어 나갈 경로가 하나 늘어난다.
 * 서버 로그는 이미 컨테이너 로그를 읽을 수 있는 운영자에게만 보이므로 추가 노출이 없다.
 *
 * 부하 — 표본을 다 쓰면 이후 모든 요청에서 정수 비교 한 번만 하고 next() 로 넘어간다.
 * 100명이 붙어도 로그가 늘지 않고, 로그가 실패해도 요청 처리를 막지 않는다.
 */
export function createTrustProxyProbe(options: TrustProxyProbeOptions) {
  const limit = options.limit ?? TRUST_PROXY_PROBE_SAMPLE_LIMIT;
  const logger = options.logger ?? console;
  const hops = options.hops;
  let taken = 0;

  return function trustProxyProbe(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    if (taken < limit) {
      try {
        const forwarded = req.headers['x-forwarded-for'];
        const socketAddress = req.socket?.remoteAddress;

        if (shouldSampleTrustProxyRequest(socketAddress, forwarded)) {
          taken += 1;
          const chain = readForwardedChain(forwarded);
          const verdict = evaluateTrustProxyChain(chain.length, hops);
          const forwardedText =
            chain.length > 0 ? `"${chain.join(', ')}"` : '(없음)';
          const tail =
            taken === limit
              ? '\n  표본을 다 채웠다. 이후로는 진단 로그를 남기지 않는다. 다시 재려면 서버를 재시작해라.'
              : '';
          const line =
            `[trust proxy 진단 ${taken}/${limit}] ${req.method} ${req.path}` +
            ` · 소켓 ${socketAddress ?? '(알 수 없음)'}` +
            ` · X-Forwarded-For ${forwardedText}` +
            ` · 체인 길이 ${chain.length}` +
            ` · req.ip ${req.ip ?? '(알 수 없음)'}` +
            ` · 현재 TRUST_PROXY_HOPS=${hops}\n` +
            verdictLine(verdict, chain.length) +
            tail;

          if (verdict === 'ok') {
            logger.log(line);
          } else {
            logger.error(line);
          }
        }
      } catch {
        // 진단은 어떤 경우에도 요청 처리를 막지 않는다.
      }
    }

    next();
  };
}
