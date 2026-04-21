import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { UsersModule } from '../users/users.module';
import { RallyGroupsModule } from '../rally-groups/rally-groups.module';

@Module({
  imports: [UsersModule, RallyGroupsModule],
  controllers: [MeController],
})
export class MeModule {}
