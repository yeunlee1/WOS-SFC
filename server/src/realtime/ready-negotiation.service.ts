// server/src/realtime/ready-negotiation.service.ts
//
// SFC가 카운트다운 시작 시점에서, 모든 활성 클라이언트가 동일한 절대 시각에
// TTS 발화를 시작하도록 보장하는 ready 협상 모듈.
//
// 알고리즘 (단계 5):
// 1. 모든 활성 socket에 'time:probe' emit (ack callback 패턴)
// 2. probe 보낸 시각(probeStart)부터 ack 수신 시각까지 RTT 측정
// 3. PROBE_TIMEOUT_MS 이내 응답 못 한 클라이언트는 FALLBACK_RTT 사용
// 4. 모든 RTT 중 최댓값 maxRtt 계산
// 5. startedAt = Date.now() + min(maxRtt * 2 + MARGIN, MAX_GRACE)
//
// 모듈 분리 의도: realtime.gateway에 협상 로직을 박지 않고 본 service에 격리.
// 향후 timeout/margin 조정, 알고리즘 교체 시 본 파일만 수정.

import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class ReadyNegotiationService {
  private readonly logger = new Logger(ReadyNegotiationService.name);

  // probe 응답 대기 timeout — 너무 짧으면 느린 환경 누락, 너무 길면 SFC 대기 길어짐
  private static readonly PROBE_TIMEOUT_MS = 800;
  // probe ack timeout 시 fallback RTT (느린 LTE 평균 가정)
  private static readonly FALLBACK_RTT_MS = 200;
  // startedAt 마진 — 클라이언트가 schedule 처리에 필요한 추가 시간
  private static readonly STARTUP_GRACE_MARGIN_MS = 200;
  // startedAt이 너무 먼 미래로 가지 않도록 cap
  // (한 명의 매우 느린 클라이언트 때문에 모두가 너무 오래 기다리지 않게)
  private static readonly MAX_STARTUP_GRACE_MS = 1500;

  /**
   * 모든 활성 클라이언트에 probe 후 startedAt 절대시각 결정.
   * SFC의 카운트다운 시작 클릭 시 1회 호출.
   * @param server Socket.io Server 인스턴스
   * @returns startedAt — Date.now() 기반 미래 절대시각
   */
  async negotiateStartedAt(server: Server): Promise<number> {
    const sockets = Array.from(server.sockets.sockets.values());
    if (sockets.length === 0) {
      // 접속자 없음 — 일관성 위해 마진만 적용
      return Date.now() + ReadyNegotiationService.STARTUP_GRACE_MARGIN_MS;
    }

    const probeStart = Date.now();
    const probeResults = await Promise.all(
      sockets.map((sock) => this.probeOne(sock, probeStart)),
    );

    // 응답 못 한 클라이언트는 fallback RTT 적용 — "이 정도일 거다" 추정
    const rtts = probeResults.map((r) => r ?? ReadyNegotiationService.FALLBACK_RTT_MS);
    const maxRtt = Math.max(...rtts);
    const successCount = probeResults.filter((r) => r !== null).length;

    const computed = maxRtt * 2 + ReadyNegotiationService.STARTUP_GRACE_MARGIN_MS;
    const grace = Math.min(computed, ReadyNegotiationService.MAX_STARTUP_GRACE_MS);

    this.logger.log(
      `negotiateStartedAt: ${successCount}/${sockets.length} ack, maxRtt=${maxRtt}ms, grace=${grace}ms`,
    );

    return Date.now() + grace;
  }

  /**
   * 단일 socket에 probe 후 RTT 측정.
   * @returns RTT(ms) 또는 timeout/실패 시 null
   */
  private probeOne(sock: any, probeStart: number): Promise<number | null> {
    return new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) { settled = true; resolve(null); }
      }, ReadyNegotiationService.PROBE_TIMEOUT_MS);

      try {
        sock.emit('time:probe', { sentAt: probeStart }, (ack: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (ack && typeof (ack as any).t === 'number') {
            resolve(Date.now() - probeStart);
          } else {
            resolve(null);
          }
        });
      } catch {
        if (!settled) { settled = true; clearTimeout(timeout); resolve(null); }
      }
    });
  }
}
