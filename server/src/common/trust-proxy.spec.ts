// trust proxy 홉 수 결정과 X-Forwarded-For 위조 방어를 검증한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get, Req } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import express from 'express';
import type { Request } from 'express';
import request from 'supertest';
import {
  TRUST_PROXY_PROBE_SAMPLE_LIMIT,
  createTrustProxyProbe,
  evaluateTrustProxyChain,
  inspectTrustProxyConfig,
  resolveTrustProxyHops,
  shouldSampleTrustProxyRequest,
  warnOnTrustProxyConfig,
} from './trust-proxy';

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

// ─── express 정수 홉 수 해석 계약 ───
// 아래 두 건은 새 구현의 계약이 아니라 express 5 의 동작을 못 박아 두는 회귀 핀이다.
// "홉 수가 실제 프록시 단 수와 어긋나면 위험하다"는 전제 자체가 참인지 확인한다.
describe('실제 프록시 단 수와 홉 수가 어긋날 때의 결과', () => {
  it('프록시가 하나도 없는데 hops=1 이면 클라이언트가 req.ip 를 통째로 위조한다', async () => {
    // supertest 는 프록시 없이 직접 연결하므로 이것이 곧 "프록시 0단" 상황이다.
    const res = await request(probeApp(1))
      .get('/probe')
      .set('X-Forwarded-For', '9.9.9.9');

    expect((res.body as { ip: string }).ip).toBe('9.9.9.9');
  });

  it('실제 단 수보다 홉 수를 크게 잡으면 위조 항목이 req.ip 가 된다', async () => {
    // 프록시 1단(=203.0.113.7 을 덧붙인 상태)인데 hops 를 2로 잡은 배포.
    const res = await request(probeApp(2))
      .get('/probe')
      .set('X-Forwarded-For', '9.9.9.9, 203.0.113.7');

    expect((res.body as { ip: string }).ip).toBe('9.9.9.9');
  });
});

// ─── 부팅 시 설정 점검 ───
function fakeLogger() {
  const warns: string[] = [];
  const errors: string[] = [];
  const logs: string[] = [];
  return {
    warn: (message: string) => warns.push(message),
    error: (message: string) => errors.push(message),
    log: (message: string) => logs.push(message),
    warns,
    errors,
    logs,
    all: () => [...logs, ...warns, ...errors],
  };
}

describe('inspectTrustProxyConfig', () => {
  it('production 인데 TRUST_PROXY_HOPS 가 없으면 미설정으로 판정한다', () => {
    const issue = inspectTrustProxyConfig({ NODE_ENV: 'production' });
    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe('unset');
    expect(issue?.hops).toBe(1);
  });

  it('값을 제대로 넣었으면 아무 문제도 보고하지 않는다', () => {
    expect(
      inspectTrustProxyConfig({
        NODE_ENV: 'production',
        TRUST_PROXY_HOPS: '2',
      }),
    ).toBeNull();
  });

  it('개발 환경의 미설정은 문제가 아니다 — 기본값 0 이 안전하다', () => {
    expect(inspectTrustProxyConfig({})).toBeNull();
    expect(inspectTrustProxyConfig({ NODE_ENV: 'development' })).toBeNull();
  });

  it('값이 잘못돼 조용히 기본값으로 되돌아가는 경우를 따로 판정한다', () => {
    const issue = inspectTrustProxyConfig({
      NODE_ENV: 'production',
      TRUST_PROXY_HOPS: 'true',
    });
    expect(issue?.kind).toBe('invalid');
    expect(issue?.hops).toBe(1);
  });

  it('개발 환경이어도 잘못된 값은 문제로 판정한다', () => {
    expect(inspectTrustProxyConfig({ TRUST_PROXY_HOPS: '99' })?.kind).toBe(
      'invalid',
    );
  });
});

describe('warnOnTrustProxyConfig', () => {
  it('production 미설정이면 무엇이 위험한지 적은 경고를 한 건 남긴다', () => {
    const logger = fakeLogger();
    const warned = warnOnTrustProxyConfig({ NODE_ENV: 'production' }, logger);

    expect(warned).toBe(true);
    expect(logger.warns).toHaveLength(1);
    const message = logger.warns[0];
    expect(message).toContain('TRUST_PROXY_HOPS');
    expect(message).toContain('요청 한도');
    expect(message).toMatch(/기본값\s*1/);
  });

  it('부팅을 막지 않는다 — 경고만 남기고 예외를 던지지 않는다', () => {
    const logger = fakeLogger();
    expect(() =>
      warnOnTrustProxyConfig({ NODE_ENV: 'production' }, logger),
    ).not.toThrow();
  });

  it('production 에서 값을 넣었으면 경고하지 않는다', () => {
    const logger = fakeLogger();
    const warned = warnOnTrustProxyConfig(
      { NODE_ENV: 'production', TRUST_PROXY_HOPS: '1' },
      logger,
    );

    expect(warned).toBe(false);
    expect(logger.all()).toHaveLength(0);
  });

  it('개발 환경의 미설정은 경고하지 않는다', () => {
    const logger = fakeLogger();
    expect(warnOnTrustProxyConfig({ NODE_ENV: 'development' }, logger)).toBe(
      false,
    );
    expect(logger.all()).toHaveLength(0);
  });

  it('잘못된 값을 넣었으면 그 값을 그대로 보여 주며 경고한다', () => {
    const logger = fakeLogger();
    const warned = warnOnTrustProxyConfig(
      { NODE_ENV: 'production', TRUST_PROXY_HOPS: 'true' },
      logger,
    );

    expect(warned).toBe(true);
    expect(logger.warns[0]).toContain('true');
    expect(logger.warns[0]).toContain('TRUST_PROXY_HOPS');
  });
});

// ─── 설정과 실제 체인의 불일치 판정 ───
describe('evaluateTrustProxyChain', () => {
  it('체인 길이와 홉 수가 같으면 ok', () => {
    expect(evaluateTrustProxyChain(0, 0)).toBe('ok');
    expect(evaluateTrustProxyChain(1, 1)).toBe('ok');
    expect(evaluateTrustProxyChain(3, 3)).toBe('ok');
  });

  it('체인이 홉 수보다 짧으면 too-many-hops — req.ip 가 클라이언트 손에 넘어간다', () => {
    expect(evaluateTrustProxyChain(0, 1)).toBe('too-many-hops');
    expect(evaluateTrustProxyChain(1, 2)).toBe('too-many-hops');
  });

  it('체인이 홉 수보다 길면 too-few-hops — 모두가 프록시 IP 하나를 공유한다', () => {
    expect(evaluateTrustProxyChain(2, 1)).toBe('too-few-hops');
    expect(evaluateTrustProxyChain(3, 0)).toBe('too-few-hops');
  });
});

describe('shouldSampleTrustProxyRequest', () => {
  it('XFF 도 없이 루프백에서 들어온 요청은 표본에서 뺀다 — 헬스체크가 표본을 다 먹는다', () => {
    expect(shouldSampleTrustProxyRequest('127.0.0.1', undefined)).toBe(false);
    expect(shouldSampleTrustProxyRequest('::1', undefined)).toBe(false);
    expect(shouldSampleTrustProxyRequest('::ffff:127.0.0.1', undefined)).toBe(
      false,
    );
    expect(shouldSampleTrustProxyRequest('127.9.9.9', '')).toBe(false);
  });

  it('루프백이어도 XFF 가 있으면 표본으로 쓴다 — 같은 호스트의 프록시일 수 있다', () => {
    expect(shouldSampleTrustProxyRequest('127.0.0.1', '203.0.113.7')).toBe(
      true,
    );
  });

  it('루프백이 아니면 XFF 가 없어도 표본으로 쓴다 — 프록시 0단이라는 정보다', () => {
    expect(shouldSampleTrustProxyRequest('172.18.0.5', undefined)).toBe(true);
    expect(shouldSampleTrustProxyRequest(undefined, undefined)).toBe(true);
  });
});

// ─── 진단 미들웨어 ───
function probedApp(
  hops: number,
  logger: {
    log(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  },
  limit?: number,
) {
  const app = express();
  app.set('trust proxy', hops);
  app.use(createTrustProxyProbe({ hops, logger, limit }));
  app.get('/probe', (req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('createTrustProxyProbe', () => {
  it('기본 표본 상한은 5건이다', () => {
    expect(TRUST_PROXY_PROBE_SAMPLE_LIMIT).toBe(5);
  });

  it('표본 상한을 넘기면 로그를 완전히 멈춘다', async () => {
    const logger = fakeLogger();
    const app = probedApp(1, logger, 3);

    for (let i = 0; i < 12; i += 1) {
      await request(app).get('/probe').set('X-Forwarded-For', '203.0.113.7');
    }

    expect(logger.all()).toHaveLength(3);
  });

  it('표본 로그에 XFF 원문·req.ip·설정 홉 수·체인 길이가 함께 남는다', async () => {
    const logger = fakeLogger();
    await request(probedApp(1, logger))
      .get('/probe')
      .set('X-Forwarded-For', '9.9.9.9, 203.0.113.7');

    const line = logger.all()[0];
    expect(line).toContain('9.9.9.9, 203.0.113.7');
    // XFF 원문에도 같은 주소가 들어 있으므로 req.ip 는 라벨까지 붙여 확인한다.
    expect(line).toMatch(/req\.ip 203\.0\.113\.7/);
    expect(line).toContain('TRUST_PROXY_HOPS');
    expect(line).toMatch(/체인 길이[^0-9]*2/);
  });

  it('체인이 홉 수보다 길면 오류 수준으로 남긴다', async () => {
    const logger = fakeLogger();
    await request(probedApp(1, logger))
      .get('/probe')
      .set('X-Forwarded-For', '9.9.9.9, 203.0.113.7');

    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('공유');
  });

  it('체인이 홉 수보다 짧으면 위조 위험을 오류 수준으로 남긴다', async () => {
    const logger = fakeLogger();
    await request(probedApp(2, logger))
      .get('/probe')
      .set('X-Forwarded-For', '203.0.113.7');

    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('위조');
  });

  it('체인 길이와 홉 수가 맞으면 오류가 아니라 정보 로그로 남긴다', async () => {
    const logger = fakeLogger();
    await request(probedApp(1, logger))
      .get('/probe')
      .set('X-Forwarded-For', '203.0.113.7');

    expect(logger.errors).toHaveLength(0);
    expect(logger.logs).toHaveLength(1);
  });

  it('XFF 없는 루프백 요청은 표본을 소모하지 않는다', async () => {
    const logger = fakeLogger();
    const app = probedApp(1, logger, 2);

    // supertest 는 127.0.0.1 에서 붙으므로 헬스체크와 같은 모양이다.
    await request(app).get('/probe');
    await request(app).get('/probe');
    expect(logger.all()).toHaveLength(0);

    await request(app).get('/probe').set('X-Forwarded-For', '203.0.113.7');
    expect(logger.all()).toHaveLength(1);
  });

  it('진단 정보는 응답 본문이나 헤더로 새어 나가지 않는다 — 서버 로그에만 남는다', async () => {
    const logger = fakeLogger();
    const res = await request(probedApp(1, logger))
      .get('/probe')
      .set('X-Forwarded-For', '10.9.8.7, 203.0.113.7');

    expect(res.body).toEqual({ ok: true });
    const exposed = `${JSON.stringify(res.headers)}${res.text}`;
    expect(exposed).not.toContain('10.9.8.7');
    expect(exposed).not.toContain('TRUST_PROXY_HOPS');
    expect(exposed).not.toContain('체인 길이');
    // 같은 정보가 로그에는 남아 있어야 위 단언이 의미를 갖는다.
    expect(logger.all()[0]).toContain('10.9.8.7');
  });

  it('로거가 예외를 던져도 요청 처리를 깨뜨리지 않는다', async () => {
    const throwing = {
      log: () => {
        throw new Error('logger down');
      },
      warn: () => {
        throw new Error('logger down');
      },
      error: () => {
        throw new Error('logger down');
      },
    };

    const res = await request(probedApp(1, throwing))
      .get('/probe')
      .set('X-Forwarded-For', '203.0.113.7');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

// ─── 실제 Nest 앱에서의 동작 ───
// 위 케이스들은 순수 express 앱을 쓴다. main.ts 는 NestExpressApplication 이므로
// app.set('trust proxy') 와 app.use() 가 같은 express 인스턴스에 닿는지 따로 확인한다.
@Controller('probe')
class ProbeController {
  @Get()
  probe(@Req() req: Request) {
    return { ip: req.ip };
  }
}

describe('NestExpressApplication 에 붙였을 때', () => {
  let app: NestExpressApplication;
  const logger = fakeLogger();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // main.ts 와 같은 순서로 배선한다.
    app.set('trust proxy', 1);
    app.use(createTrustProxyProbe({ hops: 1, logger }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('진단이 Nest 요청에서도 req.ip 와 체인을 읽는다', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set('X-Forwarded-For', '9.9.9.9, 203.0.113.7');

    // trust proxy 가 express 인스턴스에 실제로 걸렸다면 위조한 앞부분은 버려진다.
    expect((res.body as { ip: string }).ip).toBe('203.0.113.7');
    expect(logger.all()).toHaveLength(1);
    expect(logger.all()[0]).toMatch(/req\.ip 203\.0\.113\.7/);
    expect(logger.all()[0]).toMatch(/체인 길이[^0-9]*2/);
  });
});

// 아래는 소스 문자열 검사다. main.ts 가 배선했는지의 순서만 보장하고
// 런타임 동작은 보장하지 못한다 — 동작 보장은 위 supertest 케이스가 한다.
describe('main.ts 배선', () => {
  const source = () => readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');

  it('부팅 시 설정 경고를 호출한다', () => {
    expect(source()).toContain('warnOnTrustProxyConfig(');
  });

  it('trust proxy 를 설정한 뒤에 진단 미들웨어를 붙인다', () => {
    const text = source();
    const setIndex = text.indexOf("app.set('trust proxy'");
    const probeIndex = text.indexOf('createTrustProxyProbe(');

    expect(setIndex).toBeGreaterThan(-1);
    expect(probeIndex).toBeGreaterThan(setIndex);
  });

  it('홉 수를 한 번만 계산해 설정과 진단이 같은 값을 쓴다', () => {
    const text = source();
    const calls = text.match(/resolveTrustProxyHops\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(text).toMatch(/createTrustProxyProbe\(\s*\{[^}]*hops/);
  });
});
