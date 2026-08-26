// Express 의 'trust proxy' 홉 수를 환경변수에서 안전하게 해석한다.

/**
 * 신뢰할 프록시 홉의 상한.
 * 홉 수가 실제 프록시 단 수보다 크면 클라이언트가 넣은 X-Forwarded-For 항목까지 신뢰하게 되어
 * req.ip 를 마음대로 위조할 수 있다 — 즉 IP 기반 요청 한도가 통째로 무력화된다.
 */
const MAX_HOPS = 8;

/**
 * 반환값은 항상 정수다. 절대 boolean(true)을 돌려주지 않는다.
 * Express 에 'trust proxy' = true 를 주면 X-Forwarded-For 의 맨 앞 값을 그대로 req.ip 로 쓰므로
 * 누구나 헤더 한 줄로 새 요청 한도 버킷을 무한히 만들어낼 수 있다.
 *
 * 기본값 —
 * - production: 1. 이 앱은 쿠키가 secure:true 인데 main.ts 는 평문 listen 이라
 *   앞단에 TLS 를 종단하는 프록시가 반드시 한 단 존재한다. 그 한 단만 신뢰한다.
 * - 그 외: 0. 개발에서는 프록시가 없으므로 X-Forwarded-For 를 전혀 믿지 않는다.
 *
 * 프록시를 2단 이상 두는 배포(예: CDN + 리버스 프록시)는 TRUST_PROXY_HOPS 로 실제 단 수를 지정한다.
 * 실제 단 수보다 크게 잡으면 위조 경로가 열리므로 반드시 실측한 값을 넣어야 한다.
 */
export function resolveTrustProxyHops(env: NodeJS.ProcessEnv): number {
  const fallback = env.NODE_ENV === 'production' ? 1 : 0;
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined) return fallback;

  // 십진 정수 문자열만 받는다. 'true'/'-1'/'1.5' 같은 값을 그대로 Express 에 넘기면
  // 전체 신뢰로 해석되거나 예측하기 어려운 동작이 되므로 조용히 기본값으로 되돌린다.
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;

  const hops = Number(trimmed);
  if (!Number.isInteger(hops) || hops < 0 || hops > MAX_HOPS) return fallback;
  return hops;
}
