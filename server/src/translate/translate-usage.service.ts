// OpenAI 번역 호출의 토큰·소요 시간을 누적하는 카운터. GET /translate/usage(developer)로 노출한다.
import { Injectable, Logger } from '@nestjs/common';

export interface TranslateUsageRecord {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  ms: number;
  /** 이 호출이 번역한 대상 언어 수(배치는 항목 수). */
  targets: number;
}

export interface TranslateUsageSnapshot {
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalMs: number;
  /** 카운터가 0 이었던 시각(프로세스 시작). 재시작하면 초기화된다. */
  since: string;
}

@Injectable()
export class TranslateUsageService {
  private readonly logger = new Logger(TranslateUsageService.name);
  private readonly since = new Date().toISOString();
  private calls = 0;
  private inputTokens = 0;
  private cachedTokens = 0;
  private outputTokens = 0;
  private totalMs = 0;

  record(entry: TranslateUsageRecord): void {
    this.calls += 1;
    this.inputTokens += entry.inputTokens;
    this.cachedTokens += entry.cachedTokens;
    this.outputTokens += entry.outputTokens;
    this.totalMs += entry.ms;
    this.logger.log(
      `번역 호출 — 입력 ${entry.inputTokens}토큰(캐시 ${entry.cachedTokens}) 출력 ${entry.outputTokens}토큰 대상 ${entry.targets}개 ${entry.ms}ms`,
    );
  }

  snapshot(): TranslateUsageSnapshot {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      cachedTokens: this.cachedTokens,
      outputTokens: this.outputTokens,
      totalMs: this.totalMs,
      since: this.since,
    };
  }
}
