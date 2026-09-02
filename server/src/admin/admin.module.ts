import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/users.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { UploadOrphanService } from './upload-orphan.service';
import { BoardsModule } from '../boards/boards.module';
import { OperationBoardsModule } from '../operation-boards/operation-boards.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    forwardRef(() => RealtimeModule),
    // 고아 회수 엔드포인트가 폴더별 회수 서비스를 쓴다 —
    // 게시판은 BoardImageCleanupService, 작전판은 OperationBoardBackgroundCleanupService.
    forwardRef(() => BoardsModule),
    forwardRef(() => OperationBoardsModule),
  ],
  providers: [AdminService, UploadOrphanService],
  controllers: [AdminController],
})
export class AdminModule {}
