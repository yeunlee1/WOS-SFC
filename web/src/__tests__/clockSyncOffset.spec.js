// 비대칭 네트워크 지연 조건에서 clockSync의 NTP offset 계산값을 수치로 검증한다.
//
// 기존 clockSync.spec.js는 t0=t1=t2=t3(지연 0) 이라 offset 수식의 부호를 뒤집어도
// 통과했다. 본 파일은 상행≠하행 지연과 0이 아닌 서버 처리시간(t2-t1>0)을 주입해
// timeOffset 값 자체를 assert 한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_CLOCK_MS = 1_700_000_000_000;

// vi.mock 은 hoist 되므로 mock 구현이 참조할 상태도 hoist 해 둔다.
const h = vi.hoisted(() => ({
  clock: { now: 0 },
  scripts: [],
  calls: 0,
  getTime: vi.fn(),
}));

vi.mock('../api', () => ({
  api: { getTime: h.getTime },
  getSocket: () => null,
}));

/**
 * 한 샘플의 네트워크 시나리오.
 * @typedef {{up:number, proc:number, down:number, offset:number}} SampleScript
 * - up:     클라이언트→서버 상행 지연(ms)
 * - proc:   서버 처리시간(ms) — t2-t1
 * - down:   서버→클라이언트 하행 지연(ms)
 * - offset: 서버 시계가 클라이언트보다 앞선 실제 값(ms)
 */

/** 스크립트를 순환하며 소비하는 /time 응답 모의. 호출할 때마다 가상 시계를 전진시킨다. */
function installGetTime() {
  h.getTime.mockImplementation(async () => {
    const s = h.scripts[h.calls % h.scripts.length];
    h.calls += 1;
    h.clock.now += s.up; // 상행 지연 경과
    const t1 = h.clock.now + s.offset; // 서버가 요청을 받은 서버 기준 시각
    h.clock.now += s.proc; // 서버 처리시간 경과
    const t2 = h.clock.now + s.offset; // 서버가 응답을 보낸 서버 기준 시각
    h.clock.now += s.down; // 하행 지연 경과 → 호출자가 읽는 t3에 반영
    return { utc: t2, t1, t2 };
  });
}

/** syncTime()을 호출하고 샘플 간 대기 타이머를 모두 소진시킨다. */
async function runSync(syncTime) {
  const p = syncTime();
  await vi.advanceTimersByTimeAsync(5000);
  return p;
}

async function loadModules() {
  vi.resetModules();
  const clockSync = await import('../clockSync');
  const { useStore } = await import('../store');
  return { ...clockSync, useStore };
}

describe('clockSync offset 계산 — 비대칭 지연', () => {
  beforeEach(() => {
    h.clock.now = BASE_CLOCK_MS;
    h.calls = 0;
    h.scripts = [];
    h.getTime.mockReset();
    installGetTime();
    // setTimeout만 가짜로 만들고 Date는 직접 스파이해 시각을 완전히 통제한다.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Date, 'now').mockImplementation(() => h.clock.now);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('상행 40ms / 처리 30ms / 하행 160ms, 실제 오차 +250ms → offset 190ms, rtt 200ms', async () => {
    const { syncTime, useStore } = await loadModules();
    // NTP 추정치 = 실제 오차 + (상행 - 하행)/2 = 250 + (40-160)/2 = 190
    // RTT = (상행+처리+하행) - 처리 = 200
    h.scripts = [{ up: 40, proc: 30, down: 160, offset: 250 }];

    const result = await runSync(syncTime);

    expect(result.offset).toBe(190);
    expect(result.rtt).toBe(200);
    expect(useStore.getState().timeOffset).toBe(190);
    expect(useStore.getState().timeSyncRtt).toBe(200);
  });

  it('부호가 뒤집힌 수식으로는 통과할 수 없다 — 서버가 뒤처지면 offset도 음수', async () => {
    const { syncTime, useStore } = await loadModules();
    // 실제 오차 -800ms(서버가 느림), 상행 20 / 하행 120 → -800 + (20-120)/2 = -850
    h.scripts = [{ up: 20, proc: 10, down: 120, offset: -800 }];

    const result = await runSync(syncTime);

    expect(result.offset).toBe(-850);
    expect(useStore.getState().timeOffset).toBe(-850);
  });

  it('RTT가 가장 작은 샘플을 채택한다 (평균이나 첫 샘플이 아님)', async () => {
    const { syncTime, useStore } = await loadModules();
    h.scripts = [
      { up: 200, proc: 20, down: 400, offset: 300 }, // rtt 600, 추정 200
      { up: 30, proc: 10, down: 40, offset: 300 }, // rtt  70, 추정 295 ← 채택
      { up: 500, proc: 50, down: 100, offset: 300 }, // rtt 600, 추정 500
    ];

    const result = await runSync(syncTime);

    expect(result.rtt).toBe(70);
    expect(result.offset).toBe(295);
    expect(useStore.getState().timeOffset).toBe(295);
  });

  it('첫 샘플의 편향이 영구 고정되지 않는다 — 재동기화가 실측값으로 수렴', async () => {
    const { syncTime, useStore } = await loadModules();
    // 1차: 비대칭이 큰 경로 → 190ms 로 편향된 추정
    h.scripts = [{ up: 40, proc: 30, down: 160, offset: 250 }];
    await runSync(syncTime);
    expect(useStore.getState().timeOffset).toBe(190);

    // 2차 이후: 대칭 경로에서 실측 220ms — 기존 추정과의 차이는 30ms(구 데드밴드 50ms 미만)
    h.scripts = [{ up: 50, proc: 10, down: 50, offset: 220 }];

    await runSync(syncTime);
    // 데드밴드가 있으면 여기서 값이 전혀 움직이지 않는다.
    expect(useStore.getState().timeOffset).not.toBe(190);

    for (let i = 0; i < 8; i++) await runSync(syncTime);
    // EMA 가중치와 무관하게 반복 동기화는 실측값으로 수렴해야 한다.
    expect(Math.abs(useStore.getState().timeOffset - 220)).toBeLessThan(5);
  });

  it('shutdown() 이후 첫 동기화는 다시 100% 채택된다', async () => {
    const { syncTime, shutdown, useStore } = await loadModules();
    h.scripts = [{ up: 50, proc: 10, down: 50, offset: 1000 }];
    await runSync(syncTime);
    expect(useStore.getState().timeOffset).toBe(1000);

    shutdown(); // 로그아웃 — 다음 로그인의 첫 동기화는 스무딩 없이 채택돼야 한다

    h.scripts = [{ up: 50, proc: 10, down: 50, offset: 1030 }];
    await runSync(syncTime);
    expect(useStore.getState().timeOffset).toBe(1030);
  });
});
