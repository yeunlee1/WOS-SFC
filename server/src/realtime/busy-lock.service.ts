import { Injectable } from '@nestjs/common';

export type LockHolder =
  | { type: 'countdown' }
  | { type: 'rally'; groupId: string };

/**
 * 서버 인스턴스 단일 메모리 lock — 음성 카운트다운 충돌 방지.
 * Countdown(1번)과 RallyGroup(3번) 시작 시 tryAcquire로 진입 게이팅.
 * 자동 해제 timer를 등록할 수 있어 dead state 방지.
 */
@Injectable()
export class BusyLockService {
  private holder: LockHolder | null = null;
  private timer: NodeJS.Timeout | null = null;

  /**
   * 잠금 시도. 이미 점유 중이면 false 반환.
   * autoReleaseMs > 0이면 setTimeout 등록 — 만료 시 holder 해제 + onAutoRelease 콜백 호출.
   */
  tryAcquire(
    holder: LockHolder,
    autoReleaseMs?: number,
    onAutoRelease?: () => void,
  ): boolean {
    if (this.holder !== null) return false;
    this.holder = holder;
    if (autoReleaseMs && autoReleaseMs > 0) {
      this.timer = setTimeout(() => {
        this.holder = null;
        this.timer = null;
        if (onAutoRelease) onAutoRelease();
      }, autoReleaseMs);
    }
    return true;
  }

  /**
   * 명시적 해제. holder가 일치할 때만 풀림 — 다른 주체의 lock을 실수로 풀지 않도록.
   * 자동 해제 timer가 있으면 cancel.
   */
  release(holder: LockHolder): void {
    if (!this.holder) return;
    if (!this.matches(this.holder, holder)) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.holder = null;
  }

  /** 현재 holder 조회 (broadcast/UX용). */
  getHolder(): LockHolder | null {
    return this.holder;
  }

  private matches(a: LockHolder, b: LockHolder): boolean {
    if (a.type !== b.type) return false;
    if (a.type === 'rally' && b.type === 'rally')
      return a.groupId === b.groupId;
    return true;
  }
}
