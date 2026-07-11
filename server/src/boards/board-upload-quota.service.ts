// 전체 이미지 업로드의 진행 중 예약과 실제 디스크 사용량을 분리해 관리한다.
import {
  HttpException,
  Injectable,
  RequestTimeoutException,
} from '@nestjs/common';
import type { Dirent } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { Request } from 'express';
import { UPLOAD_ROOT } from '../storage-paths';
import { BOARD_UPLOAD_LIMITS } from './board-upload.options';

export const BOARD_UPLOAD_TOTAL_QUOTA_BYTES = 1024 * 1024 * 1024;
const BOARD_UPLOAD_QUOTA_SCAN_INTERVAL_MS = 5000;
export const BOARD_UPLOAD_RESERVATION = Symbol('board-upload-reservation');
export const BOARD_UPLOAD_CLEANUP = Symbol('board-upload-cleanup');

export type BoardUploadRequest = {
  [BOARD_UPLOAD_RESERVATION]?: symbol;
  [BOARD_UPLOAD_CLEANUP]?: () => void;
};

export async function reserveUploadQuotaForRequest(
  request: Request & BoardUploadRequest,
  quota: BoardUploadQuotaService,
  bytes: number,
): Promise<void> {
  let disconnected = false;
  const releaseReservation = () => {
    const reservation = request[BOARD_UPLOAD_RESERVATION];
    delete request[BOARD_UPLOAD_RESERVATION];
    quota.release(reservation);
  };
  const removeDisconnectListeners = () => {
    request.off('aborted', handleDisconnect);
    request.off('close', handleDisconnect);
    delete request[BOARD_UPLOAD_CLEANUP];
  };
  const cleanup = () => {
    releaseReservation();
    removeDisconnectListeners();
  };
  const handleDisconnect = () => {
    // 정상적으로 본문을 모두 받은 close는 Multer 처리와 interceptor에 맡긴다.
    if (request.complete && !request.aborted) return;
    disconnected = true;
    cleanup();
  };

  request[BOARD_UPLOAD_CLEANUP] = cleanup;
  request.once('aborted', handleDisconnect);
  request.once('close', handleDisconnect);

  let reservation: symbol;
  try {
    reservation = await quota.reserve(bytes);
  } catch (error) {
    removeDisconnectListeners();
    throw error;
  }

  request[BOARD_UPLOAD_RESERVATION] = reservation;
  if (
    disconnected ||
    request.aborted ||
    (request.destroyed && !request.complete)
  ) {
    cleanup();
    throw new RequestTimeoutException('업로드 요청 연결이 종료되었습니다');
  }
}

@Injectable()
export class BoardUploadQuotaService {
  private diskBytes = 0;
  private reservedBytes = 0;
  private lastScanAt = 0;
  private invalidationVersion = 0;
  private lastScannedVersion = -1;
  private scanPromise: Promise<void> | null = null;
  private readonly reservations = new Map<symbol, number>();

  async reserve(bytes = BOARD_UPLOAD_LIMITS.fileSize ?? 0): Promise<symbol> {
    await this.refreshQuotaIfNeeded();
    if (
      this.diskBytes + this.reservedBytes + bytes >
      BOARD_UPLOAD_TOTAL_QUOTA_BYTES
    ) {
      throw new HttpException('이미지 저장 공간이 가득 찼습니다', 507);
    }

    const token = Symbol('upload');
    this.reservations.set(token, bytes);
    this.reservedBytes += bytes;
    return token;
  }

  release(token: symbol | undefined): void {
    if (!token) return;
    const bytes = this.reservations.get(token);
    if (bytes === undefined) return;
    this.reservations.delete(token);
    this.reservedBytes = Math.max(0, this.reservedBytes - bytes);
    // 성공·실패 어느 쪽이든 부분 파일이 남을 수 있어 다음 요청에서 다시 실측한다.
    this.invalidationVersion += 1;
    this.lastScanAt = 0;
  }

  private async refreshQuotaIfNeeded(): Promise<void> {
    while (
      this.lastScannedVersion !== this.invalidationVersion ||
      Date.now() - this.lastScanAt >= BOARD_UPLOAD_QUOTA_SCAN_INTERVAL_MS
    ) {
      if (!this.scanPromise) {
        const scanVersion = this.invalidationVersion;
        this.scanPromise = this.scanUploadBytes(scanVersion).finally(() => {
          this.scanPromise = null;
        });
      }
      await this.scanPromise;
    }
  }

  private async scanUploadBytes(scanVersion: number): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(UPLOAD_ROOT, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') entries = [];
      else {
        throw new HttpException(
          '게시판 이미지 저장 공간을 확인할 수 없습니다',
          503,
        );
      }
    }

    let diskBytes = 0;
    for (const entry of entries) {
      const entryPath = join(UPLOAD_ROOT, entry.name);
      if (entry.isDirectory()) diskBytes += await this.scanDirectory(entryPath);
      else if (entry.isFile()) diskBytes += await this.readFileSize(entryPath);
      if (diskBytes > BOARD_UPLOAD_TOTAL_QUOTA_BYTES) break;
    }

    this.diskBytes = diskBytes;
    this.lastScannedVersion = scanVersion;
    this.lastScanAt = scanVersion === this.invalidationVersion ? Date.now() : 0;
  }

  private async scanDirectory(directory: string): Promise<number> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw new HttpException('이미지 저장 공간을 확인할 수 없습니다', 503);
    }

    let bytes = 0;
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) bytes += await this.scanDirectory(entryPath);
      else if (entry.isFile()) bytes += await this.readFileSize(entryPath);
      if (bytes > BOARD_UPLOAD_TOTAL_QUOTA_BYTES) break;
    }
    return bytes;
  }

  private async readFileSize(filePath: string): Promise<number> {
    try {
      return (await stat(filePath)).size;
    } catch {
      throw new HttpException('이미지 저장 공간을 확인할 수 없습니다', 503);
    }
  }
}
