import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 보안 헤더 (XSS, Clickjacking, MIME sniffing 방어)
  app.use(helmet());

  // 요청 바디 크기 제한 (기본 Express 100KB → 명시적 50KB)
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: true, limit: '50kb' }));

  // 전역 유효성 검사 파이프: DTO 데코레이터 기반 검증, 허용되지 않은 필드 제거
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // CORS: WEB_ORIGIN 환경변수로 허용 출처 제한, 미설정 시 개발용 localhost만 허용
  const allowedOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';
  app.enableCors({ origin: allowedOrigin });

  await app.listen(process.env.PORT ?? 3001);
  console.log(`Server running on port ${process.env.PORT ?? 3001}`);
}
bootstrap();
