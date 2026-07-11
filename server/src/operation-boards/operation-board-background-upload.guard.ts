// 작전판 배경 업로드의 역할·사용자별 빈도·공용 디스크 quota를 검증한다.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request } from 'express';
import {
  BoardUploadQuotaService,
  BoardUploadRequest,
  reserveUploadQuotaForRequest,
} from '../boards/board-upload-quota.service';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import { User } from '../users/users.entity';
import { OPERATION_BOARD_BACKGROUND_LIMITS } from './operation-board-upload.options';

export const OPERATION_BOARD_BACKGROUND_UPLOADS_PER_USER_PER_DAY = 12;
export const OPERATION_BOARD_BACKGROUND_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const OPERATION_BOARD_ADMIN_ROLES = ['admin', 'developer'];

@Injectable()
export class OperationBoardBackgroundUploadGuard implements CanActivate {
  constructor(
    private readonly rateLimit: WsRateLimitService,
    private readonly quota: BoardUploadQuotaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: User } & BoardUploadRequest>();
    const user = request.user;
    if (!user || !OPERATION_BOARD_ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException();
    }

    if (
      !this.rateLimit.check(
        `operation-background-upload-user:${user.id}`,
        'operation-board:background-upload',
        OPERATION_BOARD_BACKGROUND_UPLOADS_PER_USER_PER_DAY,
        OPERATION_BOARD_BACKGROUND_RATE_WINDOW_MS,
      )
    ) {
      throw new ThrottlerException();
    }

    await reserveUploadQuotaForRequest(
      request,
      this.quota,
      OPERATION_BOARD_BACKGROUND_LIMITS.fileSize ?? 0,
    );
    return true;
  }
}
