// 작전판 배경 업로드가 역할·빈도·공용 디스크 quota를 모두 적용하는지 검증한다.
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { EventEmitter } from 'events';
import {
  BOARD_UPLOAD_RESERVATION,
  BoardUploadQuotaService,
} from '../boards/board-upload-quota.service';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import { OPERATION_BOARD_BACKGROUND_LIMITS } from './operation-board-upload.options';
import {
  OPERATION_BOARD_BACKGROUND_RATE_WINDOW_MS,
  OPERATION_BOARD_BACKGROUND_UPLOADS_PER_USER_PER_DAY,
  OperationBoardBackgroundUploadGuard,
} from './operation-board-background-upload.guard';

function requestFor(role: string) {
  return Object.assign(new EventEmitter(), {
    user: { id: 7, role },
    aborted: false,
    complete: false,
    destroyed: false,
  }) as EventEmitter & Record<string | symbol, unknown>;
}

function contextFor(
  request: Record<string | symbol, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('OperationBoardBackgroundUploadGuard', () => {
  it('admin 요청에 사용자별 일일 제한과 8MB 공용 quota 예약을 적용한다', async () => {
    const token = Symbol('reservation');
    const rateLimit = { check: jest.fn().mockReturnValue(true) };
    const quota = {
      reserve: jest.fn().mockResolvedValue(token),
      release: jest.fn(),
    };
    const guard = new OperationBoardBackgroundUploadGuard(
      rateLimit as unknown as WsRateLimitService,
      quota as unknown as BoardUploadQuotaService,
    );
    const request = requestFor('admin');

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(rateLimit.check).toHaveBeenCalledWith(
      'operation-background-upload-user:7',
      'operation-board:background-upload',
      OPERATION_BOARD_BACKGROUND_UPLOADS_PER_USER_PER_DAY,
      OPERATION_BOARD_BACKGROUND_RATE_WINDOW_MS,
    );
    expect(quota.reserve).toHaveBeenCalledWith(
      OPERATION_BOARD_BACKGROUND_LIMITS.fileSize,
    );
    expect(request[BOARD_UPLOAD_RESERVATION]).toBe(token);
  });

  it('일반 회원은 rate와 quota 검사 전에 거부한다', async () => {
    const rateLimit = { check: jest.fn() };
    const quota = { reserve: jest.fn(), release: jest.fn() };
    const guard = new OperationBoardBackgroundUploadGuard(
      rateLimit as unknown as WsRateLimitService,
      quota as unknown as BoardUploadQuotaService,
    );

    await expect(
      guard.canActivate(contextFor(requestFor('member'))),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rateLimit.check).not.toHaveBeenCalled();
    expect(quota.reserve).not.toHaveBeenCalled();
  });

  it('사용자별 일일 한도를 넘으면 quota 예약 전에 429를 반환한다', async () => {
    const quota = { reserve: jest.fn(), release: jest.fn() };
    const guard = new OperationBoardBackgroundUploadGuard(
      {
        check: jest.fn().mockReturnValue(false),
      } as unknown as WsRateLimitService,
      quota as unknown as BoardUploadQuotaService,
    );

    await expect(
      guard.canActivate(contextFor(requestFor('developer'))),
    ).rejects.toBeInstanceOf(ThrottlerException);
    expect(quota.reserve).not.toHaveBeenCalled();
  });
});
