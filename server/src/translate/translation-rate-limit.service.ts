// 번역 엔드포인트 요청과 외부 공급자 호출을 사용자별·서버 전체 버킷으로 제한한다.
import { Injectable } from '@nestjs/common';

export const TRANSLATION_REQUEST_RATE_LIMIT = 60;
export const TRANSLATION_PROVIDER_RATE_LIMIT = 10;
export const TRANSLATION_GLOBAL_PROVIDER_RATE_LIMIT = 60;
export const TRANSLATION_RATE_WINDOW_MS = 60_000;

type RateLimitResult = { allowed: boolean; retryAfterMs: number };

@Injectable()
export class TranslationRateLimitService {
  private readonly requestBuckets = new Map<number, number[]>();
  private readonly providerBuckets = new Map<number, number[]>();
  private readonly globalProviderBucket: number[] = [];

  consumeRequest(userId: number): RateLimitResult {
    return this.consumeBucket(
      this.requestBuckets,
      userId,
      TRANSLATION_REQUEST_RATE_LIMIT,
    );
  }

  consumeProviderMiss(userId: number): RateLimitResult {
    const now = Date.now();
    const userTimestamps = this.providerBuckets.get(userId) ?? [];
    this.prune(userTimestamps, now);
    this.prune(this.globalProviderBucket, now);

    if (userTimestamps.length >= TRANSLATION_PROVIDER_RATE_LIMIT) {
      return this.blockedResult(userTimestamps, now);
    }
    if (
      this.globalProviderBucket.length >= TRANSLATION_GLOBAL_PROVIDER_RATE_LIMIT
    ) {
      return this.blockedResult(this.globalProviderBucket, now);
    }

    userTimestamps.push(now);
    this.providerBuckets.set(userId, userTimestamps);
    this.globalProviderBucket.push(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  private consumeBucket(
    buckets: Map<number, number[]>,
    userId: number,
    limit: number,
  ): RateLimitResult {
    const now = Date.now();
    const timestamps = buckets.get(userId) ?? [];
    this.prune(timestamps, now);

    if (timestamps.length >= limit) {
      return this.blockedResult(timestamps, now);
    }

    timestamps.push(now);
    buckets.set(userId, timestamps);
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(timestamps: number[], now: number): void {
    const cutoff = now - TRANSLATION_RATE_WINDOW_MS;
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }
  }

  private blockedResult(timestamps: number[], now: number): RateLimitResult {
    return {
      allowed: false,
      retryAfterMs: Math.max(
        1,
        timestamps[0] + TRANSLATION_RATE_WINDOW_MS - now,
      ),
    };
  }
}
