// 로그인·가입 라우트의 IP 한도와 계정 단위 시도 제한이 실제 요청 흐름에서 동작하는지 검증한다.
import {
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { accountLoginThrottle } from '../common/account-login-throttle';
import { createRateLimitTracker } from '../common/rate-limit-tracker';

const SECRET = 'auth-controller-throttle-test-secret';

/** 실제 AuthService 와 같은 계약: 존재하지 않는 계정과 비밀번호 불일치가 완전히 같은 예외를 던진다. */
const authServiceMock = {
  login: jest.fn(async (dto: { nickname: string; password: string }) => {
    if (dto.nickname === 'alice' && dto.password === 'correct-pass') {
      return {
        accessToken: 'a',
        refreshToken: 'r',
        user: { id: 1, nickname: 'alice' },
      };
    }
    throw new UnauthorizedException('닉네임 또는 비밀번호가 올바르지 않습니다');
  }),
  signup: jest.fn(async () => {
    throw new ForbiddenException('가입 코드가 올바르지 않습니다');
  }),
};

describe('AuthController 로그인 한도', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: SECRET }),
        ThrottlerModule.forRootAsync({
          imports: [JwtModule.register({ secret: SECRET })],
          inject: [JwtService],
          useFactory: (jwtService: JwtService) => ({
            throttlers: [{ name: 'default', ttl: 60000, limit: 60 }],
            getTracker: createRateLimitTracker(jwtService),
          }),
        }),
      ],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compile();

    app = moduleRef.createNestApplication();
    // main.ts 와 같은 순서로 배선한다 — 가드는 body parser 뒤, ValidationPipe 앞에서 돈다.
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    app.use(cookieParser());
    app.use(express.json({ limit: '50kb' }));
    app.use(express.urlencoded({ extended: true, limit: '50kb' }));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    accountLoginThrottle.reset();
    authServiceMock.login.mockClear();
  });

  function login(nickname: unknown, ip: string, password = 'wrong-pass') {
    return request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ nickname, password });
  }

  it('같은 IP 라도 계정이 다르면 따로 센다', async () => {
    const ip = '203.0.113.10';

    let blockedAt = 0;
    for (let i = 1; i <= 10; i += 1) {
      const res = await login('victim', ip);
      if (res.status === 429) {
        blockedAt = i;
        break;
      }
    }
    expect(blockedAt).toBeGreaterThan(0); // 계정 단위로 언젠가는 막혀야 한다

    // 같은 IP 의 다른 계정은 아직 막히면 안 된다 (IP 한도는 아직 여유가 있다).
    expect((await login('another-account', ip)).status).toBe(401);
  });

  it('IP 를 갈아타도 같은 계정의 시도는 합산된다', async () => {
    const account = 'victim';

    // 매번 다른 IP 에서 한 번씩 두드린다 — IP 한도로는 절대 걸리지 않는 패턴이다.
    // 계정 카운터가 없다면 이 20회는 영원히 통과한다.
    for (let i = 0; i < 20; i += 1) {
      expect((await login(account, `198.51.100.${i}`)).status).toBe(401);
    }

    // 계정 카운터가 합산됐다면, 이 계정에 이미 실패 이력이 있는 IP 는 이제 막혀야 한다.
    expect((await login(account, '198.51.100.0')).status).toBe(429);

    // 반면 이 계정으로 실패한 적 없는 IP 의 첫 시도는 통과한다 (잠금 DoS 대책).
    expect((await login(account, '198.51.100.250')).status).toBe(401);
  });

  it('닉네임 대소문자·공백 변형으로 계정 카운터를 우회할 수 없다', async () => {
    const ip = '203.0.113.20';
    const variants = [
      'victim',
      'Victim',
      'VICTIM',
      ' victim ',
      'vIcTiM',
      'vic tim',
      'ｖｉｃｔｉｍ',
      'victim\t',
    ];

    const statuses: number[] = [];
    for (const v of variants) {
      statuses.push((await login(v, ip)).status);
    }

    // 변형을 바꿔가며 8번을 전부 통과시키면 계정 게이트가 무의미하다.
    expect(statuses).toContain(429);
  });

  it('존재하는 계정과 없는 계정의 응답이 동일하다 (사용자 열거 방지)', async () => {
    const existing = await login('alice', '203.0.113.30');
    const missing = await login('no-such-user', '203.0.113.31');

    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(existing.body).toEqual(missing.body);
  });

  it('한도에 걸린 뒤의 응답도 계정 존재 여부를 드러내지 않는다', async () => {
    const ip = '203.0.113.40';

    const drain = async (nickname: string) => {
      let last = await login(nickname, ip);
      for (let i = 0; i < 10 && last.status !== 429; i += 1) {
        last = await login(nickname, ip);
      }
      return last;
    };

    const existing = await drain('alice');
    accountLoginThrottle.reset();
    const missing = await drain('no-such-user');

    expect(existing.status).toBe(429);
    expect(missing.status).toBe(429);
    expect(existing.body).toEqual(missing.body);
  });

  it('로그인에 성공하면 그 계정의 카운터가 비워진다', async () => {
    const ip = '203.0.113.50';

    // 비밀번호를 몇 번 틀린 뒤
    await login('alice', ip);
    await login('alice', ip);
    // 제대로 입력해 성공하고
    expect((await login('alice', ip, 'correct-pass')).status).toBe(201);

    // 다시 실패해도 곧바로 막히면 안 된다 — 성공이 카운터를 비웠어야 한다.
    for (let i = 0; i < 4; i += 1) {
      expect((await login('alice', ip)).status).toBe(401);
    }
  });

  it('닉네임이 문자열이 아니면 계정 게이트를 건너뛰고 400 으로 막힌다', async () => {
    const res = await login(['a', 'b'], '203.0.113.60');

    expect(res.status).toBe(400);
    // 비밀번호 검증까지 가지 못하므로 이 경로로는 무차별 대입이 불가능하다.
    expect(authServiceMock.login).not.toHaveBeenCalled();
  });

  it('본문 형식을 form-urlencoded 로 바꿔도 계정 카운터를 우회할 수 없다', async () => {
    const ip = '203.0.113.90';
    // main.ts 는 json 과 urlencoded 를 모두 파싱한다. 한쪽만 세면 형식만 바꿔 우회할 수 있다.
    const formLogin = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', ip)
        .type('form')
        .send({ nickname: 'victim', password: 'wrong-pass' });

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) statuses.push((await formLogin()).status);

    expect(statuses).toContain(429);
  });

  it('login 의 IP 한도가 CGNAT 를 견디는 값으로 올라가 있다', async () => {
    const ip = '203.0.113.70';

    // 계정 게이트에 걸리지 않도록 매번 다른 닉네임을 쓴다 — 순수하게 IP 한도만 본다.
    for (let i = 0; i < 100; i += 1) {
      const res = await login(`spray${i}`, ip);
      expect(res.status).not.toBe(429);
    }
    expect((await login('spray-last', ip)).status).toBe(429);
  }, 30000);

  it('signup 의 IP 한도가 CGNAT 를 견디는 값으로 올라가 있다', async () => {
    const ip = '203.0.113.80';
    const signup = (nickname: string) =>
      request(app.getHttpServer())
        .post('/auth/signup')
        .set('X-Forwarded-For', ip)
        .send({
          nickname,
          password: 'password1',
          allianceName: 'WOS',
          language: 'ko',
          serverCode: 'wrong',
        });

    for (let i = 0; i < 20; i += 1) {
      expect((await signup(`newbie${i}`)).status).toBe(403);
    }
    expect((await signup('newbie-last')).status).toBe(429);
  }, 30000);
});
