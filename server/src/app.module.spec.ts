// app.module.ts 가 전역 등록하는 요청 한도 가드의 적용 경계를 검증한다.
import {
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Post,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { GlobalThrottlerGuard } from './app.module';

// 테스트 한도는 3회/분 — 왕복 횟수를 줄이려는 것이고, 검증 대상은 숫자가 아니라
// "적용되는가 / 이중으로 세는가 / 예외 경로가 뚫려 있는가" 세 가지다.
const TEST_LIMIT = 3;

// 지금까지 @Throttle 도 @UseGuards(ThrottlerGuard) 도 없어 무제한이던 라우트.
@Controller('rally-groups')
class UnthrottledController {
  @Post('start')
  start() {
    return { ok: true };
  }
}

// 이미 자체 ThrottlerGuard 를 선언한 라우트 (auth.controller / app.controller 와 같은 형태).
@Controller('auth')
class LocallyThrottledController {
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  @Post('refresh')
  refresh() {
    return { ok: true };
  }
}

// mp3 를 로그인당 수백 건 받는 경로. 전역 한도가 걸리면 카운트다운 음성이 통째로 깨진다.
@Controller('tts-audio')
class TtsLikeController {
  @Get(':lang/:key')
  serve() {
    return { ok: true };
  }
}

describe('전역 ThrottlerGuard 등록', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        // app.module.ts 와 같은 비동기 등록 형태를 쓴다 — 동기 forRoot 로만 검증하면
        // 실제 배선(forRootAsync + 커스텀 추적자)에서 APP_GUARD 주입이 되는지 알 수 없다.
        ThrottlerModule.forRootAsync({
          useFactory: () => ({
            throttlers: [{ name: 'default', ttl: 60000, limit: TEST_LIMIT }],
            getTracker: (req: Record<string, unknown>) =>
              `ip:${String(req?.ip ?? 'unknown')}`,
          }),
        }),
      ],
      controllers: [
        UnthrottledController,
        LocallyThrottledController,
        TtsLikeController,
      ],
      providers: [{ provide: APP_GUARD, useClass: GlobalThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('한도가 없던 라우트가 전역 기본 한도로 막힌다', async () => {
    for (let i = 0; i < TEST_LIMIT; i++) {
      await request(app.getHttpServer())
        .post('/rally-groups/start')
        .expect(201);
    }
    await request(app.getHttpServer()).post('/rally-groups/start').expect(429);
  });

  it('자체 ThrottlerGuard 를 선언한 라우트는 이중으로 세지 않는다', async () => {
    // 전역 가드가 같은 키로 한 번 더 세면 한도가 절반이 되어 2회차에서 이미 429 가 난다.
    await request(app.getHttpServer()).post('/auth/refresh').expect(201);
    await request(app.getHttpServer()).post('/auth/refresh').expect(201);
    await request(app.getHttpServer()).post('/auth/refresh').expect(429);
  });

  it('/tts-audio 는 전역 한도에 걸리지 않는다', async () => {
    for (let i = 0; i < TEST_LIMIT * 4; i++) {
      await request(app.getHttpServer()).get('/tts-audio/ko/1').expect(200);
    }
  });
});

describe('전역 ThrottlerGuard — 웹소켓 컨텍스트', () => {
  // WsContextCreator 가 전역 가드를 그대로 붙이므로 @SubscribeMessage 핸들러에도
  // 전역 가드가 실행된다. ThrottlerGuard 는 res.header() 를 호출하는데 ws 컨텍스트의
  // 두 번째 인자는 메시지 본문이라 함수가 없다 → TypeError 로 핸들러가 깨진다.
  // time:ping / countdown:start 같은 실시간 경로가 여기 해당한다.
  function makeWsContext(): ExecutionContext {
    const socket = { id: 's1', handshake: { headers: {} } };
    const body = { some: 'payload' };
    return {
      getType: () => 'ws',
      getHandler: () => function handleTimePing() {},
      getClass: () => class RealtimeGateway {},
      switchToHttp: () => ({
        getRequest: () => socket,
        getResponse: () => body,
      }),
    } as unknown as ExecutionContext;
  }

  it('ws 컨텍스트는 통과시키고 카운터를 건드리지 않는다', async () => {
    const storage = {
      increment: jest.fn(),
    };
    const guard = new GlobalThrottlerGuard(
      { throttlers: [{ name: 'default', ttl: 60000, limit: TEST_LIMIT }] },
      storage as never,
      new Reflector(),
    );
    await guard.onModuleInit();

    await expect(guard.canActivate(makeWsContext())).resolves.toBe(true);
    expect(storage.increment).not.toHaveBeenCalled();
  });
});
