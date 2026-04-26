import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RallyGroup } from './rally-group.entity';
import { RallyGroupMember } from './rally-group-member.entity';
import { User } from '../users/users.entity';
import { RallyGroupsService } from './rally-groups.service';
import { RallyGroupsController } from './rally-groups.controller';
import { RallyGroupsGateway } from './rally-groups.gateway';
import { RallyAdminGuard } from './guards/rally-admin.guard';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RallyGroup, RallyGroupMember, User]),
    // BusyLockService inject용. RealtimeModule이 다른 도메인 모듈을 forwardRef로 import하고 있어
    // 순환 의존 가능성에 대비해 forwardRef 사용.
    forwardRef(() => RealtimeModule),
  ],
  providers: [RallyGroupsService, RallyGroupsGateway, RallyAdminGuard],
  controllers: [RallyGroupsController],
  exports: [RallyGroupsService],
})
export class RallyGroupsModule {}
