// 부팅 시 WEB_ORIGIN 정규화와 운영 비밀값 검증 규칙을 검증한다.
import { assertProductionSecrets, resolveWebOrigin } from './boot-config';

const silent = { warn: jest.fn() };

describe('resolveWebOrigin', () => {
  beforeEach(() => silent.warn.mockClear());

  it('끝 슬래시와 경로를 버리고 origin 만 남기며 경고를 남긴다', () => {
    expect(resolveWebOrigin({ WEB_ORIGIN: 'https://1.2.3.4.sslip.io/' }, silent)).toBe(
      'https://1.2.3.4.sslip.io',
    );
    expect(silent.warn).toHaveBeenCalledTimes(1);
  });

  it('포트가 있으면 유지한다', () => {
    expect(resolveWebOrigin({ WEB_ORIGIN: 'http://1.2.3.4:8080' }, silent)).toBe('http://1.2.3.4:8080');
    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('production 에서 비어 있으면 던진다', () => {
    expect(() => resolveWebOrigin({ NODE_ENV: 'production' }, silent)).toThrow('WEB_ORIGIN');
  });

  it('개발에서 비어 있으면 localhost:5173 을 쓴다', () => {
    expect(resolveWebOrigin({}, silent)).toBe('http://localhost:5173');
  });

  it('URL 이 아니거나 http(s) 가 아니면 던진다', () => {
    expect(() => resolveWebOrigin({ WEB_ORIGIN: 'sfc.example.com' }, silent)).toThrow();
    expect(() => resolveWebOrigin({ WEB_ORIGIN: 'ftp://sfc.example.com' }, silent)).toThrow();
  });

  it('production 에서 localhost 면 자리표시자 경고를 남긴다', () => {
    resolveWebOrigin({ NODE_ENV: 'production', WEB_ORIGIN: 'http://localhost:5173' }, silent);
    expect(silent.warn.mock.calls.some(([message]) => String(message).includes('자리표시자'))).toBe(true);
  });
});

describe('assertProductionSecrets', () => {
  const good = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), SERVER_CODE: 'code' };

  it('충분한 값이면 통과한다', () => {
    expect(() => assertProductionSecrets(good)).not.toThrow();
  });

  it('SERVER_CODE 가 비면 던진다', () => {
    expect(() => assertProductionSecrets({ ...good, SERVER_CODE: '  ' })).toThrow('SERVER_CODE');
  });

  it('JWT_SECRET 이 32자 미만이면 던진다', () => {
    expect(() => assertProductionSecrets({ ...good, JWT_SECRET: 'short' })).toThrow('32');
  });

  it('개발에서는 검사하지 않는다', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'development' })).not.toThrow();
  });
});
