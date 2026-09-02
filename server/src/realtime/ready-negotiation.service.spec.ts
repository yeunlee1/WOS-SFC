/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
// ready-negotiation.service.spec.ts
//
// 단계 5 ready 협상 모듈의 핵심 분기를 모두 검증.
// - probe 성공/timeout/예외 경로
// - 빈 sockets, 일부 timeout, 모두 timeout, 전부 성공
// - MAX_STARTUP_GRACE_MS cap
// - FALLBACK_RTT_MS 적용
// - outlier RTT > 500ms → OUTLIER_RTT_MS 로 상한 clamp (4회차)
// - startedAt이 미래 절대시각 (Date.now() 기반) 인지
// - (4회차) p95 기반: 꼬리 클라이언트를 grace 가 덮는지 + 단일 악성 client 방어 유지
// - (4회차) 정족수 조기 확정: 무응답 소켓이 섞여도 PROBE_TIMEOUT 을 꽉 채우지 않는지

import type { Server } from 'socket.io';
import { ReadyNegotiationService } from './ready-negotiation.service';

// 내부 상수 (정상 동작 검증을 위해 ts 파일에서 동일하게 유지)
// 4회차: probe 마감이 OUTLIER_RTT_MS 와 같아졌다 (800 → 500).
// 마감을 넘긴 응답은 어차피 OUTLIER 로 clamp 되므로 더 기다려도 통계가 안 바뀐다.
const PROBE_DEADLINE_MS = 500;
const MARGIN_MS = 200;
const MAX_GRACE_MS = 1500;
const FALLBACK_RTT_MS = 200;
const OUTLIER_RTT_MS = 500;
// 무응답(timeout) 소켓의 계산값 = OUTLIER_RTT_MS → grace = 500*2+200
const TIMEOUT_GRACE_MS = OUTLIER_RTT_MS * 2 + MARGIN_MS;

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
          // 무응답 시뮬레이션 — 마감 시각에 err != null 콜백
          setTimeout(() => cb?.(new Error('timeout')), timeoutMs);
          return;
        }
        // socket.io v4 timeout API 충실 모사: ack 가 마감보다 늦으면 늦은 ack 를
        // 전달하지 않고 마감 시점에 err 콜백을 부른다.
        // (이전 mock 은 늦은 ack 를 그대로 성공 전달해서, '타임아웃 API' 테스트가
        //  실제로는 timeout 경로가 아니라 outlier 컷오프 경로를 검증하고 있었다.)
        if (opts.ackDelayMs > timeoutMs) {
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

    it('다수 client — 상위 분위수(p95) 기반 grace 결정', async () => {
      const fast = makeMockSocket({ ackDelayMs: 0 });
      const slow = makeMockSocket({ ackDelayMs: 150 });
      const startedAt = await svc.negotiateStartedAt(makeServer([fast, slow]));
      const after = Date.now();
      const grace = startedAt - after;
      // rtts = [~0ms, ~150ms] → p95(nearest-rank) = 150ms → grace = 150*2+200 = 500ms.
      // 느린 쪽을 덮어야 하므로 median(75 → 350ms)보다 커야 한다.
      expect(grace).toBeGreaterThanOrEqual(400);
      expect(grace).toBeLessThanOrEqual(880);
    });
  });

  // 4회차: 무응답 소켓은 FALLBACK(200)이 아니라 OUTLIER 상한(500)으로 계산된다.
  // 200으로 낮추면 "응답조차 못 한 가장 느린 클라이언트"가 통계에서 지워진다.
  describe('무응답(timeout) 처리', () => {
    it('단일 client timeout → OUTLIER(500) 적용 → grace = 500*2 + 200 = 1200', async () => {
      const sock = makeMockSocket({ ackDelayMs: null });
      const before = Date.now();
      const startedAt = await svc.negotiateStartedAt(makeServer([sock]));
      const elapsed = Date.now() - before;
      // 마감은 800ms가 아니라 PROBE_DEADLINE_MS(500ms)다.
      expect(elapsed).toBeGreaterThanOrEqual(PROBE_DEADLINE_MS - 50);
      expect(elapsed).toBeLessThan(800);
      const actualGrace = startedAt - (before + elapsed);
      expect(actualGrace).toBeGreaterThanOrEqual(TIMEOUT_GRACE_MS - 50);
      expect(actualGrace).toBeLessThanOrEqual(TIMEOUT_GRACE_MS + 50);
    }, 5000);

    it('일부만 timeout: 빠른 80ms + 느린 timeout → p95 = OUTLIER 500, grace = 1200ms', async () => {
      const fast = makeMockSocket({ ackDelayMs: 80 });
      const slow = makeMockSocket({ ackDelayMs: null });
      const startedAt = await svc.negotiateStartedAt(makeServer([fast, slow]));
      const after = Date.now();
      const grace = startedAt - after;
      // rtts = [~80ms, 500ms(무응답)] → p95 = 500 → grace = 1200ms.
      // FALLBACK 200으로 되돌리면 600ms가 되어 아래 하한에서 실패한다.
      expect(grace).toBeGreaterThanOrEqual(TIMEOUT_GRACE_MS - 50);
      expect(grace).toBeLessThanOrEqual(TIMEOUT_GRACE_MS + 50);
    }, 5000);

    it('전부 timeout → 전부 OUTLIER → grace = 1200', async () => {
      const sockets = [
        makeMockSocket({ ackDelayMs: null }),
        makeMockSocket({ ackDelayMs: null }),
      ];
      const startedAt = await svc.negotiateStartedAt(makeServer(sockets));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(TIMEOUT_GRACE_MS - 50);
      expect(grace).toBeLessThanOrEqual(TIMEOUT_GRACE_MS + 50);
    }, 5000);
  });

  describe('OUTLIER 상한 clamp 와 MAX_STARTUP_GRACE_MS cap', () => {
    it('RTT 700ms → OUTLIER_RTT_MS(500) 기준으로 계산 → grace = 500*2+200 = 1200ms', async () => {
      // 700ms는 마감(500ms)을 넘으므로 timeout 으로 잡히고, timeout 은 OUTLIER 로
      // 계산된다. 마감 전에 도착했더라도 clamp 되어 결과값은 같다 — 그래서 마감을
      // OUTLIER 까지만 두는 것이 정보 손실 없이 대기만 줄이는 선택이다.
      // 3회차는 이 클라이언트를 FALLBACK(200)으로 낮춰 grace 600ms 를 냈다.
      const outlier = makeMockSocket({ ackDelayMs: 700 });
      const startedAt = await svc.negotiateStartedAt(makeServer([outlier]));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(1200 - 50);
      expect(grace).toBeLessThanOrEqual(1200 + 50);
    }, 5000);

    it('clamp 덕분에 grace 는 MAX_STARTUP_GRACE_MS 를 넘지 않는다', async () => {
      // OUTLIER clamp(500) → 최대 computed = 500*2+200 = 1200 < MAX_GRACE(1500).
      // 즉 악성 클라이언트가 아무리 느려도 전체 대기는 상한 안에 갇힌다.
      const worst = [
        makeMockSocket({ ackDelayMs: 700 }),
        makeMockSocket({ ackDelayMs: 750 }),
      ];
      const startedAt = await svc.negotiateStartedAt(makeServer(worst));
      const grace = startedAt - Date.now();
      expect(grace).toBeLessThanOrEqual(MAX_GRACE_MS);
      expect(grace).toBeGreaterThanOrEqual(1100);
    }, 5000);

    it('단일 client 450ms RTT → p95 = 450ms → grace = 450*2+200 = 1100ms', async () => {
      // 450ms는 OUTLIER_RTT_MS(500) 미만이므로 clamp 미적용.
      // 단일 클라이언트면 p95 = 그 값 → grace = 450*2+200 = 1100ms (MAX_GRACE 미초과).
      const slow = makeMockSocket({ ackDelayMs: 450 });
      const startedAt = await svc.negotiateStartedAt(makeServer([slow]));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(1050);
      expect(grace).toBeLessThanOrEqual(1200);
    }, 5000);
  });

  // 응답 자체는 빠르게 왔는데 페이로드만 규격 밖인 경우.
  // 소켓이 살아 있고 빠르다는 증거가 있으므로 꼬리(OUTLIER)로 보지 않고 FALLBACK 을 쓴다.
  describe('이상 ack 처리', () => {
    it('ack가 invalid 형식 (t 필드 없음) → FALLBACK 적용 (OUTLIER 아님)', async () => {
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
    it('ackDelay > PROBE_DEADLINE_MS → timeout API가 err!=null 콜백 → OUTLIER 적용, 협상 완료', async () => {
      // ackDelay = 1000ms — socket.io v4 timeout API가 마감(500ms) 후 err!=null 콜백 호출.
      // timeout 은 OUTLIER(500)로 계산되어 grace = 1200ms.
      const sock = makeMockSocket({ ackDelayMs: 1000 });
      const before = Date.now();
      const startedAt = await svc.negotiateStartedAt(makeServer([sock]));
      const elapsed = Date.now() - before;
      // 마감 직후 종료
      expect(elapsed).toBeGreaterThanOrEqual(PROBE_DEADLINE_MS - 50);
      expect(elapsed).toBeLessThanOrEqual(PROBE_DEADLINE_MS + 400); // Windows jitter 허용
      const grace = startedAt - (before + elapsed);
      expect(grace).toBeGreaterThanOrEqual(TIMEOUT_GRACE_MS - 50);
      expect(grace).toBeLessThanOrEqual(TIMEOUT_GRACE_MS + 50);
    }, 5000);
  });

  describe('outlier RTT 상한 clamp (4회차)', () => {
    it(`RTT > ${OUTLIER_RTT_MS}ms → ${OUTLIER_RTT_MS}ms 로 clamp (${FALLBACK_RTT_MS}ms 로 낮추지 않는다)`, async () => {
      // 550ms = PROBE_TIMEOUT(800) 이내지만 OUTLIER_RTT_MS(500) 초과 → 500으로 clamp.
      // grace = 500*2 + 200 = 1200ms.
      const outlier = makeMockSocket({ ackDelayMs: 550 });
      const startedAt = await svc.negotiateStartedAt(makeServer([outlier]));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(1150);
      expect(grace).toBeLessThanOrEqual(1250);
    }, 5000);

    it('정상 client(100ms) + outlier(600ms) → p95 = clamp(600)=500, grace = 1200ms', async () => {
      const normal = makeMockSocket({ ackDelayMs: 100 });
      const outlier = makeMockSocket({ ackDelayMs: 600 });
      const startedAt = await svc.negotiateStartedAt(makeServer([normal, outlier]));
      const after = Date.now();
      const grace = startedAt - after;
      // rtts = [~100ms, 500ms(clamp)] → p95 = 500 → grace = 500*2+200 = 1200ms.
      // 2명뿐이라 꼬리가 곧 p95다. 인원이 늘면 아래 '단일 악성' 테스트처럼 희석된다.
      expect(grace).toBeGreaterThanOrEqual(1150);
      expect(grace).toBeLessThanOrEqual(1250);
    }, 5000);
  });

  // ── 4회차 핵심 계약 ────────────────────────────────────────────────────
  // grace가 실제로 결정하는 것은 "가장 느린 클라이언트가 첫 슬롯 전에 스케줄을
  // 끝냈는가" 하나뿐이다. 따라서 필요한 통계량은 중앙값이 아니라 상위 분위수다.
  // 아래 두 테스트는 서로 반대 방향을 고정한다.
  //   (1) 꼬리가 긴 분포 → grace가 꼬리를 덮어야 한다 (median으로 되돌리면 실패)
  //   (2) 인원이 충분할 때 단일 악성 클라이언트는 grace를 끌어올리지 못한다
  describe('p95 기반 grace (4회차)', () => {
    it('꼬리가 긴 분포(빠른 18 + 느린 2) → grace가 꼬리를 덮는다 — median이면 실패', async () => {
      // rtts ≈ [20ms × 18, 400ms × 2]
      //   median  = 20ms  → grace = 20*2+200  =  240ms  (꼬리 미달 — 느린 2명이 첫 숫자를 잃음)
      //   p95     = 400ms → grace = 400*2+200 = 1000ms  (꼬리를 덮음)
      const fasts = Array.from({ length: 18 }, () =>
        makeMockSocket({ ackDelayMs: 20 }),
      );
      const tails = Array.from({ length: 2 }, () =>
        makeMockSocket({ ackDelayMs: 400 }),
      );
      const startedAt = await svc.negotiateStartedAt(
        makeServer([...fasts, ...tails]),
      );
      const grace = startedAt - Date.now();
      // median(240ms)으로 되돌리면 아래 하한에서 실패한다.
      expect(grace).toBeGreaterThanOrEqual(900);
      expect(grace).toBeLessThanOrEqual(MAX_GRACE_MS);
    }, 10000);

    it('정상 19개(20ms) + 악성 1개(480ms) → p95가 악성값을 흡수, grace는 정상 RTT 기반', async () => {
      // 20개 중 1개만 느리므로 p95(nearest-rank index 18) 는 여전히 정상값이다.
      // 원래의 "단일 악성 클라이언트 방어" 의도가 p95에서도 유지되는지 고정한다.
      const normals = Array.from({ length: 19 }, () =>
        makeMockSocket({ ackDelayMs: 20 }),
      );
      const malicious = makeMockSocket({ ackDelayMs: 480 });
      const startedAt = await svc.negotiateStartedAt(
        makeServer([...normals, malicious]),
      );
      const grace = startedAt - Date.now();
      expect(grace).toBeGreaterThanOrEqual(200);
      expect(grace).toBeLessThanOrEqual(600);
    }, 10000);

    it('단일 클라이언트 450ms → p95 = 450ms → grace = 1100ms (단독이면 피할 수 없음)', async () => {
      // 단독 클라이언트일 때는 p95도 그 값이다. 알려진 한계 (1:1 환경).
      // 상한은 OUTLIER clamp(500) + MAX cap(1500)이 함께 막는다.
      const malicious = makeMockSocket({ ackDelayMs: 450 });
      const startedAt = await svc.negotiateStartedAt(makeServer([malicious]));
      const after = Date.now();
      const grace = startedAt - after;
      expect(grace).toBeGreaterThanOrEqual(1000);
      expect(grace).toBeLessThanOrEqual(MAX_GRACE_MS);
    }, 5000);
  });

  // ── 무응답 소켓 대기 시간 ──────────────────────────────────────────────
  // 무응답 소켓(미인증·좀비)이 한 개만 있어도 Promise.all 은 마감까지 꽉 기다린다.
  // SFC 클릭 → 카운트다운 시작까지의 순수 낭비 시간이므로 마감 자체를 줄였다.
  // 정족수(N%) 기반 조기 확정은 채택하지 않았다 — 먼저 잘려 나가는 것이 정확히
  // p95 가 덮어야 할 꼬리라서, 위 'p95 기반 grace' 계약과 정면으로 충돌한다.
  describe('무응답 소켓 대기 시간', () => {
    it('무응답 소켓이 섞여도 기존 800ms 를 꽉 기다리지 않는다', async () => {
      const responders = Array.from({ length: 9 }, () =>
        makeMockSocket({ ackDelayMs: 30 }),
      );
      const silent = makeMockSocket({ ackDelayMs: null });
      const before = Date.now();
      await svc.negotiateStartedAt(makeServer([...responders, silent]));
      const elapsed = Date.now() - before;

      // 마감은 PROBE_DEADLINE_MS(500). 800ms 로 되돌리면 아래 상한에서 실패한다.
      expect(elapsed).toBeLessThan(700);
      expect(elapsed).toBeGreaterThanOrEqual(PROBE_DEADLINE_MS - 50);
    }, 10000);

    it('무응답 소켓은 FALLBACK(200)이 아니라 OUTLIER(500)로 계산돼 꼬리가 지워지지 않는다', async () => {
      // rtts = [30ms × 9, 500ms(무응답)] → p95(index 9) = 500 → grace = 1200
      // FALLBACK 200 으로 되돌리면 p95 = 200 → grace = 600 이라 아래 하한에서 실패한다.
      const responders = Array.from({ length: 9 }, () =>
        makeMockSocket({ ackDelayMs: 30 }),
      );
      const silent = makeMockSocket({ ackDelayMs: null });
      const startedAt = await svc.negotiateStartedAt(
        makeServer([...responders, silent]),
      );
      const grace = startedAt - Date.now();
      expect(grace).toBeGreaterThanOrEqual(TIMEOUT_GRACE_MS - 50);
      expect(grace).toBeLessThanOrEqual(MAX_GRACE_MS);
    }, 10000);
  });

  // ── 인증된 소켓만 probe ────────────────────────────────────────────────
  describe('probe 대상 필터', () => {
    it('인증 소켓 id 집합을 주면 그 소켓에만 probe 한다', async () => {
      const authed = makeMockSocket({ ackDelayMs: 20 });
      const unauthed = makeMockSocket({ ackDelayMs: null });
      const server = {
        sockets: {
          sockets: new Map<string, any>([
            ['auth-1', authed],
            ['pending-1', unauthed],
          ]),
        },
      } as unknown as Server;

      const before = Date.now();
      await svc.negotiateStartedAt(server, new Set(['auth-1']));
      const elapsed = Date.now() - before;

      // 미인증 소켓을 probe 했다면 PROBE_TIMEOUT_MS(800)를 꽉 채웠을 것이다.
      expect(elapsed).toBeLessThan(300);
    }, 10000);

    it('인증 소켓 집합이 비어 있으면 전체 소켓으로 폴백한다', async () => {
      // handleConnection 이 아직 onlineMap 에 넣기 전인 race 구간에서
      // grace 가 MARGIN(200ms)만 남는 퇴행을 막는다.
      const sock = makeMockSocket({ ackDelayMs: 150 });
      const server = {
        sockets: { sockets: new Map<string, any>([['s0', sock]]) },
      } as unknown as Server;

      const startedAt = await svc.negotiateStartedAt(server, new Set<string>());
      const grace = startedAt - Date.now();
      // probe 를 실제로 했다면 grace = 150*2+200 = 500ms 수준이다.
      expect(grace).toBeGreaterThan(MARGIN_MS + 50);
    }, 10000);
  });
});
