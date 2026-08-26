import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RallyGroup } from './rally-group.entity';
import { RallyGroupMember } from './rally-group-member.entity';
import { User } from '../users/users.entity';
import { RallyGroupsService } from './rally-groups.service';
import { RallyGroupsController } from './rally-groups.controller';
import { RallyGroupsGateway } from './rally-groups.gateway';
import { RallyAdminGuard } from './guards/rally-admin.guard';
import { RallyMemberSelfOrAdminGuard } from './guards/rally-member-self-or-admin.guard';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RallyGroup, RallyGroupMember, User]),
    // BusyLockService inject용. RealtimeModule이 다른 도메인 모듈을 forwardRef로 import하고 있어
    // 순환 의존 가능성에 대비해 forwardRef 사용.
    forwardRef(() => RealtimeModule),
    // RallyGroupsGateway.handleConnection의 재접속 스냅샷 토큰 검증용.
    // RealtimeModule/OperationBoardsModule과 동일한 registerAsync 패턴.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        secret: cs.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [
    RallyGroupsService,
    RallyGroupsGateway,
    RallyAdminGuard,
    RallyMemberSelfOrAdminGuard,
  ],
  controllers: [RallyGroupsController],
  exports: [RallyGroupsService],
})
export class RallyGroupsModule {}
