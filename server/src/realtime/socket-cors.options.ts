// Socket.IO 요청 시점에 허용 웹 origin을 읽는 공통 CORS 옵션을 제공한다.
type OriginCallback = (error: Error | null, allow?: boolean) => void;

export function allowConfiguredWebOrigin(
  origin: string | undefined,
  callback: OriginCallback,
): void {
  const allowedOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';
  if (process.env.NODE_ENV === 'production' && !process.env.WEB_ORIGIN) {
    callback(new Error('WEB_ORIGIN 환경변수가 production에서 필수입니다.'));
    return;
  }
  callback(null, origin === undefined || origin === allowedOrigin);
}

export const SOCKET_CORS_OPTIONS = {
  origin: allowConfiguredWebOrigin,
  credentials: true,
};
