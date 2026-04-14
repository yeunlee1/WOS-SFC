// server/src/boards/boards.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoardPost } from './board-post.entity';
import { BoardsService } from './boards.service';
import { BoardsController } from './boards.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([BoardPost]), forwardRef(() => RealtimeModule)],
  providers: [BoardsService],
  controllers: [BoardsController],
  exports: [BoardsService],
})
export class BoardsModule {}
