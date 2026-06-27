// 작전판 저장본 REST 구성을 묶는 Nest 모듈이다.
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationBoard } from './operation-board.entity';
import { OperationBoardsGateway } from './operation-boards.gateway';
import { OperationBoardsController } from './operation-boards.controller';
import { OperationBoardsService } from './operation-boards.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OperationBoard]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        secret: cs.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [OperationBoardsController],
  providers: [OperationBoardsService, OperationBoardsGateway],
  exports: [OperationBoardsService],
})
export class OperationBoardsModule {}
