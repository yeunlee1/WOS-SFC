// 작전판 저장 라우트의 본문 크기 상한과 크기 초과 응답 계약을 검증한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Body,
  Controller,
  INestApplication,
  Logger,
  Module,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import request from 'supertest';
import {
  OPERATION_BOARD_BODY_LIMIT,
  OPERATION_BOARD_BODY_LIMIT_BYTES,
  OPERATION_BOARD_ROUTE_PREFIX,
  OPERATION_BOARD_TOO_LARGE_MESSAGE,
  REQUEST_TOO_LARGE_MESSAGE,
  createOperationBoardJsonParser,
  createRequestSizeErrorHandler,
} from './operation-board-body-limit';
import { MAX_OPERATION_ELEMENTS_BYTES } from './operation-board-elements';

// 크기 초과 응답만 보기 위한 최소 컨트롤러 — 실제 라우트와 경로만 맞춘다.
@Controller()
class SizeProbeController {
  @Post('operation-boards')
  save(@Body() body: unknown) {
    return { ok: true, received: Boolean(body) };
  }

  @Post('notices')
  notice(@Body() body: unknown) {
    return { ok: true, received: Boolean(body) };
  }
}

@Module({ controllers: [SizeProbeController] })
class SizeProbeModule {}

// main.ts 와 같은 순서로 배선한다 — 작전판 전용 파서가 전역 50kb 파서보다 먼저 붙어야 한다.
function makeApp() {
  const app = express();
  app.use(OPERATION_BOARD_ROUTE_PREFIX, createOperationBoardJsonParser());
  app.use(express.json({ limit: '50kb' }));
  app.post('/operation-boards', (req, res) => {
    res.json({
      elements: (req.body as { elements: unknown[] }).elements.length,
    });
  });
  app.post('/notices', (req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function makeElements(count: number) {
  // 실측한 펜 한 획(약 496 B)에 맞춘 요소를 만든다.
  return Array.from({ length: count }, (_, index) => ({
    id: `op-${String(index).padStart(36, '0')}`,
    type: 'path',
    x: index,
    y: index,
    x2: index + 1,
    y2: index + 1,
    strokeWidth: 3,
    color: '#7dd3fc',
    d: `M ${index} ${index}`.padEnd(380, ' L 1 1'),
  }));
}

describe('작전판 저장 라우트 본문 상한', () => {
  it('상한이 서버측 요소 총 바이트 상한보다 커야 저장이 서버 검증까지 도달한다', () => {
    expect(OPERATION_BOARD_BODY_LIMIT_BYTES).toBeGreaterThan(
      MAX_OPERATION_ELEMENTS_BYTES,
    );
    // 무제한으로 열지 않는다 — 전역 50kb 의 10배 이내로 묶는다.
    expect(OPERATION_BOARD_BODY_LIMIT_BYTES).toBeLessThanOrEqual(512 * 1024);
  });

  it('펜 200획 분량(50kb 초과) 작전판 저장 본문을 통과시킨다', async () => {
    const elements = makeElements(200);
    const body = {
      title: '작전판',
      backgroundType: 'grid',
      backgroundImageUrl: null,
      elements,
    };
    expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeGreaterThan(
      50 * 1024,
    );

    const res = await request(makeApp()).post('/operation-boards').send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ elements: 200 });
  });

  it('다른 엔드포인트는 전역 50kb 상한을 그대로 유지한다', async () => {
    const res = await request(makeApp())
      .post('/notices')
      .send({ content: 'x'.repeat(60 * 1024) });

    expect(res.status).toBe(413);
  });

  it('작전판 라우트도 상한을 넘기면 413 으로 거절한다', async () => {
    const res = await request(makeApp())
      .post('/operation-boards')
      .send({
        title: 'x',
        elements: ['y'.repeat(OPERATION_BOARD_BODY_LIMIT_BYTES)],
      });

    expect(res.status).toBe(413);
  });

  // 아래는 소스 문자열 검사다. main.ts 가 실제로 배선했는지의 순서만 보장하고
  // 런타임 동작은 보장하지 못한다 — 동작 보장은 위 supertest 케이스가 한다.
  it('main.ts 가 작전판 전용 파서를 전역 파서보다 먼저 붙인다', () => {
    const source = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    const operationIndex = source.indexOf('createOperationBoardJsonParser()');
    const globalIndex = source.indexOf("express.json({ limit: '50kb' })");

    expect(operationIndex).toBeGreaterThan(-1);
    expect(globalIndex).toBeGreaterThan(-1);
    expect(operationIndex).toBeLessThan(globalIndex);
    expect(source).toContain(OPERATION_BOARD_ROUTE_PREFIX);
  });

  it('상한 문자열과 바이트 값이 서로 맞는다', () => {
    expect(OPERATION_BOARD_BODY_LIMIT).toBe('300kb');
    expect(OPERATION_BOARD_BODY_LIMIT_BYTES).toBe(300 * 1024);
  });
});

// ─── 크기 초과 응답 계약 ───
// 실제 Nest 앱을 띄워 main.ts 와 같은 순서로 배선한 뒤 응답 본문을 검사한다.
// express 미들웨어에서 던진 body-parser 오류가 어떤 형태로 직렬화되는지가 쟁점이라
// 순수 express 앱이 아니라 Nest 앱이어야 계약이 성립한다.
describe('작전판 저장 크기 초과 응답', () => {
  jest.setTimeout(60000);

  async function bootNestApp() {
    const app = await NestFactory.create<NestExpressApplication>(
      SizeProbeModule,
      { logger: false },
    );
    app.use(OPERATION_BOARD_ROUTE_PREFIX, createOperationBoardJsonParser());
    app.use(express.json({ limit: '50kb' }));
    app.use(express.urlencoded({ extended: true, limit: '50kb' }));
    app.use(createRequestSizeErrorHandler());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        disableErrorMessages: process.env.NODE_ENV === 'production',
      }),
    );
    await app.init();
    return app;
  }

  async function postOversized(app: INestApplication, path: string) {
    return request(app.getHttpServer())
      .post(path)
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          elements: ['y'.repeat(OPERATION_BOARD_BODY_LIMIT_BYTES)],
        }),
      );
  }

  function responseText(res: request.Response): string {
    return res.text ?? JSON.stringify(res.body);
  }

  function errorMessage(res: request.Response): string {
    return (res.body as { message?: string })?.message ?? '';
  }

  // 응답 본문에 절대 들어가면 안 되는 것들.
  function assertNoInternals(text: string) {
    expect(text).not.toMatch(/\bat\s+\w[\w.<>]*\s*\(/); // 스택 프레임
    expect(text).not.toContain('node_modules');
    expect(text).not.toMatch(/[A-Za-z]:[\\/]/); // 윈도우 절대경로
    expect(text).not.toMatch(/\/(home|usr|var|app)\//); // 유닉스 절대경로
    expect(text).not.toMatch(/\.(ts|js)\b/); // 소스 파일명
    expect(text).not.toContain('body-parser');
    expect(text).not.toContain('raw-body');
    expect(text).not.toContain('entity.too.large');
  }

  it.each(['development', 'production'])(
    'NODE_ENV=%s 에서 413 응답에 스택트레이스·서버 경로가 없다',
    async (env) => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = env;
      const app = await bootNestApp();
      try {
        const res = await postOversized(app, '/operation-boards');

        expect(res.status).toBe(413);
        assertNoInternals(responseText(res));
      } finally {
        await app.close();
        if (prev) process.env.NODE_ENV = prev;
        else delete process.env.NODE_ENV;
      }
    },
  );

  it('413 응답이 사용자가 이해할 수 있는 한국어 메시지를 준다', async () => {
    const app = await bootNestApp();
    try {
      const res = await postOversized(app, '/operation-boards');
      const message = errorMessage(res);

      expect(res.status).toBe(413);
      expect(message).toBe(OPERATION_BOARD_TOO_LARGE_MESSAGE);
      // 한국어 문장인지 — 한글이 10자 이상 들어 있어야 한다.
      expect((message.match(/[가-힣]/g) ?? []).length).toBeGreaterThanOrEqual(
        10,
      );
      expect(message).not.toContain('request entity too large');
    } finally {
      await app.close();
    }
  });

  it('작전판이 아닌 라우트의 413 도 한국어 안내로 바뀐다', async () => {
    const app = await bootNestApp();
    try {
      const res = await postOversized(app, '/notices');

      expect(res.status).toBe(413);
      expect(errorMessage(res)).toBe(REQUEST_TOO_LARGE_MESSAGE);
      assertNoInternals(responseText(res));
    } finally {
      await app.close();
    }
  });

  it('크기 초과를 삼키지 않고 서버 로그에 남긴다', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const app = await bootNestApp();
    try {
      await postOversized(app, '/operation-boards');

      expect(warn).toHaveBeenCalled();
      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('/operation-boards');
      expect(logged).toContain('413');
    } finally {
      await app.close();
      warn.mockRestore();
    }
  });

  it('크기 초과가 아닌 오류는 그대로 흘려보낸다', async () => {
    const app = await bootNestApp();
    try {
      const res = await request(app.getHttpServer())
        .post('/operation-boards')
        .set('Content-Type', 'application/json')
        .send('{"a":');

      expect(res.status).toBe(400);
      expect(errorMessage(res)).not.toBe(OPERATION_BOARD_TOO_LARGE_MESSAGE);
      assertNoInternals(responseText(res));
    } finally {
      await app.close();
    }
  });

  it('main.ts 가 파서 뒤에 크기 초과 오류 처리기를 붙인다', () => {
    const source = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    const parserIndex = source.indexOf('express.urlencoded({ extended: true');
    const handlerIndex = source.indexOf('createRequestSizeErrorHandler()');

    expect(parserIndex).toBeGreaterThan(-1);
    expect(handlerIndex).toBeGreaterThan(parserIndex);
  });
});
