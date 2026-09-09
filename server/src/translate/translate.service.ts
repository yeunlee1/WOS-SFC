// 게시글 단건 번역(POST /translate). OpenAI 엔진 위에 텍스트 해시 2단 캐시를 얹는다.
import { Injectable, Logger } from '@nestjs/common';
import { Lang } from './script-detect';
import {
  TranslateEngineService,
  TranslateProviderError,
} from './translate-engine.service';
import { TranslationCacheService } from './translation-cache.service';

@Injectable()
export class TranslateService {
  private readonly logger = new Logger(TranslateService.name);

  constructor(
    private readonly engine: TranslateEngineService,
    private readonly cache: TranslationCacheService,
  ) {}

  /** 캐시 적중이면 그대로, 아니면 엔진 1회 후 저장. */
  async translate(text: string, targetLang: string): Promise<string> {
    const cached = await this.getCached(text, targetLang);
    if (cached !== null) return cached;
    return this.translateUncached(text, targetLang);
  }

  getCached(text: string, targetLang: string): Promise<string | null> {
    return this.cache.get(targetLang, text);
  }

  /**
   * 캐시를 보지 않고 엔진을 부른다. 컨트롤러가 캐시 조회 뒤 공급자 미스 한도를 판단하고 나서 쓴다.
   * 캐시 저장 실패는 경고만 남기고 번역문을 돌려준다 — 저장 실패 때문에 클라이언트가 재시도해
   * 공급자를 다시 부르는 낭비를 막는다(C-8).
   */
  async translateUncached(text: string, targetLang: string): Promise<string> {
    const lang = targetLang as Lang;
    const { translations } = await this.engine.translateMulti(text, [lang]);
    const translated = translations[lang];
    if (!translated) {
      throw new TranslateProviderError('번역 결과가 비어 있다(출력 잘림 또는 빈 응답)');
    }
    try {
      await this.cache.set(lang, text, translated);
    } catch (error) {
      this.logger.warn(
        `번역 캐시 저장 실패(번역문은 돌려준다): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return translated;
  }
}
