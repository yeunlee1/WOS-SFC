// server/src/translations/translations.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Translation } from './translation.entity';
import { TranslationsService } from './translations.service';
import { TranslationsController } from './translations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Translation])],
  providers: [TranslationsService],
  controllers: [TranslationsController],
})
export class TranslationsModule {}
