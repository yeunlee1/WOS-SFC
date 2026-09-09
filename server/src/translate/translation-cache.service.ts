// 게시글 단건 번역의 텍스트 해시 캐시. 메모리 LRU(2000건·30분) 앞단 + translations 테이블 뒷단.
//
// 채팅은 message_translations 테이블이 곧 캐시라 이 경로를 쓰지 않는다(설계 3.3).
// 키에 모델 버전(engine.cacheVersion)이 들어가므로 모델을 바꾸면 옛 번역이 자연히 무효화된다(A-R4).
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { TranslationsService } from '../translations/translations.service';
import { Lang } from './script-detect';
import { TranslateEngineService } from './translate-engine.service';

export const TRANSLATION_MEMORY_CACHE_MAX = 2000;
export const TRANSLATION_MEMORY_CACHE_TTL_MS = 30 * 60 * 1000;

type MemoryEntry = { value: string; expiresAt: number };

@Injectable()
export class TranslationCacheService {
  /** Map 의 삽입 순서를 LRU 순서로 쓴다 — 적중 시 지웠다 다시 넣어 맨 뒤로 보낸다. */
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(
    private readonly engine: TranslateEngineService,
    private readonly db: TranslationsService,
  ) {}

  get version(): string {
    return this.engine.cacheVersion;
  }

  makeKey(lang: Lang | string, text: string): string {
    const digest = createHash('sha256')
      .update(`${this.version}\0${lang}\0${text}`)
      .digest('hex');
    return `translate:${lang}:${digest}`;
  }

  async get(lang: Lang | string, text: string): Promise<string | null> {
    const key = this.makeKey(lang, text);
    const hit = this.readMemory(key);
    if (hit !== null) return hit;
    const stored = await this.db.get(key);
    if (stored !== null) this.writeMemory(key, stored);
    return stored;
  }

  /** 메모리는 즉시 갱신하고 DB 저장 실패는 그대로 던진다. 호출자가 로그만 남기고 번역문을 돌려준다(C-8). */
  async set(lang: Lang | string, text: string, translated: string): Promise<void> {
    const key = this.makeKey(lang, text);
    this.writeMemory(key, translated);
    await this.db.set(key, translated);
  }

  private readMemory(key: string): string | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    this.memory.delete(key);
    this.memory.set(key, entry);
    return entry.value;
  }

  private writeMemory(key: string, value: string): void {
    this.memory.delete(key);
    this.memory.set(key, {
      value,
      expiresAt: Date.now() + TRANSLATION_MEMORY_CACHE_TTL_MS,
    });
    while (this.memory.size > TRANSLATION_MEMORY_CACHE_MAX) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
  }
}
