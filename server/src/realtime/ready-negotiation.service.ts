// server/src/realtime/ready-negotiation.service.ts
//
// SFC가 카운트다운을 시작할 때, 가장 느린 클라이언트도 첫 슬롯 시각 전에 스케줄을
// 끝낼 수 있도록 startedAt(발화 시작 절대시각)을 미래로 밀어 주는 협상 모듈.
//
// 이 모듈이 보장하는 것 / 보장하지 못하는 것 (4회차 정정):
//   보장 O — 느린 클라이언트가 첫 숫자를 통째로 놓치지 않게 하는 여유(grace).
//            클라이언트는 delayMs < -200 인 슬롯을 스킵하므로(countdownPlayer.js),
//            grace가 부족하면 느린 사용자만 앞 숫자를 잃는다.
//   보장 X — 디바이스 간 발화 정렬 정확도. 각 클라이언트는 서버 절대시각을 자기
//            시계 추정(timeOffset)으로 환산해 발화하므로, 모두에게 동일한 값인
//            startedAt은 상대 정렬 계산에서 소거된다. 정렬 오차는 시계 offset 추정
//            오차 + 타이머 지터 + 오디오 출력 지연이 결정하며 본 협상으로 줄지 않는다.
//
// 알고리즘 (4회차):
// 1. 인증된 활성 socket에만 'time:probe' emit (ack callback 패턴).
//    미인증 소켓은 클라이언트(useReadyProbe)가 아직 'time:probe' 핸들러를 등록하지
//    않아 구조적으로 ack하지 않는다. 기다려 봐야 마감 시간만 통째로 낭비한다.
// 2. probe 보낸 시각(sentAt)부터 ack 수신 시각까지 RTT 측정.
// 3. 마감(PROBE_DEADLINE_MS)은 OUTLIER_RTT_MS와 같다. 그 시점까지 응답이 없는
//    클라이언트는 어차피 OUTLIER_RTT_MS로 clamp되므로, 더 기다려도 통계가 달라지지
//    않는다. 3회차의 800ms 대기는 정보 이득 없이 SFC 클릭 지연만 늘렸다.
// 4. RTT 보정 —
//    응답 O          : min(rtt, OUTLIER_RTT_MS)  (상한 clamp)
//    마감까지 무응답 : OUTLIER_RTT_MS            (기다리기를 그만뒀으므로 상한 가정)
//    응답은 왔으나 규격 밖 / emit 실패 : FALLBACK_RTT_MS
//      (소켓은 살아 있고 빠르다. 페이로드만 잘못된 경우라 꼬리로 볼 근거가 없다.)
//    3회차까지는 RTT > OUTLIER_RTT_MS 를 FALLBACK_RTT_MS(200)로 "낮춰" 치환했는데,
//    이는 꼬리를 통계에서 지워 느린 사용자만 첫 숫자를 잃게 만들던 원인이었다.
// 5. grace가 덮어야 하는 대상은 "가장 느린 클라이언트"이므로 필요한 통계량은
//    중앙값이 아니라 상위 분위수다. GRACE_PERCENTILE(p95)을 쓴다.
//    3회차의 median은 정의상 절반을 미달로 만들었다(꼬리 이중 제거).
// 6. startedAt = Date.now() + min(p95 * 2 + MARGIN, MAX_STARTUP_GRACE_MS)
//
// 단일 악성 클라이언트가 전원을 오래 대기시키지 못하게 하는 방어는
//   (a) OUTLIER_RTT_MS 상한 clamp — 아무리 느려도 500ms로 계산된다
//   (b) MAX_STARTUP_GRACE_MS cap
//   (c) 인원이 늘수록 p95가 단일 이상치를 흡수하는 성질
// 셋이 함께 맡는다. clamp 덕분에 grace 계산값은 500*2+200 = 1200ms를 넘지 않는다.
//
// 모듈 분리 의도: realtime.gateway에 협상 로직을 박지 않고 본 service에 격리.
// 향후 timeout/margin 조정, 알고리즘 교체 시 본 파일만 수정.

import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

/** probe 1건의 결과 — 무응답과 "응답했으나 규격 밖"을 구분한다. */
type ProbeOutcome =
  | { kind: 'ack'; rtt: number }
  | { kind: 'timeout' }
  | { kind: 'invalid' };

@Injectable()
export class ReadyNegotiationService {
  private readonly logger = new Logger(ReadyNegotiationService.name);

  // 한 명의 악성/극느림 클라이언트가 모두를 오래 대기시키지 않도록 RTT 상한.
  // 이 값을 넘는 RTT는 버리지 않고 이 값으로 clamp 한다.
  private static readonly OUTLIER_RTT_MS = 500;
  // probe 응답 마감. OUTLIER_RTT_MS 초과 응답은 어차피 clamp되므로 더 기다릴 이유가 없다.
  private static readonly PROBE_DEADLINE_MS =
    ReadyNegotiationService.OUTLIER_RTT_MS;
  // 응답은 왔지만 페이로드가 규격 밖이거나 emit 자체가 실패한 경우의 대체값.
  private static readonly FALLBACK_RTT_MS = 200;
  // startedAt 마진 — 클라이언트가 schedule 처리에 필요한 추가 시간
  private static readonly STARTUP_GRACE_MARGIN_MS = 200;
  // startedAt이 너무 먼 미래로 가지 않도록 cap
  private static readonly MAX_STARTUP_GRACE_MS = 1500;
  // grace 산출 분위수 — 꼬리를 덮는 것이 목적이므로 상위 분위수를 쓴다.
  private static readonly GRACE_PERCENTILE = 0.95;

  /**
   * 활성 클라이언트에 probe 후 startedAt 절대시각 결정.
   * SFC의 카운트다운 시작 클릭 시 1회 호출.
   * @param server Socket.io Server 인스턴스
   * @param authenticatedSocketIds 인증 완료된 socket.id 집합(gateway의 onlineMap).
   *        생략하거나 실제 소켓과 하나도 겹치지 않으면 전체 소켓으로 폴백한다.
   * @returns startedAt — Date.now() 기반 미래 절대시각
   */
  async negotiateStartedAt(
    server: Server,
    authenticatedSocketIds?: ReadonlySet<string>,
  ): Promise<number> {
    const sockets = ReadyNegotiationService.selectProbeTargets(
      server,
      authenticatedSocketIds,
    );
    if (sockets.length === 0) {
      // 접속자 없음 — 일관성 위해 마진만 적용
      return Date.now() + ReadyNegotiationService.STARTUP_GRACE_MARGIN_MS;
    }

    const outcomes = await Promise.all(
      sockets.map((sock) => this.probeOne(sock)),
    );
    const rtts = outcomes.map((o) => ReadyNegotiationService.toRtt(o));

    const tailRtt = ReadyNegotiationService.calcPercentile(
      rtts,
      ReadyNegotiationService.GRACE_PERCENTILE,
    );
    const ackCount = outcomes.filter((o) => o.kind === 'ack').length;

    const computed =
      tailRtt * 2 + ReadyNegotiationService.STARTUP_GRACE_MARGIN_MS;
    const grace = Math.min(
      computed,
      ReadyNegotiationService.MAX_STARTUP_GRACE_MS,
    );

    this.logger.log(
      `negotiateStartedAt: ${ackCount}/${sockets.length} ack, ` +
        `p${Math.round(ReadyNegotiationService.GRACE_PERCENTILE * 100)}Rtt=${tailRtt}ms, grace=${grace}ms`,
    );

    return Date.now() + grace;
  }

  /**
   * probe 대상 선별. 인증 소켓 집합이 주어지면 그 소켓만 남긴다.
   * 다만 handleConnection이 onlineMap에 넣기 전인 race 구간에서는 교집합이 빌 수
   * 있고, 그때 probe를 통째로 건너뛰면 grace가 MARGIN만 남아 오히려 퇴행한다.
   * 따라서 교집합이 비면 전체 소켓으로 폴백한다.
   */
  private static selectProbeTargets(
    server: Server,
    authenticatedSocketIds?: ReadonlySet<string>,
  ): any[] {
    const entries = Array.from(server.sockets.sockets.entries());
    const all = entries.map(([, sock]) => sock);
    if (!authenticatedSocketIds || authenticatedSocketIds.size === 0) {
      return all;
    }
    const authenticated = entries
      .filter(([id]) => authenticatedSocketIds.has(id))
      .map(([, sock]) => sock);
    return authenticated.length > 0 ? authenticated : all;
  }

  /** probe 결과를 grace 계산에 쓸 RTT로 변환. 규칙은 파일 상단 4번 참고. */
  private static toRtt(outcome: ProbeOutcome): number {
    switch (outcome.kind) {
      case 'ack':
        return Math.min(outcome.rtt, ReadyNegotiationService.OUTLIER_RTT_MS);
      case 'timeout':
        return ReadyNegotiationService.OUTLIER_RTT_MS;
      default:
        return ReadyNegotiationService.FALLBACK_RTT_MS;
    }
  }

  /**
   * nearest-rank 분위수. index = ceil(p * n) - 1 을 [0, n-1]로 clamp.
   * 빈 배열이면 FALLBACK_RTT_MS 반환.
   */
  private static calcPercentile(values: number[], percentile: number): number {
    if (values.length === 0) return ReadyNegotiationService.FALLBACK_RTT_MS;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil(percentile * sorted.length);
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
    return sorted[index];
  }

  /**
   * 단일 socket에 probe 후 RTT 측정.
   * socket.io v4의 sock.timeout().emit() 사용 — 자동 ack ID 정리로 메모리 누수 방지.
   * sentAt을 probeOne 내부에서 측정해 Promise.all 큐 처리 시간이 후순위 socket RTT에
   * 포함되지 않도록 함 (S1).
   */
  private probeOne(sock: any): Promise<ProbeOutcome> {
    return new Promise((resolve) => {
      // sentAt을 여기서 측정 — 큐 처리 지연이 RTT에 포함되지 않도록 (S1)
      const sentAt = Date.now();
      try {
        // socket.io v4 timeout API — timeout 시 내부 ack ID를 자동 정리해 메모리 누수 방지 (Q2)
        sock.timeout(ReadyNegotiationService.PROBE_DEADLINE_MS).emit(
          'time:probe',
          { sentAt },
          (err: Error | null, ack: unknown) => {
            if (err) {
              // 마감까지 응답 없음 — 상한(OUTLIER)으로 계산된다
              resolve({ kind: 'timeout' });
              return;
            }
            if (ack && typeof (ack as any).t === 'number') {
              resolve({ kind: 'ack', rtt: Date.now() - sentAt });
            } else {
              // 응답은 왔지만 페이로드가 규격 밖
              resolve({ kind: 'invalid' });
            }
          },
        );
      } catch {
        resolve({ kind: 'invalid' });
      }
    });
  }
}
