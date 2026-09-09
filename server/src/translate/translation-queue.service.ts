// 서버 주도 번역 호출의 전역 큐 — 동시 실행 4개, 분당 TRANSLATE_GLOBAL_RPM 상한. 초과분은 기다리지 않고 즉시 limit 오류다.
//
// 서버 푸시 구조에서는 사용자당 한도가 없어 채팅 한도(30/분/사용자) × 접속자 수가 곧 공급자 호출
// 상한이 된다(감사 C 5절 N). 여기서 분당 상한을 걸고, 넘긴 메시지는 `chat:translation { error:'limit' }`
// 로 방송돼 웹의 배치 경로가 뒤따른다. 폭주 시 비용 상한이 곧 품질 상한이다(설계 5절).
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranslateProviderError } from './translate-engine.service';

export const TRANSLATION_QUEUE_CONCURRENCY = 4;
export const TRANSLATION_QUEUE_WINDOW_MS = 60_000;
export const DEFAULT_TRANSLATE_GLOBAL_RPM = 120;

/** 1 이상의 정수 문자열만 통과한다. 그 밖은 기본값 — 잘못 읽은 값으로 번역을 막지 않는다. */
export function parseGlobalRpm(raw: unknown): number {
  if (typeof raw !== 'string' && typeof raw !== 'number') return DEFAULT_TRANSLATE_GLOBAL_RPM;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return DEFAULT_TRANSLATE_GLOBAL_RPM;
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_TRANSLATE_GLOBAL_RPM;
}

@Injectable()
export class TranslationQueueService {
  private readonly logger = new Logger(TranslationQueueService.name);
  readonly rpm: number;
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  /** 창 안에서 시작(예약)한 호출 시각. 큐에 넣는 순간 예약하므로 대기 중인 것도 센다. */
  private readonly started: number[] = [];

  constructor(config: ConfigService) {
    this.rpm = parseGlobalRpm(config.get<string>('TRANSLATE_GLOBAL_RPM'));
    this.logger.log(
      `번역 큐 — 동시 ${TRANSLATION_QUEUE_CONCURRENCY}개, 분당 ${this.rpm}회`,
    );
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    this.prune(now);
    if (this.started.length >= this.rpm) {
      throw new TranslateProviderError(
        'limit',
        429,
        Math.max(1, this.started[0] + TRANSLATION_QUEUE_WINDOW_MS - now),
      );
    }
    this.started.push(now);

    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < TRANSLATION_QUEUE_CONCURRENCY) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.running += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.running -= 1;
    const next = this.waiting.shift();
    if (next) next();
  }

  private prune(now: number): void {
    const cutoff = now - TRANSLATION_QUEUE_WINDOW_MS;
    while (this.started.length > 0 && this.started[0] <= cutoff) {
      this.started.shift();
    }
  }
}
