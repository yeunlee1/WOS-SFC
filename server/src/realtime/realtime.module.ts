// server/src/realtime/realtime.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway';
import { ReadyNegotiationService } from './ready-negotiation.service';
import { WsRateLimitService } from './ws-rate-limit.service';
import { BusyLockService } from './busy-lock.service';
import { SocketAuthService } from './socket-auth.service';
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
    SocketAuthService,
  ],
  // SocketAuthService는 같은 소켓에 붙는 네 게이트웨이가 인증 결과를 나눠 쓰기 위해
  // 반드시 한 인스턴스여야 한다. 각 모듈이 따로 provide하면 캐시가 갈라져 공유가 깨진다.
  exports: [
    RealtimeGateway,
    BusyLockService,
    WsRateLimitService,
    SocketAuthService,
  ],
})
export class RealtimeModule {}
