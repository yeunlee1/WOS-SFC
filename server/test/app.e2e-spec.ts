import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/time (GET)', () => {
    return request(app.getHttpServer())
      .get('/time')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect((response) => {
        const body = response.body as Record<string, unknown>;
        expect(typeof body.utc).toBe('number');
        expect(typeof body.t1).toBe('number');
        expect(typeof body.t2).toBe('number');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
