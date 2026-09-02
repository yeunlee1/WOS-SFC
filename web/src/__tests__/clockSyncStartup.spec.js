// 첫 시계 동기화가 실패했을 때의 재시도와 "아직 동기화 안 됨" 상태 노출을 검증한다.
//
// 기존 startup()은 첫 syncTime()이 실패하면 재시도 경로가 없어 영구 미동기화 상태로
// 남았고, 스토어의 timeOffset 초기값 0이 "오차 0"과 구분되지 않아 UI가 성공처럼 보였다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  failing: true,
  getTime: vi.fn(),
}));

vi.mock('../api', () => ({
  api: { getTime: h.getTime },
  getSocket: () => null,
}));

async function loadModules() {
  vi.resetModules();
  const clockSync = await import('../clockSync');
  const { useStore } = await import('../store');
  return { ...clockSync, useStore };
}

describe('clockSync startup — 첫 동기화 실패 복구', () => {
  beforeEach(() => {
    h.failing = true;
    h.getTime.mockReset();
    h.getTime.mockImplementation(async () => {
      if (h.failing) throw new Error('network down');
      const now = Date.now();
      return { utc: now, t1: now, t2: now };
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('동기화 전 스토어 상태는 unsynced — timeOffset 0을 성공으로 오인할 수 없다', async () => {
    const { useStore } = await loadModules();
    expect(useStore.getState().timeSyncState).toBe('unsynced');
  });

  it('첫 동기화가 실패하면 상태를 노출하고 백오프 재시도 후 복구한다', async () => {
    const { startup, shutdown, useStore } = await loadModules();

    const started = startup();
    started.catch(() => {});

    // 첫 시도의 샘플이 모두 실패할 때까지 진행
    await vi.advanceTimersByTimeAsync(1000);
    expect(useStore.getState().timeSyncState).toBe('failed');
    expect(useStore.getState().timeSyncState).not.toBe('synced');
    const callsAfterFirstAttempt = h.getTime.mock.calls.length;
    expect(callsAfterFirstAttempt).toBeGreaterThan(0);

    // 네트워크 복구 → 백오프 만료 후 재시도가 성공해야 한다
    h.failing = false;
    await vi.advanceTimersByTimeAsync(5000);
    await started;

    expect(h.getTime.mock.calls.length).toBeGreaterThan(callsAfterFirstAttempt);
    expect(useStore.getState().timeSyncState).toBe('synced');
    shutdown();
  });

  it('shutdown() 은 재시도 루프를 멈추고 상태를 unsynced 로 되돌린다', async () => {
    const { startup, shutdown, useStore } = await loadModules();

    const started = startup();
    started.catch(() => {});

    // 실패가 이어지는 동안 재시도가 실제로 반복돼야 한다
    await vi.advanceTimersByTimeAsync(20_000);
    const callsBeforeShutdown = h.getTime.mock.calls.length;
    expect(callsBeforeShutdown).toBeGreaterThan(6);

    shutdown();
    expect(useStore.getState().timeSyncState).toBe('unsynced');

    // 정리 이후에는 진행 중이던 1회 시도분 외에 추가 호출이 없어야 한다
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.getTime.mock.calls.length - callsBeforeShutdown).toBeLessThanOrEqual(8);
  });
});
