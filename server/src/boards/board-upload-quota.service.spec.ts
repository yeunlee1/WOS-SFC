// 게시판 업로드 quota가 진행 중 예약과 실제 디스크 사용량을 분리하는지 검증한다.
import { HttpException, Logger } from '@nestjs/common';
import * as fsPromises from 'fs/promises';
import {
  BOARD_UPLOAD_TOTAL_QUOTA_BYTES,
  BoardUploadQuotaService,
} from './board-upload-quota.service';

jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  stat: jest.fn(),
}));

function fileEntry(name: string) {
  return { name, isDirectory: () => false, isFile: () => true };
}

describe('BoardUploadQuotaService', () => {
  const readdirMock = fsPromises.readdir as jest.Mock;
  const statMock = fsPromises.stat as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    readdirMock.mockResolvedValue([]);
  });

  it('동시 예약을 별도로 합산하고 release 뒤 실제 디스크를 다시 측정한다', async () => {
    const quota = new BoardUploadQuotaService();

    const first = await quota.reserve();
    const second = await quota.reserve();
    expect((quota as unknown as { reservedBytes: number }).reservedBytes).toBe(
      10 * 1024 * 1024,
    );
    expect(readdirMock).toHaveBeenCalledTimes(1);

    quota.release(first);
    expect((quota as unknown as { reservedBytes: number }).reservedBytes).toBe(
      5 * 1024 * 1024,
    );
    await quota.reserve();
    expect(readdirMock).toHaveBeenCalledTimes(2);

    quota.release(second);
  });

  it('실제 디스크와 진행 중 예약 합계가 quota를 넘으면 507을 반환한다', async () => {
    readdirMock.mockResolvedValue([fileEntry('full.webp')]);
    statMock.mockResolvedValue({ size: BOARD_UPLOAD_TOTAL_QUOTA_BYTES });
    const quota = new BoardUploadQuotaService();

    await expect(quota.reserve()).rejects.toBeInstanceOf(HttpException);
  });

  it('작전판 하위 디렉터리도 같은 전체 quota에 합산한다', async () => {
    readdirMock
      .mockResolvedValueOnce([
        {
          name: 'operation-boards',
          isDirectory: () => true,
          isFile: () => false,
        },
      ])
      .mockResolvedValueOnce([fileEntry('background.webp')]);
    statMock.mockResolvedValue({ size: BOARD_UPLOAD_TOTAL_QUOTA_BYTES });
    const quota = new BoardUploadQuotaService();

    await expect(quota.reserve(8 * 1024 * 1024)).rejects.toMatchObject({
      status: 507,
    });
    expect(readdirMock).toHaveBeenCalledTimes(2);
  });

  it('디스크 파일 크기를 읽지 못하면 실패 허용하지 않는다', async () => {
    readdirMock.mockResolvedValue([fileEntry('unreadable.webp')]);
    statMock.mockRejectedValue(new Error('access denied'));
    const quota = new BoardUploadQuotaService();

    await expect(quota.reserve()).rejects.toMatchObject({ status: 503 });
  });

  it('scan 도중 release되면 stale 결과를 쓰지 않고 즉시 다시 측정한다', async () => {
    let releaseBlocker: ((value: { size: number }) => void) | undefined;
    let markBlockerStarted: (() => void) | undefined;
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    readdirMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        fileEntry('upload.webp'),
        fileEntry('blocker.webp'),
      ])
      .mockResolvedValueOnce([fileEntry('upload.webp')]);
    statMock
      .mockResolvedValueOnce({ size: 1024 })
      .mockImplementationOnce(
        () =>
          new Promise<{ size: number }>((resolve) => {
            releaseBlocker = resolve;
            markBlockerStarted?.();
          }),
      )
      .mockResolvedValueOnce({ size: 5 * 1024 * 1024 });
    const quota = new BoardUploadQuotaService();
    const activeUpload = await quota.reserve();
    (quota as unknown as { lastScanAt: number }).lastScanAt = 0;

    const nextReservation = quota.reserve();
    await blockerStarted;
    quota.release(activeUpload);
    releaseBlocker?.({ size: 0 });
    await nextReservation;

    expect(readdirMock).toHaveBeenCalledTimes(3);
    expect((quota as unknown as { diskBytes: number }).diskBytes).toBe(
      5 * 1024 * 1024,
    );
  });
});

// 507만 던지고 끝나면 관리자가 언제 어디가 찼는지 알 수 없다.
describe('BoardUploadQuotaService 사용량 가시성', () => {
  const readdirMock = fsPromises.readdir as jest.Mock;
  const statMock = fsPromises.stat as jest.Mock;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    readdirMock.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('quota 초과로 507을 던질 때 현재 사용량을 경고 로그로 남긴다', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    readdirMock.mockResolvedValue([fileEntry('full.webp')]);
    statMock.mockResolvedValue({ size: BOARD_UPLOAD_TOTAL_QUOTA_BYTES });
    const quota = new BoardUploadQuotaService();

    await expect(quota.reserve()).rejects.toMatchObject({ status: 507 });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('1024');
  });

  it('invalidate 호출 뒤 다음 예약에서 디스크를 다시 실측한다', async () => {
    const quota = new BoardUploadQuotaService();

    await quota.reserve();
    expect(readdirMock).toHaveBeenCalledTimes(1);

    await quota.reserve();
    expect(readdirMock).toHaveBeenCalledTimes(1);

    quota.invalidate();
    await quota.reserve();
    expect(readdirMock).toHaveBeenCalledTimes(2);
  });
});
