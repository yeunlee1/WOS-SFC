// 게시판 이미지 업로드의 사용자별 빈도 제한과 디스크 예약을 적용한다.
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request } from 'express';
import { User } from '../users/users.entity';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import {
  BoardUploadQuotaService,
  BoardUploadRequest,
  reserveUploadQuotaForRequest,
} from './board-upload-quota.service';
import { BOARD_UPLOAD_LIMITS } from './board-upload.options';

export const BOARD_UPLOADS_PER_USER_PER_DAY = 12;
export const BOARD_UPLOAD_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BoardUploadRateGuard implements CanActivate {
  constructor(
    private readonly rateLimit: WsRateLimitService,
    private readonly quota: BoardUploadQuotaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: User } & BoardUploadRequest>();
    const userId = request.user?.id;
    if (!Number.isInteger(userId)) throw new UnauthorizedException();

    // disconnect cleanup 대상이 아닌 불변 사용자 ID 버킷을 사용해 재로그인 우회를 막는다.
    if (
      !this.rateLimit.check(
        `board-upload-user:${userId}`,
        'board:upload',
        BOARD_UPLOADS_PER_USER_PER_DAY,
        BOARD_UPLOAD_RATE_WINDOW_MS,
      )
    ) {
      throw new ThrottlerException();
    }

    await reserveUploadQuotaForRequest(
      request,
      this.quota,
      BOARD_UPLOAD_LIMITS.fileSize ?? 0,
    );

    return true;
  }
}
