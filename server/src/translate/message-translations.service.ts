// message_translations 테이블 접근 — 히스토리 동봉용 다건 조회와 번역 결과 upsert.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MessageTranslation } from '../chat/message-translation.entity';
import { Lang } from './script-detect';

export type TranslationMap = Partial<Record<Lang, string>>;

export interface MessageTranslationRow {
  messageId: number;
  lang: Lang;
  text: string;
}

@Injectable()
export class MessageTranslationsService {
  private readonly logger = new Logger(MessageTranslationsService.name);

  constructor(
    @InjectRepository(MessageTranslation)
    private readonly repo: Repository<MessageTranslation>,
  ) {}

  /** 메시지 id 들의 주어진 언어 번역을 쿼리 1회로 가져온다. 행이 없는 id 는 맵에 없다. */
  async getForMessages(
    ids: number[],
    langs: readonly Lang[],
  ): Promise<Map<number, TranslationMap>> {
    const result = new Map<number, TranslationMap>();
    if (ids.length === 0 || langs.length === 0) return result;
    const rows = await this.repo.find({
      where: { messageId: In(ids), lang: In([...langs]) },
    });
    for (const row of rows) {
      const entry = result.get(row.messageId) ?? {};
      entry[row.lang as Lang] = row.text;
      result.set(row.messageId, entry);
    }
    return result;
  }

  /** INSERT … ON DUPLICATE KEY UPDATE 한 번. 실패는 경고만 남긴다 — 번역 방송은 저장과 무관하게 나간다. */
  async upsertMany(rows: MessageTranslationRow[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(MessageTranslation)
        .values(rows)
        .orUpdate(['text'], ['message_id', 'lang'])
        .execute();
    } catch (error) {
      this.logger.warn(
        `메시지 번역 저장 실패(${rows.length}행): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
