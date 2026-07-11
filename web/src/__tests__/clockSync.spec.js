// 시계 동기화 시작의 중복 방지와 종료 후 재시작을 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  getTime: vi.fn(async () => {
    const now = Date.now();
    return { utc: now, t1: now, t2: now };
  }),
}));

vi.mock('../api', () => ({
  api: { getTime: apiMocks.getTime },
  getSocket: () => null,
}));

import { shutdown, startup } from '../clockSync';

describe('clockSync lifecycle', () => {
  beforeEach(() => {
    shutdown();
    apiMocks.getTime.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    shutdown();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shares an in-flight startup and can restart after shutdown', async () => {
    const first = startup();
    const second = startup();
    expect(first).toBe(second);

    await vi.advanceTimersByTimeAsync(250);
    await Promise.all([first, second]);
    expect(apiMocks.getTime).toHaveBeenCalledTimes(3);

    await startup();
    expect(apiMocks.getTime).toHaveBeenCalledTimes(3);

    shutdown();
    const restarted = startup();
    await vi.advanceTimersByTimeAsync(250);
    await restarted;
    expect(apiMocks.getTime).toHaveBeenCalledTimes(6);
  });
});
