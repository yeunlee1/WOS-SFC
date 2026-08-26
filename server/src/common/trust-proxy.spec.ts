// trust proxy 홉 수 결정과 X-Forwarded-For 위조 방어를 검증한다.
import express from 'express';
import request from 'supertest';
import { resolveTrustProxyHops } from './trust-proxy';

function probeApp(trustProxy: number | boolean) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/probe', (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

describe('resolveTrustProxyHops', () => {
  it('비프로덕션 기본값은 0 — 프록시가 없는 개발 환경에서 XFF를 아예 믿지 않는다', () => {
    expect(resolveTrustProxyHops({})).toBe(0);
    expect(resolveTrustProxyHops({ NODE_ENV: 'development' })).toBe(0);
  });

  it('프로덕션 기본값은 1 — TLS 종단 프록시 1홉만 신뢰한다', () => {
    expect(resolveTrustProxyHops({ NODE_ENV: 'production' })).toBe(1);
  });

  it('TRUST_PROXY_HOPS 로 홉 수를 조정할 수 있다', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '0' })).toBe(0);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(
      resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '3' }),
    ).toBe(3);
  });

  it('전체 신뢰(true)나 음수·비정수 같은 잘못된 값은 절대 받아들이지 않고 기본값으로 되돌린다', () => {
    for (const bad of ['true', 'TRUE', '-1', 'abc', '1.5', '', 'Infinity']) {
      const value = resolveTrustProxyHops({
        NODE_ENV: 'production',
        TRUST_PROXY_HOPS: bad,
      });
      expect(typeof value).toBe('number');
      expect(value).toBe(1);
    }
  });

  it('홉 수는 상한을 넘길 수 없다 — 사실상 전체 신뢰가 되는 값을 막는다', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '999' })).toBe(0);
  });

  it('프록시 1홉 설정에서 클라이언트가 위조한 X-Forwarded-For 앞부분은 무시된다', async () => {
    const hops = resolveTrustProxyHops({ NODE_ENV: 'production' });
    const res = await request(probeApp(hops))
      .get('/probe')
      // 프록시가 실제 클라이언트 주소(203.0.113.7)를 맨 뒤에 덧붙인 상태.
      // 앞의 9.9.9.9 는 클라이언트가 직접 넣은 위조 값이다.
      .set('X-Forwarded-For', '9.9.9.9, 203.0.113.7');

    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('위조 항목을 여러 개 넣어도 신뢰 홉 수를 넘어 거슬러 올라가지 못한다', async () => {
    const hops = resolveTrustProxyHops({ NODE_ENV: 'production' });
    const res = await request(probeApp(hops))
      .get('/probe')
      .set('X-Forwarded-For', '1.1.1.1, 2.2.2.2, 203.0.113.7');

    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('대조군 — trust proxy 를 true 로 두면 위조 IP가 그대로 req.ip 가 된다', async () => {
    const res = await request(probeApp(true))
      .get('/probe')
      .set('X-Forwarded-For', '9.9.9.9, 203.0.113.7');

    // 이 동작이 바로 우리가 피해야 하는 한도 우회 경로다.
    expect(res.body.ip).toBe('9.9.9.9');
  });
});
