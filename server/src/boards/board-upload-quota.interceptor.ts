// Multer 처리 성공·실패와 무관하게 게시판 업로드 디스크 예약을 해제한다.
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import {
  BOARD_UPLOAD_CLEANUP,
  BOARD_UPLOAD_RESERVATION,
  BoardUploadQuotaService,
  BoardUploadRequest,
} from './board-upload-quota.service';

@Injectable()
export class BoardUploadQuotaInterceptor implements NestInterceptor {
  constructor(private readonly quota: BoardUploadQuotaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<BoardUploadRequest>();
    const reservation = request[BOARD_UPLOAD_RESERVATION];
    const cleanup = request[BOARD_UPLOAD_CLEANUP];
    return next.handle().pipe(
      finalize(() => {
        if (cleanup) cleanup();
        else {
          this.quota.release(reservation);
          delete request[BOARD_UPLOAD_RESERVATION];
        }
      }),
    );
  }
}
