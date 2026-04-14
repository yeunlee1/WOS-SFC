// server/src/rallies/rallies.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rally } from './rally.entity';
import { RalliesService } from './rallies.service';
import { RalliesController } from './rallies.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([Rally]), forwardRef(() => RealtimeModule)],
  providers: [RalliesService],
  controllers: [RalliesController],
  exports: [RalliesService],
})
export class RalliesModule {}
