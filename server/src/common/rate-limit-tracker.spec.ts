// 요청 한도 추적 키가 사용자별로 분리되고 위조로 우회되지 않는지 검증한다.
import { ExecutionContext } from '@nestjs/common';
import {
  RateLimitTokenVerifier,
  createRateLimitTracker,
} from './rate-limit-tracker';

/** 서명이 유효한 토큰만 payload를 돌려주는 가짜 검증기. 그 외에는 실제 JwtService처럼 throw 한다. */
function verifierFor(
  signed: Record<string, { sub?: unknown }>,
): RateLimitTokenVerifier {
  return {
    verify(token: string) {
      if (!Object.prototype.hasOwnProperty.call(signed, token)) {
        throw new Error('invalid signature');
      }
      return signed[token];
    },
  };
}

function contextFor(className: string, handlerName: string): ExecutionContext {
  return {
    getClass: () => ({ name: className }),
    getHandler: () => ({ name: handlerName }),
  } as unknown as ExecutionContext;
}

const REFRESH = contextFor('AuthController', 'refresh');
const TIME = contextFor('AppController', 'getTime');
const LOGIN = contextFor('AuthController', 'login');
const SIGNUP = contextFor('AuthController', 'signup');

/** 프록시 뒤 100명이 공유하게 되는 그 단일 주소. */
const PROXY_IP = '10.0.0.1';

function reqWith(cookies: Record<string, string>, ip = PROXY_IP) {
  return { ip, headers: {}, cookies };
}

describe('createRateLimitTracker', () => {
  it('같은 IP·다른 사용자의 refresh 요청은 서로 다른 버킷으로 추적된다', () => {
    const tracker = createRateLimitTracker(
      verifierFor({ 'refresh-a': { sub: 7 }, 'refresh-b': { sub: 8 } }),
    );

    const a = tracker(reqWith({ refresh_token: 'refresh-a' }), REFRESH);
    const b = tracker(reqWith({ refresh_token: 'refresh-b' }), REFRESH);

    expect(a).not.toBe(b);
    expect(a).toContain('7');
    expect(b).toContain('8');
    // IP는 키에 남지 않아야 한다 — 남으면 프록시 IP 하나로 다시 묶인다.
    expect(a).not.toContain(PROXY_IP);
    expect(b).not.toContain(PROXY_IP);
  });

  it('같은 사용자의 반복 요청은 같은 버킷으로 계수된다', () => {
    const tracker = createRateLimitTracker(
      verifierFor({ 't1': { sub: 7 }, 't2': { sub: 7 } }),
    );

    expect(tracker(reqWith({ refresh_token: 't1' }), REFRESH)).toBe(
      tracker(reqWith({ refresh_token: 't2' }, '10.0.0.2'), REFRESH),
    );
  });

  it('만료된 access_token 과 유효한 refresh_token 조합에서도 사용자로 식별된다', () => {
    const tracker = createRateLimitTracker({
      verify(token: string, options?: { ignoreExpiration?: boolean }) {
        if (token === 'expired-access') {
          if (!options?.ignoreExpiration) throw new Error('jwt expired');
          return { sub: 11 };
        }
        if (token === 'valid-refresh') return { sub: 11 };
        throw new Error('invalid signature');
      },
    });

    expect(
      tracker(
        reqWith({ access_token: 'expired-access', refresh_token: 'valid-refresh' }),
        REFRESH,
      ),
    ).toContain('11');
  });

  it('access_token 을 가진 /time 요청도 사용자별로 분리된다', () => {
    const tracker = createRateLimitTracker(
      verifierFor({ 'acc-a': { sub: 1 }, 'acc-b': { sub: 2 } }),
    );

    expect(tracker(reqWith({ access_token: 'acc-a' }), TIME)).not.toBe(
      tracker(reqWith({ access_token: 'acc-b' }), TIME),
    );
  });

  it('미인증 요청은 IP 기반으로 추적된다', () => {
    const tracker = createRateLimitTracker(verifierFor({}));

    const anonymous = tracker(reqWith({}, '203.0.113.7'), TIME);
    expect(anonymous).toContain('203.0.113.7');
    expect(tracker(reqWith({}, '203.0.113.9'), TIME)).not.toBe(anonymous);
  });

  it('서명이 위조된 토큰은 sub 를 따르지 않고 IP 버킷으로 떨어진다', () => {
    const tracker = createRateLimitTracker(verifierFor({ real: { sub: 7 } }));

    const forged = tracker(
      reqWith({ refresh_token: 'forged.eyJzdWIiOjk5OTk5fQ.x' }, '203.0.113.7'),
      REFRESH,
    );

    expect(forged).toContain('203.0.113.7');
    expect(forged).not.toContain('99999');
    // 위조 sub 를 바꿔가며 새 버킷을 만들 수 없어야 한다.
    expect(
      tracker(
        reqWith({ refresh_token: 'forged.eyJzdWIiOjEyMzR9.x' }, '203.0.113.7'),
        REFRESH,
      ),
    ).toBe(forged);
  });

  it('X-Forwarded-For 헤더는 추적 키에 직접 영향을 주지 못한다', () => {
    const tracker = createRateLimitTracker(verifierFor({}));

    const spoofed = {
      ip: '203.0.113.7',
      headers: { 'x-forwarded-for': '9.9.9.9', 'x-real-ip': '8.8.8.8' },
      cookies: {},
    };

    const key = tracker(spoofed, TIME);
    expect(key).toContain('203.0.113.7');
    expect(key).not.toContain('9.9.9.9');
    expect(key).not.toContain('8.8.8.8');
  });

  it('login·signup 은 유효한 토큰이 있어도 IP 기반으로 남는다', () => {
    const tracker = createRateLimitTracker(verifierFor({ acc: { sub: 7 } }));

    for (const context of [LOGIN, SIGNUP]) {
      const key = tracker(
        reqWith({ access_token: 'acc' }, '203.0.113.7'),
        context,
      );
      expect(key).toContain('203.0.113.7');
      expect(key).not.toContain('user');
    }
  });

  it('라우트를 알 수 없으면 안전한 쪽(IP)으로 떨어진다', () => {
    const tracker = createRateLimitTracker(verifierFor({ acc: { sub: 7 } }));

    const key = tracker(
      reqWith({ access_token: 'acc' }, '203.0.113.7'),
      undefined as unknown as ExecutionContext,
    );
    expect(key).toContain('203.0.113.7');
  });

  it('req.ip 가 비어 있으면 소켓 주소로 폴백한다', () => {
    const tracker = createRateLimitTracker(verifierFor({}));

    const key = tracker(
      { ip: undefined, headers: {}, cookies: {}, socket: { remoteAddress: '198.51.100.4' } },
      TIME,
    );
    expect(key).toContain('198.51.100.4');
  });
});
