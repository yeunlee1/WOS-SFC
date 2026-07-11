// Socket.IO CORS가 ConfigModule 로드 뒤의 WEB_ORIGIN을 요청 시점에 반영하는지 검증한다.
import { allowConfiguredWebOrigin } from './socket-cors.options';

describe('allowConfiguredWebOrigin', () => {
  const originalOrigin = process.env.WEB_ORIGIN;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = originalOrigin;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('호출 시점의 WEB_ORIGIN과 일치하는 요청만 허용한다', () => {
    process.env.WEB_ORIGIN = 'https://wos.example.com';
    const allowed = jest.fn();
    const denied = jest.fn();

    allowConfiguredWebOrigin('https://wos.example.com', allowed);
    allowConfiguredWebOrigin('https://evil.example.com', denied);

    expect(allowed).toHaveBeenCalledWith(null, true);
    expect(denied).toHaveBeenCalledWith(null, false);
  });

  it('production에서 WEB_ORIGIN이 없으면 요청을 거부한다', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.WEB_ORIGIN;
    const callback = jest.fn();

    allowConfiguredWebOrigin('https://wos.example.com', callback);

    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
