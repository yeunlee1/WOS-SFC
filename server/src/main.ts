import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as express from 'express';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: true, limit: '50kb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: process.env.NODE_ENV === 'production',
    }),
  );

  if (process.env.NODE_ENV === 'production' && !process.env.WEB_ORIGIN) {
    throw new Error('WEB_ORIGIN 환경변수가 production에서 필수입니다');
  }
  const allowedOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';
  app.enableCors({ origin: allowedOrigin, credentials: true });

  await app.listen(process.env.PORT ?? 3001);
  console.log(`Server running on port ${process.env.PORT ?? 3001}`);
}
bootstrap();
