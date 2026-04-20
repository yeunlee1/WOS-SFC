import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AllianceNotice } from './alliance-notice.entity';
import { AllianceNoticesService } from './alliance-notices.service';
import { AllianceNoticesController } from './alliance-notices.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([AllianceNotice]), forwardRef(() => RealtimeModule)],
  controllers: [AllianceNoticesController],
  providers: [AllianceNoticesService],
  exports: [AllianceNoticesService],
})
export class AllianceNoticesModule {}
