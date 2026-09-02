import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import * as express from 'express';
import cookieParser from 'cookie-parser';
import { assertProductionSecrets, resolveWebOrigin } from './common/boot-config';
import {
  createTrustProxyProbe,
  resolveTrustProxyHops,
  warnOnTrustProxyConfig,
} from './common/trust-proxy';
import {
  OPERATION_BOARD_ROUTE_PREFIX,
  createOperationBoardJsonParser,
  createRequestSizeErrorHandler,
} from './operation-boards/operation-board-body-limit';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 앞단 프록시가 붙인 X-Forwarded-For 중 신뢰할 홉 수를 지정한다.
  // 설정하지 않으면 req.ip 가 직접 연결된 소켓 주소(= 프록시 주소 하나)로 고정되어
  // 프록시 뒤의 모든 사용자가 같은 요청 한도 버킷을 공유한다.
  // 반대로 true 를 주면 클라이언트가 X-Forwarded-For 를 위조해 버킷을 무한히 만들어낼 수 있으므로
  // resolveTrustProxyHops 는 정수 홉 수만 돌려주고 true 를 절대 돌려주지 않는다.
  // 프록시 단 수가 1이 아닌 배포는 TRUST_PROXY_HOPS 에 실측한 단 수를 넣는다.
  const trustProxyLogger = new Logger('TrustProxy');
  const trustProxyHops = resolveTrustProxyHops(process.env);
  app.set('trust proxy', trustProxyHops);
  // 값이 없거나 잘못돼 조용히 기본값으로 넘어간 상태를 부팅 로그에 드러낸다.
  // 부팅을 거부하지는 않는다 — 거부하면 재시작 루프가 되어 서비스 전체가 멈추고,
  // 배포 구성의 리버스 프록시는 1단이라 기본값이 그 구성에서는 맞다.
  warnOnTrustProxyConfig(process.env, trustProxyLogger);
  // 부팅 후 첫 몇 건의 실제 요청만 X-Forwarded-For 체인과 req.ip 를 서버 로그에 남긴다.
  // 응답으로는 아무것도 내보내지 않고, 표본을 다 쓰면 영구히 멈춘다.
  app.use(
    createTrustProxyProbe({ hops: trustProxyHops, logger: trustProxyLogger }),
  );

  app.use(helmet());
  app.use(cookieParser());
  // 작전판 저장본은 요소 500개 기준 실측 약 250KB 라 전역 50kb 로는 저장이 413 으로 끊긴다.
  // 이 라우트에만 상한을 올린다 — 전역 파서는 이미 파싱된 요청을 건너뛰므로 뒤에 그대로 둔다.
  app.use(OPERATION_BOARD_ROUTE_PREFIX, createOperationBoardJsonParser());
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: true, limit: '50kb' }));
  // 상한 초과 응답을 한국어 안내로 바꾼다. 파서보다 뒤, Nest 라우터보다 앞이어야
  // express 가 파서의 next(err) 를 이 4-인자 미들웨어로 넘긴다.
  app.use(createRequestSizeErrorHandler());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: process.env.NODE_ENV === 'production',
    }),
  );

  assertProductionSecrets(process.env);
  const allowedOrigin = resolveWebOrigin(process.env, new Logger('BootConfig'));
  // 소켓 CORS(realtime/socket-cors.options.ts)는 요청 시점에 process.env.WEB_ORIGIN 을 읽는다.
  // 같은 정규화 값을 보도록 여기서 덮어쓴다.
  process.env.WEB_ORIGIN = allowedOrigin;
  app.enableCors({ origin: allowedOrigin, credentials: true });

  await app.listen(process.env.PORT ?? 3001);
  console.log(`Server running on port ${process.env.PORT ?? 3001}`);
}
bootstrap();
