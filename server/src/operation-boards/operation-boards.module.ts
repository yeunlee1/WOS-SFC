// 작전판 저장본 REST 구성을 묶는 Nest 모듈이다.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationBoard } from './operation-board.entity';
import { OperationBoardsGateway } from './operation-boards.gateway';
import { OperationBoardsController } from './operation-boards.controller';
import { OperationBoardsService } from './operation-boards.service';
import { BoardsModule } from '../boards/boards.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { OperationBoardBackgroundUploadGuard } from './operation-board-background-upload.guard';
import { OperationBoardBackgroundCleanupService } from './operation-board-background-cleanup.service';

@Module({
  // 소켓 인증은 RealtimeModule의 SocketAuthService가 소켓당 한 번만 수행한다.
  imports: [
    TypeOrmModule.forFeature([OperationBoard]),
    BoardsModule,
    RealtimeModule,
  ],
  controllers: [OperationBoardsController],
  providers: [
    OperationBoardsService,
    OperationBoardsGateway,
    OperationBoardBackgroundUploadGuard,
    OperationBoardBackgroundCleanupService,
  ],
  // 관리자 고아 회수(AdminModule)가 배경 회수 서비스를 쓴다.
  exports: [OperationBoardsService, OperationBoardBackgroundCleanupService],
})
export class OperationBoardsModule {}
