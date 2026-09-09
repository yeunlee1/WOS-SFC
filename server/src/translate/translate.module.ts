// 번역 모듈 — OpenAI 엔진·용어집·캐시·사용량·게시글 단건 엔드포인트. 채팅 게이트웨이가 엔진과 캐시를 가져다 쓴다.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageTranslation } from '../chat/message-translation.entity';
import { MessageTranslationsService } from './message-translations.service';
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';
import { TranslationsModule } from '../translations/translations.module';
import { TranslationRateLimitService } from './translation-rate-limit.service';
import { TranslateEngineService } from './translate-engine.service';
import { TranslateUsageService } from './translate-usage.service';
import { TranslationCacheService } from './translation-cache.service';

@Module({
  imports: [TranslationsModule, TypeOrmModule.forFeature([MessageTranslation])],
  controllers: [TranslateController],
  providers: [
    TranslateService,
    TranslateEngineService,
    TranslateUsageService,
    TranslationCacheService,
    TranslationRateLimitService,
    MessageTranslationsService,
  ],
  exports: [
    TranslateEngineService,
    TranslateUsageService,
    TranslationCacheService,
    MessageTranslationsService,
  ],
})
export class TranslateModule {}
