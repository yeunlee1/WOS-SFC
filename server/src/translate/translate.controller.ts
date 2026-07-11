import {
  Body,
  Controller,
  HttpException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { createHash } from 'crypto';
import { Request } from 'express';
import { TranslateService } from './translate.service';
import { TranslateRequestDto } from './dto/translate-request.dto';
import { TranslationsService } from '../translations/translations.service';
import { User } from '../users/users.entity';
import { TranslationRateLimitService } from './translation-rate-limit.service';

const TRANSLATION_CACHE_VERSION = 'claude-haiku-4-5-20251001:v1';

@Controller('translate')
@UseGuards(AuthGuard('jwt'))
export class TranslateController {
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    private service: TranslateService,
    private cache: TranslationsService,
    private rateLimit: TranslationRateLimitService,
  ) {}

  @Post()
  async translate(
    @Body() dto: TranslateRequestDto,
    @Req() req: Request & { user: User },
  ) {
    const requestRate = this.rateLimit.consumeRequest(req.user.id);
    if (!requestRate.allowed) this.throwRateLimit(requestRate.retryAfterMs);

    const cacheKey = this.makeCacheKey(dto);
    const cached = await this.cache.get(cacheKey);
    if (cached !== null) return { translated: cached };

    let request = this.pending.get(cacheKey);
    if (!request) {
      const providerRate = this.rateLimit.consumeProviderMiss(req.user.id);
      if (!providerRate.allowed) {
        this.throwRateLimit(providerRate.retryAfterMs);
      }
      request = this.service
        .translate(dto.text, dto.targetLang)
        .then(async (translated) => {
          await this.cache.set(cacheKey, translated);
          return translated;
        })
        .finally(() => this.pending.delete(cacheKey));
      this.pending.set(cacheKey, request);
    }

    const translated = await request;
    return { translated };
  }

  private throwRateLimit(retryAfterMs: number): never {
    throw new HttpException(
      {
        message: '번역 요청이 많습니다. 잠시 후 다시 시도해주세요.',
        retryAfterMs,
      },
      429,
    );
  }

  private makeCacheKey(dto: TranslateRequestDto): string {
    const digest = createHash('sha256')
      .update(`${TRANSLATION_CACHE_VERSION}\0${dto.targetLang}\0${dto.text}`)
      .digest('hex');
    return `translate:${dto.targetLang}:${digest}`;
  }
}
