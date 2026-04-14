// server/src/realtime/realtime.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway';
import { NoticesModule } from '../notices/notices.module';
import { RalliesModule } from '../rallies/rallies.module';
import { MembersModule } from '../members/members.module';
import { BoardsModule } from '../boards/boards.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        secret: cs.get<string>('JWT_SECRET'),
      }),
    }),
    forwardRef(() => NoticesModule),
    forwardRef(() => RalliesModule),
    forwardRef(() => MembersModule),
    forwardRef(() => BoardsModule),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
