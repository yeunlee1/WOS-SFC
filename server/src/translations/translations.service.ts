// 텍스트 해시 번역 캐시 테이블(translations) 접근. 게시글 단건 번역 경로만 쓴다.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async set(cacheKey: string, translated: string): Promise<void> {
    await this.repo.save({ cacheKey, translated });
  }
}
