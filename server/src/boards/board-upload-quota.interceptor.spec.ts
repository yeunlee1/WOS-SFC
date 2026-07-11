// 게시판 업로드 interceptor가 성공과 실패 모두에서 quota 예약을 해제하는지 검증한다.
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { BoardUploadQuotaInterceptor } from './board-upload-quota.interceptor';
import {
  BOARD_UPLOAD_RESERVATION,
  BoardUploadQuotaService,
} from './board-upload-quota.service';

function setup() {
  const token = Symbol('reservation');
  const request = { [BOARD_UPLOAD_RESERVATION]: token };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const quota = { release: jest.fn() };
  const interceptor = new BoardUploadQuotaInterceptor(
    quota as unknown as BoardUploadQuotaService,
  );
  return { token, request, context, quota, interceptor };
}

describe('BoardUploadQuotaInterceptor', () => {
  it('Multer와 controller 성공 후 예약을 해제한다', async () => {
    const { token, request, context, quota, interceptor } = setup();
    const next = { handle: () => of({ ok: true }) } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toEqual({
      ok: true,
    });
    expect(quota.release).toHaveBeenCalledWith(token);
    expect(request[BOARD_UPLOAD_RESERVATION]).toBeUndefined();
  });

  it('Multer 또는 controller 실패 후에도 예약을 해제한다', async () => {
    const { token, request, context, quota, interceptor } = setup();
    const next = {
      handle: () => throwError(() => new Error('upload failed')),
    } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('upload failed');
    expect(quota.release).toHaveBeenCalledWith(token);
    expect(request[BOARD_UPLOAD_RESERVATION]).toBeUndefined();
  });
});
