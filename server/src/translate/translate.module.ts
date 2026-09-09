// 번역 모듈 — OpenAI 엔진·용어집·캐시·사용량·게시글 단건 엔드포인트. 채팅 게이트웨이가 엔진과 캐시를 가져다 쓴다.
import { Module } from '@nestjs/common';
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';
import { TranslationsModule } from '../translations/translations.module';
import { TranslationRateLimitService } from './translation-rate-limit.service';
import { TranslateEngineService } from './translate-engine.service';
import { TranslateUsageService } from './translate-usage.service';
import { TranslationCacheService } from './translation-cache.service';

@Module({
  imports: [TranslationsModule],
  controllers: [TranslateController],
  providers: [
    TranslateService,
    TranslateEngineService,
    TranslateUsageService,
    TranslationCacheService,
    TranslationRateLimitService,
  ],
  exports: [TranslateEngineService, TranslateUsageService, TranslationCacheService],
})
export class TranslateModule {}
