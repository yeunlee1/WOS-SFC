import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notice } from './notice.entity';
import { NoticesService } from './notices.service';
import { NoticesController } from './notices.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([Notice]), forwardRef(() => RealtimeModule)],
  providers: [NoticesService],
  controllers: [NoticesController],
  exports: [NoticesService],
})
export class NoticesModule {}
