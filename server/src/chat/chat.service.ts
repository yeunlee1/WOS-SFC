import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan } from 'typeorm';
import { Message } from './message.entity';
import { User } from '../users/users.entity';

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

  // 메시지 저장
  async saveMessage(user: User, content: string): Promise<Message> {
    const msg = this.messagesRepo.create({ user, content });
    return this.messagesRepo.save(msg);
  }

  // 최근 7일치 메시지 최대 200개 조회 (오름차순)
  // created_at 인덱스가 있어야 range + ORDER BY가 풀 스캔으로 떨어지지 않는다.
  // (server/migrations/003_messages_created_at_index.sql)
  async getRecentMessages(): Promise<Message[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const newestFirst = await this.messagesRepo.find({
      where: { createdAt: MoreThan(sevenDaysAgo) },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return newestFirst.reverse();
  }

  // 삭제 대상 건수 — 실제로 지우기 전에 규모를 로그로 남기기 위한 것이다.
  async countOldMessages(days: number): Promise<number> {
    return this.messagesRepo.count({
      where: { createdAt: LessThan(this.cutoffDate(days)) },
    });
  }

  // 지정한 일수 이전의 오래된 메시지 삭제. 삭제된 행 수를 반환한다.
  async deleteOldMessages(days: number): Promise<number> {
    const result = await this.messagesRepo
      .createQueryBuilder()
      .delete()
      .where('created_at < :date', { date: this.cutoffDate(days) })
      .execute();
    return result.affected ?? 0;
  }

  private cutoffDate(days: number): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return cutoff;
  }
}
