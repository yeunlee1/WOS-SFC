// 번역 HTTP 엔드포인트 — 게시글 단건(POST /translate), 채팅 배치(POST /translate/batch), 사용량(GET /translate/usage, developer).
import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { DeveloperGuard } from '../admin/developer.guard';
import { TranslateService } from './translate.service';
import { TranslateRequestDto } from './dto/translate-request.dto';
import { TranslateBatchDto } from './dto/translate-batch.dto';
import { User } from '../users/users.entity';
import { TranslationRateLimitService } from './translation-rate-limit.service';
import {
  TranslateEngineService,
  TranslateProviderError,
} from './translate-engine.service';
import { MessageTranslationsService } from './message-translations.service';
import { TranslationQueueService } from './translation-queue.service';
import { TranslateUsageService } from './translate-usage.service';
import { hasLetters, unambiguousLang } from './script-detect';

const RATE_LIMIT_MESSAGE = '번역 요청이 많습니다. 잠시 후 다시 시도해주세요.';

@Controller('translate')
@UseGuards(AuthGuard('jwt'))
export class TranslateController {
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    private service: TranslateService,
    private rateLimit: TranslationRateLimitService,
    private engine: TranslateEngineService,
    private store: MessageTranslationsService,
    private queue: TranslationQueueService,
    private usageCounter: TranslateUsageService,
  ) {}

  /** 게시글 단건. 요청 한도 → 캐시 → 공급자 미스 한도 → 같은 키의 동시 요청 합치기. */
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

  /**
   * 채팅 배치(설계 3.5). 웹이 히스토리·푸시 유실분을 메우는 유일한 복구 경로다.
   * skipped = 원문이 이미 그 언어(단일 스크립트)거나 글자가 없음. 기존 행을 먼저 채우고 미스만
   * 전역 큐를 거쳐 엔진 1회. 공급자 실패는 200 으로 failed 에 담아 웹이 항목별로 재시도한다(C 5절 H).
   */
  @Post('batch')
  async translateBatch(
    @Body() dto: TranslateBatchDto,
    @Req() req: Request & { user: User },
  ) {
    const batchRate = this.rateLimit.consumeBatch(req.user.id);
    if (!batchRate.allowed) this.throwRateLimit(batchRate.retryAfterMs);

    const target = dto.targetLang;
    const translated: Record<number, string> = {};
    const skipped: number[] = [];
    const failed: number[] = [];
    const candidates: { id: number; text: string }[] = [];
    for (const item of dto.items) {
      if (!hasLetters(item.text) || unambiguousLang(item.text) === target) {
        skipped.push(item.id);
      } else {
        candidates.push({ id: item.id, text: item.text });
      }
    }
    if (candidates.length === 0) return { translated, skipped, failed };

    const existing = await this.store.getForMessages(
      candidates.map((item) => item.id),
      [target],
    );
    const misses = candidates.filter((item) => {
      const hit = existing.get(item.id)?.[target];
      if (hit === undefined) return true;
      translated[item.id] = hit;
      return false;
    });
    if (misses.length === 0) return { translated, skipped, failed };

    let fresh: Record<number, string | null>;
    try {
      fresh = await this.queue.run(() => this.engine.translateBatch(misses, target));
    } catch (error) {
      if (error instanceof TranslateProviderError && error.status === 429) {
        this.throwRateLimit(error.retryAfterMs ?? 1_000);
      }
      for (const item of misses) failed.push(item.id);
      return { translated, skipped, failed };
    }

    const rows: { messageId: number; lang: typeof target; text: string }[] = [];
    for (const item of misses) {
      const text = fresh[item.id];
      if (typeof text === 'string' && text !== '') {
        translated[item.id] = text;
        rows.push({ messageId: item.id, lang: target, text });
      } else {
        failed.push(item.id);
      }
    }
    if (rows.length > 0) await this.store.upsertMany(rows);
    return { translated, skipped, failed };
  }

  /** 누적 사용량. developer 만 본다. */
  @Get('usage')
  @UseGuards(DeveloperGuard)
  usage() {
    return this.usageCounter.snapshot();
  }

  private throwRateLimit(retryAfterMs: number): never {
    throw new HttpException(
      {
        message: RATE_LIMIT_MESSAGE,
        retryAfterMs,
      },
      429,
    );
  }
}
