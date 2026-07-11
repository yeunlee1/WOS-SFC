// server/src/boards/boards.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoardPost } from './board-post.entity';
import { BoardsService } from './boards.service';
import { BoardsController } from './boards.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { BoardUploadRateGuard } from './board-upload-rate.guard';
import { BoardUploadQuotaService } from './board-upload-quota.service';
import { BoardUploadQuotaInterceptor } from './board-upload-quota.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([BoardPost]),
    forwardRef(() => RealtimeModule),
  ],
  providers: [
    BoardsService,
    BoardUploadRateGuard,
    BoardUploadQuotaService,
    BoardUploadQuotaInterceptor,
  ],
  controllers: [BoardsController],
  exports: [
    BoardsService,
    BoardUploadQuotaService,
    BoardUploadQuotaInterceptor,
  ],
})
export class BoardsModule {}
