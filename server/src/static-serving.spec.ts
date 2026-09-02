// 업로드 폴더와 web/dist 정적 서빙의 등록 순서가 /uploads/* 를 살리는지 검증한다.
//
// TestingModule 이 아니라 NestFactory 로 띄운다 — @nestjs/serve-static 은 로더를 모듈
// 인스턴스화 시점에 HttpAdapterHost 로 고르는데, TestingModule 은 compile() 뒤에야 어댑터가
// 붙어 NoopLoader 가 선택되고 아무것도 등록되지 않는다.
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { staticServingModules } from './static-serving';

describe('정적 서빙 등록 순서', () => {
  let app: INestApplication;
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'wos-static-'));
    const webDistRoot = join(root, 'web', 'dist');
    const uploadRoot = join(root, 'uploads');
    mkdirSync(webDistRoot, { recursive: true });
    mkdirSync(join(uploadRoot, 'boards'), { recursive: true });
    writeFileSync(join(webDistRoot, 'index.html'), '<html><body>WOS</body></html>');
    writeFileSync(join(uploadRoot, 'boards', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    @Module({ imports: staticServingModules({ webDistRoot, uploadRoot }) })
    class StaticOnlyModule {}

    app = await NestFactory.create(StaticOnlyModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('업로드된 파일은 200 으로 서빙된다', async () => {
    const res = await request(app.getHttpServer()).get('/uploads/boards/pic.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('없는 업로드 파일은 404 이고 index.html 로 대체되지 않는다', async () => {
    const res = await request(app.getHttpServer()).get('/uploads/boards/missing.png');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('WOS');
  });

  it('루트는 index.html 을 준다', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('WOS');
  });

  it('web/dist 에 없는 파일은 404 다', async () => {
    const res = await request(app.getHttpServer()).get('/nope.js');
    expect(res.status).toBe(404);
  });
});
