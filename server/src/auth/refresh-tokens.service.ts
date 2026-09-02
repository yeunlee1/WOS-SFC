// 기기별 refresh 토큰의 발급·회전·폐기. 계정당 세션 수를 제한하고 만료 행을 정리한다.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { RefreshToken } from './refresh-token.entity';

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 계정당 유지하는 세션(기기) 수. PC·폰·태블릿을 넉넉히 덮고, 도난 토큰의 무한 누적을 막는다. */
export const MAX_SESSIONS_PER_USER = 10;

/** 저장 키. jti 는 무작위 UUID 라 소금 없는 sha256 으로 충분하고, 조회를 해시 일치로 할 수 있다. */
export function hashRefreshJti(jti: string): string {
  return createHash('sha256').update(jti, 'utf8').digest('hex');
}

@Injectable()
export class RefreshTokensService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repo: Repository<RefreshToken>,
  ) {}

  /** 새 세션을 만들고 jti 를 돌려준다. 만료 행과 상한 초과분을 함께 정리한다. */
  async issue(userId: number, now = new Date()): Promise<string> {
    await this.repo.delete({ userId, expiresAt: LessThan(now) });
    const jti = randomUUID();
    await this.repo.insert({
      userId,
      tokenHash: hashRefreshJti(jti),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    });
    const sessions = await this.repo.find({
      where: { userId },
      order: { id: 'DESC' },
      select: ['id'],
    });
    const surplus = sessions.slice(MAX_SESSIONS_PER_USER).map((row) => row.id);
    if (surplus.length > 0) await this.repo.delete(surplus);
    return jti;
  }

  /** 제시된 jti 의 행이 살아 있으면 새 jti 로 바꿔 돌려주고, 아니면 null. */
  async rotate(
    userId: number,
    jti: string,
    now = new Date(),
  ): Promise<string | null> {
    const row = await this.repo.findOne({
      where: { userId, tokenHash: hashRefreshJti(jti) },
    });
    if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
    const next = randomUUID();
    await this.repo.update(row.id, {
      tokenHash: hashRefreshJti(next),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    });
    return next;
  }

  /** 이 기기의 세션만 지운다. 다른 기기는 그대로다. */
  async revoke(userId: number, jti: string): Promise<void> {
    await this.repo.delete({ userId, tokenHash: hashRefreshJti(jti) });
  }
}
