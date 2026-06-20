// 작전판 저장본 REST 구성을 묶는 Nest 모듈이다.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationBoard } from './operation-board.entity';
import { OperationBoardsController } from './operation-boards.controller';
import { OperationBoardsService } from './operation-boards.service';

@Module({
  imports: [TypeOrmModule.forFeature([OperationBoard])],
  controllers: [OperationBoardsController],
  providers: [OperationBoardsService],
  exports: [OperationBoardsService],
})
export class OperationBoardsModule {}
