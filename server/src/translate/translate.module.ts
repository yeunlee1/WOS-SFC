import { Module } from '@nestjs/common';
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';
import { TranslationsModule } from '../translations/translations.module';
import { TranslationRateLimitService } from './translation-rate-limit.service';

@Module({
  imports: [TranslationsModule],
  controllers: [TranslateController],
  providers: [TranslateService, TranslationRateLimitService],
})
export class TranslateModule {}
