/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
// ready-negotiation.service.spec.ts
//
// 단계 5 ready 협상 모듈의 핵심 분기를 모두 검증.
// - probe 성공/timeout/예외 경로
// - 빈 sockets, 일부 timeout, 모두 timeout, 전부 성공
// - MAX_STARTUP_GRACE_MS cap
// - FALLBACK_RTT_MS 적용
// - outlier RTT > 500ms → FALLBACK_RTT 대체 (C2)
// - startedAt이 미래 절대시각 (Date.now() 기반) 인지

import type { Server } from 'socket.io';
import { ReadyNegotiationService } from './ready-negotiation.service';

// 내부 상수 (정상 동작 검증을 위해 ts 파일에서 동일하게 유지)
const PROBE_TIMEOUT_MS = 800;
const MARGIN_MS = 200;
const MAX_GRACE_MS = 1500;
const FALLBACK_RTT_MS = 200;
const OUTLIER_RTT_MS = 500;

// sock.timeout(ms).emit(event, payload, (err, ack) => ...) 패턴 mock
// socket.io v4 timeout API 시뮬레이션 — timeout 시 err != null으로 콜백 호출.
type TimeoutAckCb = (err: Error | null, ack?: unknown) => void;
interface MockOpts {
  /** ack 호출까지 시뮬레이션 지연(ms). null이면 ack 호출 안 함(timeout 유도) */
  ackDelayMs: number | null;
  /** ack에 보낼 값 (undefined이면 기본 { t: Date.now() }) */
  ackPayload?: unknown;
  /** timeout() 자체에서 throw (극단적 에러 케이스) */
  throws?: boolean;
}
function makeMockSocket(opts: MockOpts) {
  return {
    timeout: (timeoutMs: number) => ({
      emit: (_event: string, _payload: unknown, cb?: TimeoutAckCb) => {
        if (opts.throws) throw new Error('emit failed');
        if (opts.ackDelayMs === null) {
          // timeout 시뮬레이션 — PROBE_TIMEOUT_MS 후 err != null 콜백
          setTimeout(() => cb?.(new Error('timeout')), timeoutMs);
          return;
        }
        const payload =
          opts.ackPayload === undefined ? { t: Date.now() } : opts.ackPayload;
        if (opts.ackDelayMs === 0) {
          // 즉시 동기 호출
          cb?.(null, payload);
        } else {
          setTimeout(() => cb?.(null, payload), opts.ackDelayMs);
        }
      },
    }),
  };
}

function makeServer(sockets: any[]): Server {
  return {
    sockets: {
      sockets: new Map(sockets.map((s, i) => [String(i), s])),
    },
  } as unknown as Server;
}

describe('ReadyNegotiationService', () => {
  let svc: ReadyNegotiationService;

  beforeEach(() => {
    svc = new ReadyNegotiationService();
    // logger 출력 억제
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  });

  describe('빈 클라이언트 목록', () => {
    it('sockets 0개 → grace는 MARGIN_MS만 적용 (Date.now() + 200ms)', async () => {
      const before = Date.now();
      const startedAt = await svc.negotiateStartedAt(makeServer([]));
      const after = Date.now();
      // startedAt = Date.now() + 200ms 사이의 측정 윈도우 ± 약간 허용
      expect(startedAt).toBeGreaterThanOrEqual(before + MARGIN_MS);
      expect(startedAt).toBeLessThanOrEqual(after + MARGIN_MS + 5);
    });
  });

  describe('성공 경로', () => {
    it('단일 빠른 client (RTT~0ms) → grace ≈ MARGIN_MS', async () => {
      const sock = makeMockSocket({ ackDelayMs: 0 });
      const startedAt = await svc.negotiateStartedAt(makeServer([sock]));
      const after = Date.now();
      const grace = startedAt - after;
      // RTT 0 → 0*2 + 200 = 200, MAX cap 미적용. ack 동기 호출이므로 jitter 작음.
      expect(grace).toBeGreaterThanOrEqual(MARGIN_MS - 50);
      expect(grace).toBeLessThanOrEqual(MARGIN_MS + 50);
    });

    it('느린 client (200ms RTT) → grace ≈ 200*2 + 200 = 600ms (jitter ±200ms)', async () => {
      const sock = makeMockSocket({ ackDelayMs: 200 });
      const startedAt = await svc.negotiateStartedAt(makeServer([sock]));
      const after = Date.now();
      // grace = startedAt - (before + 측정시간) ≈ MaxRTT*2 + MARGIN.
      // 측정 RTT는 실제 ackDelay에 setTimeout jitter(Windows 최대 +50~150ms)를
      // 더한 값이라 grace는 600~900 사이에서 변동. 양방향으로 200ms 허용.
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(580 - 100);
      expect(grace).toBeLessThanOrEqual(680 + 300);
    });

    it('다수 client에서 maxRTT만 grace 결정에 영향', async () => {
      const fast = makeMockSocket({ ackDelayMs: 0 });
      const slow = makeMockSocket({ ackDelayMs: 150 });
      const startedAt = await svc.negotiateStartedAt(makeServer([fast, slow]));
      const after = Date.now();
      const grace = startedAt - after;
      // maxRTT ≈ 150 (fast는 즉시) → 150*2 + 200 = 500. jitter 허용.
      expect(grace).toBeGreaterThanOrEqual(480 - 100);
      expect(grace).toBeLessThanOrEqual(580 + 300);
    });
  });

  describe('FALLBACK_RTT_MS 적용 (timeout)', () => {
    it('단일 client timeout (ack 안 옴) → FALLBACK 200 적용 → grace = 200*2 + 200 = 600', async () => {
      const sock = makeMockSocket({ ackDelayMs: null });
      const before = Date.now();
      const startedAt = await svc.negotiateStartedAt(makeServer([sock]));
      const elapsed = Date.now() - before;
      // 측정: 협상 자체가 PROBE_TIMEOUT_MS = 800ms 동안 대기 후 fallback
      expect(elapsed).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS - 50);
      // grace = FALLBACK*2 + MARGIN = 600
      const actualGrace = startedAt - (before + elapsed);
      expect(actualGrace).toBeGreaterThanOrEqual(600 - 50);
      expect(actualGrace).toBeLessThanOrEqual(600 + 50);
    }, 5000);

    it('일부만 timeout: 빠른 80ms + 느린 timeout → maxRTT는 FALLBACK 200', async () => {
      const fast = makeMockSocket({ ackDelayMs: 80 });
      const slow = makeMockSocket({ ackDelayMs: null });
      const startedAt = await svc.negotiateStartedAt(makeServer([fast, slow]));
      const after = Date.now();
      const grace = startedAt - after;
      // 80 vs FALLBACK 200 → max = 200, grace = 200*2 + 200 = 600
      expect(grace).toBeGreaterThanOrEqual(600 - 50);
      expect(grace).toBeLessThanOrEqual(600 + 50);
    }, 5000);

    it('전부 timeout → 전부 FALLBACK → maxRTT = 200, grace = 600', async () => {
      const sockets = [
        makeMockSocket({ ackDelayMs: null }),
        makeMockSocket({ ackDelayMs: null }),
      ];
      const startedAt = await svc.negotiateStartedAt(makeServer(sockets));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(600 - 50);
      expect(grace).toBeLessThanOrEqual(600 + 50);
    }, 5000);
  });

  describe('MAX_STARTUP_GRACE_MS cap', () => {
    it('RTT 700ms 이상 → outlier(>500ms) 이므로 FALLBACK 200 대체 → grace = 600ms (cap 미적용)', async () => {
      // 700ms는 PROBE_TIMEOUT_MS(800) 이내 응답이지만 OUTLIER_RTT_MS(500) 초과.
      // outlier 컷오프로 FALLBACK_RTT(200)로 대체 → grace = 200*2 + 200 = 600ms (cap 미적용, C2).
      const outlier = makeMockSocket({ ackDelayMs: 700 });
      const startedAt = await svc.negotiateStartedAt(makeServer([outlier]));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(600 - 50);
      expect(grace).toBeLessThanOrEqual(600 + 50);
    }, 5000);

    it('빠른 client (450ms RTT) → outlier 미만이므로 그대로 사용 → 450*2 + 200 = 1100ms', async () => {
      // 450ms는 OUTLIER_RTT_MS(500) 미만이므로 정상 처리.
      // grace = 450*2 + 200 = 1100ms (MAX_GRACE 미초과).
      const slow = makeMockSocket({ ackDelayMs: 450 });
      const startedAt = await svc.negotiateStartedAt(makeServer([slow]));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(1050);
      expect(grace).toBeLessThanOrEqual(1200);
    }, 5000);
  });

  describe('이상 ack 처리', () => {
    it('ack가 invalid 형식 (t 필드 없음) → null 처리 → FALLBACK 적용', async () => {
      const sock = makeMockSocket({
        ackDelayMs: 50,
        ackPayload: { wrong: 'shape' },
      });
      const startedAt = await svc.negotiateStartedAt(makeServer([sock]));
      const after = Date.now();
      const grace = startedAt - after;
      // FALLBACK 200 적용 → grace = 600
      expect(grace).toBeGreaterThanOrEqual(550);
      expect(grace).toBeLessThanOrEqual(650);
    });

    it('ack가 null payload → null 처리 → FALLBACK', async () => {
      const sock = makeMockSocket({ ackDelayMs: 30, ackPayload: null });
      const startedAt = await svc.negotiateStartedAt(makeServer([sock]));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(550);
      expect(grace).toBeLessThanOrEqual(650);
    });

    it('socket.emit이 throw → null 처리 → FALLBACK', async () => {
      const sock = makeMockSocket({ ackDelayMs: 0, throws: true });
      const startedAt = await svc.negotiateStartedAt(makeServer([sock]));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(550);
      expect(grace).toBeLessThanOrEqual(650);
    });
  });

  describe('startedAt 단조성', () => {
    it('startedAt은 항상 Date.now()보다 미래', async () => {
      const sock = makeMockSocket({ ackDelayMs: 0 });
      const startedAt = await svc.negotiateStartedAt(makeServer([sock]));
      expect(startedAt).toBeGreaterThan(Date.now() - 1);
    });
  });

  describe('타임아웃 — socket.io v4 timeout API', () => {
    it('ackDelay > PROBE_TIMEOUT_MS → timeout API가 err!=null 콜백 → FALLBACK 적용, 협상 완료', async () => {
      // ackDelay = 1000ms (timeout 800ms 이후) — socket.io v4 timeout API가 800ms 후 err!=null 콜백 호출.
      // FALLBACK(200) 적용, 협상 정상 완료.
      const sock = makeMockSocket({ ackDelayMs: 1000 });
      const before = Date.now();
      const startedAt = await svc.negotiateStartedAt(makeServer([sock]));
      const elapsed = Date.now() - before;
      // PROBE_TIMEOUT 직후 종료 (FALLBACK 적용)
      expect(elapsed).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS - 50);
      expect(elapsed).toBeLessThanOrEqual(PROBE_TIMEOUT_MS + 400); // Windows jitter 허용
      // grace = FALLBACK*2 + MARGIN = 600
      const grace = startedAt - (before + elapsed);
      expect(grace).toBeGreaterThanOrEqual(600 - 50);
      expect(grace).toBeLessThanOrEqual(600 + 50);
    }, 5000);
  });

  describe('outlier RTT 컷오프 (C2)', () => {
    it(`RTT > ${OUTLIER_RTT_MS}ms → FALLBACK_RTT(${FALLBACK_RTT_MS}) 대체`, async () => {
      // 550ms = PROBE_TIMEOUT(800) 이내지만 OUTLIER_RTT_MS(500) 초과 → FALLBACK 적용.
      // grace = 200*2 + 200 = 600ms (MAX_GRACE cap 미적용).
      const outlier = makeMockSocket({ ackDelayMs: 550 });
      const startedAt = await svc.negotiateStartedAt(makeServer([outlier]));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(580 - 100);
      expect(grace).toBeLessThanOrEqual(650 + 100);
    }, 5000);

    it('정상 client(100ms) + outlier(600ms) → maxRTT = 100(outlier는 FALLBACK 200), grace = 200*2+200=600', async () => {
      const normal = makeMockSocket({ ackDelayMs: 100 });
      const outlier = makeMockSocket({ ackDelayMs: 600 });
      const startedAt = await svc.negotiateStartedAt(makeServer([normal, outlier]));
      const after = Date.now();
      const grace = startedAt - after;
      // maxRTT = max(100ms, FALLBACK 200ms) = 200ms → grace = 200*2+200 = 600ms
      expect(grace).toBeGreaterThanOrEqual(580 - 100);
      expect(grace).toBeLessThanOrEqual(650 + 200);
    }, 5000);
  });
});
