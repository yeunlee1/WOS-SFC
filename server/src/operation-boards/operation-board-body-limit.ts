// 작전판 저장 라우트의 요청 본문 크기 상한과 상한 초과(413) 응답 처리를 정의한다.
import { Logger } from '@nestjs/common';
import * as express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';

/**
 * 작전판 저장 전용 본문 상한.
 *
 * 실측 근거 — 웹 클라이언트가 만드는 펜 한 획(경로 상한 512자)은 약 496B 이고
 * 최악(경로를 꽉 채운 획)은 633B 다. 전역 상한 50kb(51,200B)에서는
 * 실측 크기 기준 103획, 최악 기준 81획에서 저장이 413 으로 끊긴다.
 * 서비스가 허용하는 요소 총량은 250,000B 이므로 제목·배경 URL·JSON 골격을 더해
 * 300kb 로 잡는다. 무제한이 아니며 전역 50kb 는 다른 엔드포인트에 그대로 남는다.
 */
export const OPERATION_BOARD_BODY_LIMIT = '300kb';
export const OPERATION_BOARD_BODY_LIMIT_BYTES = 300 * 1024;
export const OPERATION_BOARD_ROUTE_PREFIX = '/operation-boards';

/**
 * 작전판 라우트 전용 JSON 파서.
 * 전역 파서보다 먼저 붙여야 한다 — body-parser 는 이미 파싱된 요청을 건너뛰므로
 * 이 파서가 먼저 처리한 작전판 요청은 뒤따르는 전역 50kb 파서를 통과한다.
 */
export function createOperationBoardJsonParser(): RequestHandler {
  return express.json({ limit: OPERATION_BOARD_BODY_LIMIT });
}

/**
 * 크기 초과 안내 문구.
 *
 * 실측(2026-08-27) — 이 처리기가 없을 때 body-parser 의 에러는 Nest 의
 * BaseExceptionFilter 로 흘러 `{"statusCode":413,"message":"request entity too large"}`
 * 로 직렬화된다. 스택트레이스나 서버 경로가 새지는 않지만(그 점은 계약 테스트가 고정한다)
 * 영어 원문이라 사용자가 무엇을 어떻게 줄여야 하는지 알 수 없다.
 * 아래 두 문구가 그 자리를 대신한다.
 */
export const OPERATION_BOARD_TOO_LARGE_MESSAGE = `작전판 저장 데이터가 서버 상한(${OPERATION_BOARD_BODY_LIMIT_BYTES / 1024}KB)을 넘었습니다. 요소를 지우거나 나눠서 저장해주세요.`;
export const REQUEST_TOO_LARGE_MESSAGE =
  '보낸 데이터가 서버 상한을 넘었습니다. 내용을 줄여서 다시 시도해주세요.';

/** body-parser(http-errors)가 던진 본문 크기 초과 오류인가. */
function isEntityTooLargeError(err: unknown): err is {
  type?: string;
  statusCode?: number;
  status?: number;
  limit?: number;
  length?: number;
} {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as {
    type?: unknown;
    statusCode?: unknown;
    status?: unknown;
  };
  if (candidate.type === 'entity.too.large') return true;
  return candidate.statusCode === 413 || candidate.status === 413;
}

/** 경로가 작전판 라우트인가 — 접두사만 같은 다른 경로(/operation-boardsX)는 제외한다. */
function isOperationBoardPath(url: string): boolean {
  if (!url.startsWith(OPERATION_BOARD_ROUTE_PREFIX)) return false;
  const rest = url.slice(OPERATION_BOARD_ROUTE_PREFIX.length);
  return rest === '' || rest.startsWith('/') || rest.startsWith('?');
}

const bodyLimitLogger = new Logger('RequestBodyLimit');

/**
 * 본문 크기 초과(413)를 사용자용 한국어 안내로 바꾸는 오류 처리 미들웨어.
 *
 * 배선 위치 — 본문 파서들보다 뒤, Nest 라우터보다 앞이어야 한다.
 * express 는 next(err) 이후 스택에서 처음 만나는 4-인자 미들웨어에 오류를 넘기므로
 * main.ts 에서 파서 등록 직후에 붙인다.
 *
 * 응답은 운영·개발에서 동일하다. 환경으로 갈라 개발에서만 원문을 덧붙이면
 * NODE_ENV 를 설정하지 않은 배포가 그대로 상세를 노출하게 되므로 그 분기를 두지 않았다.
 * 대신 진단에 필요한 값은 전부 서버 로그로 보낸다.
 *
 * 크기 초과가 아닌 오류는 손대지 않고 next(err) 로 흘려보낸다 —
 * 그쪽은 기존대로 Nest 의 예외 필터가 처리한다.
 */
export function createRequestSizeErrorHandler(): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (!isEntityTooLargeError(err)) {
      next(err);
      return;
    }

    const url = req.originalUrl || req.url || '';
    // 삼키지 않는다 — 어느 경로가 얼마를 보냈는지 서버 로그에 남긴다.
    // 스택은 남기지 않는다. body-parser 내부 프레임이라 매번 같아서
    // 진단에 보태는 것이 없고, 100명 동시 접속에서 로그만 부풀린다.
    bodyLimitLogger.warn(
      `413 본문 크기 초과 — ${req.method} ${url}, 상한 ${err.limit ?? '알 수 없음'}B, 수신 ${err.length ?? '알 수 없음'}B`,
    );

    if (res.headersSent) {
      next(err);
      return;
    }

    res.status(413).json({
      statusCode: 413,
      error: 'Payload Too Large',
      message: isOperationBoardPath(url)
        ? OPERATION_BOARD_TOO_LARGE_MESSAGE
        : REQUEST_TOO_LARGE_MESSAGE,
    });
  };
}
