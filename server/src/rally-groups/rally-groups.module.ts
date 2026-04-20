import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RallyGroup } from './rally-group.entity';
import { RallyGroupMember } from './rally-group-member.entity';
import { User } from '../users/users.entity';
import { UserBattleSettings } from '../users/user-battle-settings.entity';
import { RallyGroupsService } from './rally-groups.service';
import { RallyGroupsController } from './rally-groups.controller';
import { RallyGroupsGateway } from './rally-groups.gateway';
import { RallyAdminGuard } from './guards/rally-admin.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([RallyGroup, RallyGroupMember, User, UserBattleSettings]),
  ],
  providers: [
    RallyGroupsService,
    RallyGroupsGateway,
    RallyAdminGuard,
  ],
  controllers: [RallyGroupsController],
  exports: [RallyGroupsService],
})
export class RallyGroupsModule {}
