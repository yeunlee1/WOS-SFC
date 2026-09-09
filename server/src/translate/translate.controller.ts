// 게시글 단건 번역 엔드포인트. 요청 한도 → 캐시 → 공급자 미스 한도 → 같은 키의 동시 요청 합치기.
import {
  Body,
  Controller,
  HttpException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { TranslateService } from './translate.service';
import { TranslateRequestDto } from './dto/translate-request.dto';
import { User } from '../users/users.entity';
import { TranslationRateLimitService } from './translation-rate-limit.service';

@Controller('translate')
@UseGuards(AuthGuard('jwt'))
export class TranslateController {
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    private service: TranslateService,
    private rateLimit: TranslationRateLimitService,
  ) {}

  @Post()
  async translate(
    @Body() dto: TranslateRequestDto,
    @Req() req: Request & { user: User },
  ) {
    const requestRate = this.rateLimit.consumeRequest(req.user.id);
    if (!requestRate.allowed) this.throwRateLimit(requestRate.retryAfterMs);

    const cached = await this.service.getCached(dto.text, dto.targetLang);
    if (cached !== null) return { translated: cached };

    const pendingKey = `${dto.targetLang}\0${dto.text}`;
    let request = this.pending.get(pendingKey);
    if (!request) {
      const providerRate = this.rateLimit.consumeProviderMiss(req.user.id);
      if (!providerRate.allowed) {
        this.throwRateLimit(providerRate.retryAfterMs);
      }
      request = this.service
        .translateUncached(dto.text, dto.targetLang)
        .finally(() => this.pending.delete(pendingKey));
      this.pending.set(pendingKey, request);
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
}
