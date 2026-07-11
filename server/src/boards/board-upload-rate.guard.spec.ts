// 게시판 이미지 업로드가 계정별 제한을 적용하고 quota 예약을 전달하는지 검증한다.
import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { EventEmitter } from 'events';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import {
  BOARD_UPLOAD_RESERVATION,
  BoardUploadQuotaService,
} from './board-upload-quota.service';
import { BoardUploadRateGuard } from './board-upload-rate.guard';

function requestFor(userId?: number) {
  return Object.assign(new EventEmitter(), {
    user: userId ? { id: userId } : undefined,
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

describe('BoardUploadRateGuard', () => {
  it('불변 사용자 ID 버킷으로 제한하고 quota 예약을 요청에 보관한다', async () => {
    const rateLimit = { check: jest.fn().mockReturnValue(true) };
    const token = Symbol('reservation');
    const quota = { reserve: jest.fn().mockResolvedValue(token) };
    const guard = new BoardUploadRateGuard(
      rateLimit as unknown as WsRateLimitService,
      quota as unknown as BoardUploadQuotaService,
    );
    const request = requestFor(42);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(rateLimit.check).toHaveBeenCalledWith(
      'board-upload-user:42',
      'board:upload',
      12,
      24 * 60 * 60 * 1000,
    );
    expect(quota.reserve).toHaveBeenCalledTimes(1);
    expect(request[BOARD_UPLOAD_RESERVATION]).toBe(token);
  });

  it('사용자별 한도를 넘으면 quota 예약 전에 429를 반환한다', async () => {
    const quota = { reserve: jest.fn() };
    const guard = new BoardUploadRateGuard(
      {
        check: jest.fn().mockReturnValue(false),
      } as unknown as WsRateLimitService,
      quota as unknown as BoardUploadQuotaService,
    );

    await expect(
      guard.canActivate(contextFor(requestFor(42))),
    ).rejects.toBeInstanceOf(ThrottlerException);
    expect(quota.reserve).not.toHaveBeenCalled();
  });

  it('quota 측정 중 연결이 끊기면 뒤늦게 생성된 예약도 즉시 해제한다', async () => {
    let finishReservation: ((token: symbol) => void) | undefined;
    const token = Symbol('reservation');
    const quota = {
      reserve: jest.fn(
        () =>
          new Promise<symbol>((resolve) => {
            finishReservation = resolve;
          }),
      ),
      release: jest.fn(),
    };
    const guard = new BoardUploadRateGuard(
      {
        check: jest.fn().mockReturnValue(true),
      } as unknown as WsRateLimitService,
      quota as unknown as BoardUploadQuotaService,
    );
    const request = requestFor(42);

    const activation = guard.canActivate(contextFor(request));
    request.aborted = true;
    request.destroyed = true;
    request.emit('aborted');
    finishReservation?.(token);

    await expect(activation).rejects.toMatchObject({ status: 408 });
    expect(quota.release).toHaveBeenCalledWith(token);
    expect(request[BOARD_UPLOAD_RESERVATION]).toBeUndefined();
  });

  it('guard 통과 직후 연결이 끊겨도 Multer 완료를 기다리지 않고 해제한다', async () => {
    const token = Symbol('reservation');
    const quota = {
      reserve: jest.fn().mockResolvedValue(token),
      release: jest.fn(),
    };
    const guard = new BoardUploadRateGuard(
      {
        check: jest.fn().mockReturnValue(true),
      } as unknown as WsRateLimitService,
      quota as unknown as BoardUploadQuotaService,
    );
    const request = requestFor(42);

    await guard.canActivate(contextFor(request));
    request.aborted = true;
    request.destroyed = true;
    request.emit('aborted');

    expect(quota.release).toHaveBeenCalledWith(token);
    expect(request[BOARD_UPLOAD_RESERVATION]).toBeUndefined();
  });
});
