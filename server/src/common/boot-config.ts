// 부팅 시 운영 필수 설정을 검증하고 WEB_ORIGIN 을 origin 형식으로 정규화한다.
export interface BootLogger {
  warn(message: string): void;
}

export const DEV_WEB_ORIGIN = 'http://localhost:5173';
export const MIN_JWT_SECRET_LENGTH = 32;

/**
 * WEB_ORIGIN 을 `스킴://호스트[:포트]` 로 정규화한다. 끝 슬래시와 경로는 버린다.
 * CORS 와 소켓 핸드셰이크가 이 값과 브라우저 Origin 을 글자 단위로 비교하므로,
 * 끝 슬래시 하나가 실시간 기능 전체를 조용히 끊는다.
 */
export function resolveWebOrigin(
  env: NodeJS.ProcessEnv,
  logger: BootLogger,
): string {
  const isProduction = env.NODE_ENV === 'production';
  const raw = (env.WEB_ORIGIN ?? '').trim();
  if (!raw) {
    if (isProduction) {
      throw new Error('WEB_ORIGIN 환경변수가 production에서 필수입니다');
    }
    return DEV_WEB_ORIGIN;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`WEB_ORIGIN 이 URL 형식이 아닙니다: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`WEB_ORIGIN 은 http 또는 https 로 시작해야 합니다: ${raw}`);
  }
  const origin = url.origin;
  if (origin !== raw) {
    logger.warn(
      `WEB_ORIGIN 을 ${raw} → ${origin} 으로 정규화했다 (경로·끝 슬래시 제거)`,
    );
  }
  if (
    isProduction &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  ) {
    logger.warn(
      `WEB_ORIGIN 이 ${origin} 이다 — .env.example 의 자리표시자가 그대로 들어온 것 같다. ` +
        '브라우저가 실제로 여는 주소로 바꾸지 않으면 다른 origin 의 소켓 연결이 거부된다',
    );
  }
  return origin;
}

/** production 에서 비어 있으면 안 되는 비밀값. 부팅 전에 부르고, 걸리면 기동을 거부한다. */
export function assertProductionSecrets(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return;
  const missing = ['JWT_SECRET', 'SERVER_CODE'].filter(
    (key) => !(env[key] ?? '').trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `production 에서 필수인 환경변수가 비어 있습니다: ${missing.join(', ')}`,
    );
  }
  if ((env.JWT_SECRET as string).length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET 은 ${MIN_JWT_SECRET_LENGTH}자 이상이어야 합니다 (예: openssl rand -hex 32)`,
    );
  }
}
