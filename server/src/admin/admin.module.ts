import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/users.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    forwardRef(() => RealtimeModule),
  ],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
