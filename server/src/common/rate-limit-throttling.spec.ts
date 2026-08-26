// ThrottlerModule 에 붙인 커스텀 추적자가 실제 요청 흐름에서 버킷을 분리하는지 검증한다.
import {
  Controller,
  INestApplication,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createRateLimitTracker } from './rate-limit-tracker';

const SECRET = 'rate-limit-tracker-test-secret';

// app.module.ts 가 실제로 쓰는 배선을 그대로 흉내낸다 —
// AuthModule 은 JwtModule 을 re-export 하므로, ThrottlerModule.forRootAsync 가
// 그 한 겹 건너 JwtService 를 주입받을 수 있어야 한다.
@Module({
  imports: [JwtModule.register({ secret: SECRET })],
  exports: [JwtModule],
})
class FakeAuthModule {}

// 실제 라우트명을 그대로 쓴다 — 추적자가 클래스·핸들러 이름으로 인증 전 라우트를 구분하기 때문.
@Controller('auth')
class AuthController {
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  @Post('refresh')
  refresh() {
    return { ok: true };
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  @Post('login')
  login() {
    return { ok: true };
  }
}

describe('ThrottlerModule + createRateLimitTracker', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeAuthModule,
        ThrottlerModule.forRootAsync({
          imports: [FakeAuthModule],
          inject: [JwtService],
          useFactory: (jwtService: JwtService) => ({
            throttlers: [{ name: 'default', ttl: 60000, limit: 60 }],
            getTracker: createRateLimitTracker(jwtService),
          }),
        }),
      ],
      controllers: [AuthController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  function refreshAs(token?: string) {
    const req = request(app.getHttpServer()).post('/auth/refresh');
    return token ? req.set('Cookie', `refresh_token=${token}`) : req;
  }

  it('같은 IP의 서로 다른 사용자는 한도를 나눠 쓰지 않는다', async () => {
    const userA = jwt.sign({ sub: 101, type: 'refresh' });
    const userB = jwt.sign({ sub: 102, type: 'refresh' });

    // A가 한도(2회)를 모두 소진하고 3회째에 429를 받는다.
    expect((await refreshAs(userA)).status).toBe(201);
    expect((await refreshAs(userA)).status).toBe(201);
    expect((await refreshAs(userA)).status).toBe(429);

    // 같은 IP지만 B는 아직 자기 버킷을 쓰지 않았다.
    expect((await refreshAs(userB)).status).toBe(201);
    expect((await refreshAs(userB)).status).toBe(201);
    expect((await refreshAs(userB)).status).toBe(429);
  });

  it('미인증·위조 토큰 요청은 IP 버킷 하나를 공유한다', async () => {
    // 서명이 없는 위조 토큰과 쿠키 없는 요청이 같은 버킷이어야 한다 —
    // 아니면 아무 문자열이나 넣어 무한히 새 버킷을 만들 수 있다.
    expect((await refreshAs('forged.eyJzdWIiOjk5OTk5fQ.x')).status).toBe(201);
    expect((await refreshAs('forged.eyJzdWIiOjEyMzR9.x')).status).toBe(201);
    expect((await refreshAs()).status).toBe(429);
  });

  it('login 은 유효한 토큰을 붙여도 IP 버킷으로 묶인다', async () => {
    const userA = jwt.sign({ sub: 201 });
    const userB = jwt.sign({ sub: 202 });

    const loginWith = (token: string) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('Cookie', `access_token=${token}`);

    expect((await loginWith(userA)).status).toBe(201);
    expect((await loginWith(userB)).status).toBe(201);
    // 사용자가 달라도 같은 IP이므로 3회째는 막혀야 한다.
    expect((await loginWith(userA)).status).toBe(429);
  });
});
