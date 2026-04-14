import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 전역 유효성 검사 파이프: DTO 데코레이터 기반 검증, 허용되지 않은 필드 제거
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  // CORS 허용 (개발 환경: 모든 origin 허용)
  app.enableCors({ origin: '*' });
  await app.listen(process.env.PORT ?? 3001);
  console.log(`Server running on port ${process.env.PORT ?? 3001}`);
}
bootstrap();
