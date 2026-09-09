import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Message } from './message.entity';
import { User } from '../users/users.entity';

/** 소켓과 저장 경로가 쓰는 사용자 투영. passwordHash 같은 민감 컬럼은 여기 없다(A-S6). */
export type ChatUser = Pick<User, 'id' | 'nickname' | 'allianceName' | 'language' | 'role'>;

/** 접속 시 보내는 히스토리 창(일). 보존(CHAT_RETENTION_DAYS)이 이보다 길면 그 사이 메시지는 저장만 되고 읽히지 않는다(A-A6). */
export const CHAT_HISTORY_DAYS = 7;
export const CHAT_HISTORY_LIMIT = 200;
/** 보존 정리 1회 DELETE 의 행 수 상한. 누적분이 커도 긴 트랜잭션·gap lock 을 피한다(A-A7). */
export const MESSAGE_RETENTION_DELETE_BATCH = 1000;

// 보존 정리 스케줄. 부팅 직후 트래픽과 겹치지 않도록 첫 실행을 미루고 그 뒤 6시간 주기로 돈다.
export const MESSAGE_RETENTION_FIRST_RUN_MS = 60_000;
export const MESSAGE_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * CHAT_RETENTION_DAYS 파싱.
 *
 * 보존 정리는 DB에서 행을 **삭제**하므로 기본값이 없다. 값이 없거나 조금이라도
 * 이상하면 무조건 비활성(null)이다. 잘못 읽은 값으로 삭제를 시작하는 것보다
 * 아무것도 안 하는 편이 안전하다.
 *
 * 1 이상의 정수 문자열만 통과한다 — 빈 값·공백·0·음수·소수·문자는 전부 거절.
 */
export function parseRetentionDays(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const days = Number(text);
  if (!Number.isInteger(days) || days < 1) return null;
  return days;
}

@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatService.name);
  private retentionFirstRunTimer: ReturnType<typeof setTimeout> | null = null;
  private retentionIntervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Message)
    private readonly messagesRepo: Repository<Message>,
    private readonly config: ConfigService,
  ) {}

  /**
   * 보존 정리 호출 지점 — 여기 말고 deleteOldMessages를 부르는 곳은 없다.
   *
   * **옵트인이다.** CHAT_RETENTION_DAYS가 설정된 경우에만 타이머를 건다.
   * 자동 DELETE는 운영자가 명시적으로 켜야 하는 동작이라 기본값을 두지 않는다.
   */
  onModuleInit(): void {
    const days = parseRetentionDays(
      this.config.get<string>('CHAT_RETENTION_DAYS'),
    );
    if (days === null) {
      this.logger.warn(
        '채팅 보존 정리 비활성 (CHAT_RETENTION_DAYS 미설정 또는 값 오류) — 메시지가 무한 누적됩니다',
      );
      return;
    }

    this.logger.log(
      `채팅 보존 정리 활성 — ${days}일 이전 메시지를 ${MESSAGE_RETENTION_INTERVAL_MS / 3_600_000}시간마다 삭제합니다`,
    );
    this.retentionFirstRunTimer = setTimeout(() => {
      this.retentionFirstRunTimer = null;
      void this.runRetentionCleanup(days);
      this.retentionIntervalTimer = setInterval(() => {
        void this.runRetentionCleanup(days);
      }, MESSAGE_RETENTION_INTERVAL_MS);
      this.retentionIntervalTimer.unref?.();
    }, MESSAGE_RETENTION_FIRST_RUN_MS);
    this.retentionFirstRunTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.retentionFirstRunTimer) clearTimeout(this.retentionFirstRunTimer);
    if (this.retentionIntervalTimer) clearInterval(this.retentionIntervalTimer);
    this.retentionFirstRunTimer = null;
    this.retentionIntervalTimer = null;
  }

  /**
   * 삭제 대상 건수를 먼저 남기고 실제 삭제 건수도 남긴다.
   * 무엇이 얼마나 지워졌는지 로그에 없으면 사후 확인이 불가능하다.
   *
   * 정리 실패가 프로세스를 죽이지 않도록 여기서 삼킨다. 다음 주기에 다시 시도한다.
   */
  private async runRetentionCleanup(days: number): Promise<void> {
    try {
      const target = await this.countOldMessages(days);
      this.logger.log(
        `채팅 보존 정리 시작 — ${days}일 이전 삭제 대상 ${target}건`,
      );
      const deleted = await this.deleteOldMessages(days);
      this.logger.log(`채팅 보존 정리 완료 — ${deleted}건 삭제`);
    } catch (error) {
      this.logger.warn(
        `채팅 보존 정리 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 메시지 저장 — INSERT 한 번. save() 는 트랜잭션 + INSERT + created_at 재조회 SELECT 로
   * 4왕복이라(A-P2) created_at 을 서버가 채워 넣고 반환 객체를 직접 만든다. 방송값과 저장값이 같다.
   */
  async saveMessage(user: ChatUser, content: string): Promise<Message> {
    const createdAt = new Date();
    const result = await this.messagesRepo.insert({
      userId: user.id,
      content,
      createdAt,
    });
    const msg = new Message();
    msg.id = Number(result.identifiers[0]?.id);
    msg.userId = user.id;
    msg.content = content;
    msg.createdAt = createdAt;
    msg.user = user as User;
    return msg;
  }

  /**
   * 최근 CHAT_HISTORY_DAYS 일치 메시지 최대 200개 조회 (오름차순).
   * find({ take }) 는 eager 조인과 만나면 TypeORM 2단계 쿼리(DISTINCT id 서브쿼리 + IN 재조회)로
   * 떨어지고 User 엔티티 전체(password_hash 포함)를 하이드레이션한다(A-P1). QueryBuilder 의
   * limit 은 2단계를 타지 않으므로 필요한 컬럼만 골라 한 번에 읽는다.
   * created_at 인덱스가 있어야 range + ORDER BY가 풀 스캔으로 떨어지지 않는다.
   * (server/migrations/003_messages_created_at_index.sql)
   */
  async getRecentMessages(): Promise<Message[]> {
    const since = new Date(Date.now() - CHAT_HISTORY_DAYS * 86_400_000);
    const newestFirst = await this.messagesRepo
      .createQueryBuilder('m')
      .innerJoin('m.user', 'u')
      .select([
        'm.id',
        'm.content',
        'm.createdAt',
        'u.id',
        'u.nickname',
        'u.allianceName',
        'u.language',
      ])
      .where('m.createdAt > :since', { since })
      .orderBy('m.createdAt', 'DESC')
      .limit(CHAT_HISTORY_LIMIT)
      .getMany();
    return newestFirst.reverse();
  }

  // 삭제 대상 건수 — 실제로 지우기 전에 규모를 로그로 남기기 위한 것이다.
  async countOldMessages(days: number): Promise<number> {
    return this.messagesRepo.count({
      where: { createdAt: LessThan(this.cutoffDate(days)) },
    });
  }

  /**
   * 지정한 일수 이전의 오래된 메시지 삭제. 삭제된 행 수를 반환한다.
   * DeleteQueryBuilder 에는 limit 이 없어 원시 SQL 로 1000행씩 반복한다. message_translations 는
   * FK CASCADE 로 함께 지워진다.
   */
  async deleteOldMessages(days: number): Promise<number> {
    const cutoff = this.cutoffDate(days);
    let total = 0;
    for (;;) {
      const result = (await this.messagesRepo.query(
        `DELETE FROM \`messages\` WHERE \`created_at\` < ? LIMIT ${MESSAGE_RETENTION_DELETE_BATCH}`,
        [cutoff],
      )) as { affectedRows?: number } | undefined;
      const affected = result?.affectedRows ?? 0;
      total += affected;
      if (affected < MESSAGE_RETENTION_DELETE_BATCH) break;
    }
    return total;
  }

  private cutoffDate(days: number): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return cutoff;
  }
}
