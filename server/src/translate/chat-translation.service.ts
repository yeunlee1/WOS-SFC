// 채팅 메시지 하나를 접속자 언어 집합으로 한 번에 번역한다. 실패는 throw 하지 않고 failed·error 로 돌려준다.
//
// 흐름(설계 3.2) — 대상 = 접속자 언어 − unambiguousLang(원문). 글자가 없거나 대상이 비면 빈 결과.
// message_translations 에 있는 언어는 빼고, 남은 언어를 전역 큐를 거쳐 엔진 1회로 번역해 저장한다.
import { Injectable, Logger } from '@nestjs/common';
import { MessageTranslationsService, TranslationMap } from './message-translations.service';
import { hasLetters, Lang, unambiguousLang } from './script-detect';
import { TranslateEngineService } from './translate-engine.service';
import { TranslationQueueService } from './translation-queue.service';

export type ChatTranslationError = 'provider' | 'limit';

export interface ChatTranslationResult {
  translations: TranslationMap;
  failed: Lang[];
  error?: ChatTranslationError;
}

@Injectable()
export class ChatTranslationService {
  private readonly logger = new Logger(ChatTranslationService.name);

  constructor(
    private readonly engine: TranslateEngineService,
    private readonly store: MessageTranslationsService,
    private readonly queue: TranslationQueueService,
  ) {}

  async translateForMessage(
    msg: { id: number; content: string },
    targetLangs: ReadonlySet<Lang>,
  ): Promise<ChatTranslationResult> {
    if (!hasLetters(msg.content)) return { translations: {}, failed: [] };
    const skip = unambiguousLang(msg.content);
    const targets = [...targetLangs].filter((lang) => lang !== skip);
    if (targets.length === 0) return { translations: {}, failed: [] };

    const existing = await this.loadExisting(msg.id, targets);
    const missing = targets.filter((lang) => existing[lang] === undefined);
    if (missing.length === 0) return { translations: existing, failed: [] };

    let fresh: TranslationMap;
    try {
      const result = await this.queue.run(() =>
        this.engine.translateMulti(msg.content, missing),
      );
      fresh = { ...result.translations };
      // 모델이 원문 언어를 대상 중 하나로 감지했는데 그 칸을 비웠으면 원문이 곧 그 언어의 번역이다.
      if (
        result.source !== 'unknown' &&
        missing.includes(result.source) &&
        fresh[result.source] === undefined
      ) {
        fresh[result.source] = msg.content;
      }
    } catch (error) {
      const status = (error as { status?: unknown })?.status;
      this.logger.warn(
        `메시지 ${msg.id} 번역 실패(${missing.join(',')}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        translations: existing,
        failed: missing,
        error: status === 429 ? 'limit' : 'provider',
      };
    }

    const rows = missing
      .filter((lang) => fresh[lang] !== undefined)
      .map((lang) => ({ messageId: msg.id, lang, text: fresh[lang] as string }));
    if (rows.length > 0) await this.store.upsertMany(rows);

    return {
      translations: { ...existing, ...fresh },
      failed: missing.filter((lang) => fresh[lang] === undefined),
    };
  }

  /** 히스토리 항목들의 번역을 쿼리 1회로 가져온다. 실패는 경고만 남기고 빈 맵 — 히스토리 전송을 막지 않는다. */
  async attachHistory(
    items: { id: number }[],
    langs: ReadonlySet<Lang>,
  ): Promise<Map<number, TranslationMap>> {
    if (items.length === 0 || langs.size === 0) return new Map();
    try {
      return await this.store.getForMessages(
        items.map((item) => item.id),
        [...langs],
      );
    } catch (error) {
      this.logger.warn(
        `히스토리 번역 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return new Map();
    }
  }

  private async loadExisting(id: number, targets: Lang[]): Promise<TranslationMap> {
    try {
      const map = await this.store.getForMessages([id], targets);
      return map.get(id) ?? {};
    } catch (error) {
      this.logger.warn(
        `메시지 ${id} 기존 번역 조회 실패(엔진은 그대로 부른다): ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }
}
