// server/src/realtime/realtime.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway';
import { ReadyNegotiationService } from './ready-negotiation.service';
import { WsRateLimitService } from './ws-rate-limit.service';
import { BusyLockService } from './busy-lock.service';
import { NoticesModule } from '../notices/notices.module';
import { RalliesModule } from '../rallies/rallies.module';
import { MembersModule } from '../members/members.module';
import { BoardsModule } from '../boards/boards.module';
import { AllianceNoticesModule } from '../alliance-notices/alliance-notices.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        secret: cs.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    forwardRef(() => NoticesModule),
    forwardRef(() => RalliesModule),
    forwardRef(() => MembersModule),
    forwardRef(() => BoardsModule),
    forwardRef(() => AllianceNoticesModule),
    forwardRef(() => UsersModule),
  ],
  providers: [
    RealtimeGateway,
    ReadyNegotiationService,
    WsRateLimitService,
    BusyLockService,
  ],
  exports: [RealtimeGateway, BusyLockService, WsRateLimitService],
})
export class RealtimeModule {}
