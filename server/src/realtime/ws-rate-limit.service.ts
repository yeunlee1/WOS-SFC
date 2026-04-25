// server/src/realtime/ws-rate-limit.service.ts
//
// WebSocket 이벤트별 sliding window rate limit.
//
// 배경: verify-loop 보안 리뷰에서 잔존 우려로 지적된 항목 —
//   - time:ping: 인증된 사용자가 무한 호출 가능 (DDoS 표면)
//   - countdown:start: admin/developer가 빠르게 반복 호출 시 ReadyNegotiation probe 폭증
// @nestjs/throttler는 REST 컨트롤러 위주라 WebSocket 이벤트별 정밀 제어가 불편.
// 본 모듈에 격리 — gateway는 단순히 check() 호출 + disconnect 시 cleanup() 호출만.
//
// 향후 알고리즘 변경(token bucket, leaky bucket 등) 시 본 service만 수정.

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WsRateLimitService {
  private readonly logger = new Logger(WsRateLimitService.name);

  // socketId → (eventName → recent timestamps within sliding window)
  // Map of Map은 메모리 격리(socket 단위) + cleanup 단순함을 위해 선택.
  private readonly buckets = new Map<string, Map<string, number[]>>();

  /**
   * 특정 socket의 특정 event 호출이 rate limit 내인지 확인 후 시도 기록.
   * 이미 limit에 도달했다면 false 반환 (호출자가 early return).
   *
   * @param socketId socket.io의 client.id
   * @param event 이벤트 이름 (예: 'time:ping')
   * @param limit 윈도우 내 허용 횟수
   * @param windowMs 윈도우 크기 (ms)
   * @returns true=허용, false=rate limited
   */
  check(socketId: string, event: string, limit: number, windowMs: number): boolean {
    const now = Date.now();

    let eventMap = this.buckets.get(socketId);
    if (!eventMap) {
      eventMap = new Map();
      this.buckets.set(socketId, eventMap);
    }

    let timestamps = eventMap.get(event);
    if (!timestamps) {
      timestamps = [];
      eventMap.set(event, timestamps);
    }

    // 윈도우 밖 timestamp 정리 (sliding window)
    const cutoff = now - windowMs;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= limit) {
      this.logger.warn(
        `Rate limit exceeded — socket=${socketId} event=${event} limit=${limit}/${windowMs}ms`,
      );
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * Socket disconnect 시 호출 — 메모리 누수 방지.
   * @param socketId 정리할 socket.id
   */
  cleanup(socketId: string): void {
    this.buckets.delete(socketId);
  }
}
