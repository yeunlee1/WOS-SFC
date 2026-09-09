// 텍스트 해시 번역 캐시 테이블(translations) 접근. 게시글 단건 번역 경로만 쓴다.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Translation } from './translation.entity';

@Injectable()
export class TranslationsService {
  constructor(
    @InjectRepository(Translation) private repo: Repository<Translation>,
  ) {}

  async get(cacheKey: string): Promise<string | null> {
    const t = await this.repo.findOneBy({ cacheKey });
    return t ? t.translated : null;
  }

  /** 여러 키를 IN 조건 한 번으로 조회한다. 없는 키는 맵에 들어가지 않는다. */
  async getMany(cacheKeys: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (cacheKeys.length === 0) return result;
    const rows = await this.repo.findBy({ cacheKey: In(cacheKeys) });
    for (const row of rows) result.set(row.cacheKey, row.translated);
    return result;
  }

  async set(cacheKey: string, translated: string): Promise<void> {
    await this.repo.save({ cacheKey, translated });
  }
}
