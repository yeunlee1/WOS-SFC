// rallyGroupPlayer.resume.spec.js — 집결그룹 스케줄러의 AudioContext 정지/재개 계약
//
// 검증 목적:
// 1) 자동재생 차단으로 resume() 이 pending 이면 멈춘 ctx 클럭으로 앵커를 잡지 않는다.
//    (기존 구현은 상한 없이 await 해 스케줄 자체가 무기한 멈췄다)
// 2) statechange 로 running 이 되면 그 시점의 클럭·벽시계로 남은 슬롯을 다시 예약한다.
// 3) iOS 의 'interrupted' 도 'suspended' 와 동일하게 다룬다.
//
// 설계 메모: countdownPlayer.resume.spec.js 와 같은 FakeAudioContext 를 쓴다.
// 키 확인이 필요해 fetch URL → ArrayBuffer → 디코드 결과에 키를 실어 나른다.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const FIXED_NOW = 1_700_000_000_000;

let started;
let lastCtx;

function setupAudioMocks({
  currentTime = 100,
  state = 'running',
  resumeMode = 'resolve',
} = {}) {
  started = [];
  lastCtx = null;

  const arrToKey = new WeakMap();
  global.fetch = vi.fn((url) => {
    const key = decodeURIComponent(String(url).split('/').pop());
    const buf = new ArrayBuffer(8);
    arrToKey.set(buf, key);
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
  });

  class FakeAudioContext {
    constructor() {
      this.currentTime = currentTime;
      this.state = state;
      this.destination = {};
      this._listeners = [];
      lastCtx = this;
    }
    addEventListener(type, fn) { if (type === 'statechange') this._listeners.push(fn); }
    removeEventListener(type, fn) {
      if (type !== 'statechange') return;
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    }
    _setState(next) {
      this.state = next;
      for (const fn of [...this._listeners]) fn({ target: this });
    }
    createGain() {
      return {
        gain: { value: 0.3, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() },
        connect: vi.fn(),
      };
    }
    createAnalyser() { return { fftSize: 0, connect: vi.fn() }; }
    createBuffer() { return {}; }
    createBufferSource() {
      const src = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        stop: vi.fn(),
        onended: null,
        start: vi.fn((when) => { started.push({ when, key: src.buffer?.__key }); }),
      };
      return src;
    }
    decodeAudioData = vi.fn((arr) => Promise.resolve({
      numberOfChannels: 1,
      duration: 0.9,
      __key: arrToKey.get(arr),
    }));
    resume = vi.fn(() => {
      if (resumeMode === 'pending') return new Promise(() => { /* 영원히 pending */ });
      this._setState('running');
      return Promise.resolve();
    });
  }

  window.AudioContext = FakeAudioContext;
  delete window.webkitAudioContext;
}

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

function whensOf(key) {
  return started.filter((s) => s.key === key).map((s) => s.when);
}

const FIRE_OFFSETS = [
  { orderIndex: 1, offsetMs: 0, userId: 11 },
  { orderIndex: 2, offsetMs: 6000, userId: 12 },
];

describe('rallyGroupPlayer — AudioContext 정지/재개', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('자동재생 차단(resume pending)이면 멈춘 클럭으로 앵커를 잡지 않는다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'suspended', resumeMode: 'pending' });
    const { scheduleRallyCountdown } = await import('../rallyGroupPlayer');

    // 기존 구현은 상한 없이 `await c.resume()` 해 스케줄 자체가 무기한 멈췄다.
    // "예약이 0건"만 보면 그 무기한 정지도 통과하므로 스케줄이 실제로 끝났는지 함께 본다.
    const outcome = await Promise.race([
      scheduleRallyCountdown({
        startedAtServerMs: FIXED_NOW + 8000,
        fireOffsets: FIRE_OFFSETS,
        timeOffset: 0,
        lang: 'ko',
        volume: 0.3,
        muted: false,
      }).then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('hung'), 1500)),
    ]);
    await flush();

    expect(outcome).toBe('settled');
    expect(started).toHaveLength(0);
  });

  it('suspended → running 전이 시 그 시점의 클럭으로 남은 슬롯을 다시 예약한다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'suspended', resumeMode: 'pending' });
    const { scheduleRallyCountdown } = await import('../rallyGroupPlayer');

    await Promise.race([
      scheduleRallyCountdown({
        startedAtServerMs: FIXED_NOW + 8000,
        fireOffsets: FIRE_OFFSETS,
        timeOffset: 0,
        lang: 'ko',
        volume: 0.3,
        muted: false,
      }),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    await flush();
    started.length = 0;

    // 정지 상태로 3초가 흐른다 — 벽시계만 진행하고 ctx 클럭은 100 에 멈춰 있다.
    Date.now.mockReturnValue(FIXED_NOW + 3000);
    lastCtx._setState('running');
    await flush();

    // 새 앵커 = 100 + (8000-3000)/1000 = 105
    expect(whensOf('3')).toEqual([102]);   // anchor - 3
    expect(whensOf('2')).toEqual([103]);
    expect(whensOf('1')).toEqual([104]);
    expect(whensOf('captain_1')).toEqual([105]);
    expect(whensOf('captain_2')).toEqual([111]);
  });

  it("iOS 'interrupted' 도 suspended 와 동일하게 다룬다", async () => {
    setupAudioMocks({ currentTime: 100, state: 'interrupted', resumeMode: 'pending' });
    const { scheduleRallyCountdown } = await import('../rallyGroupPlayer');

    await Promise.race([
      scheduleRallyCountdown({
        startedAtServerMs: FIXED_NOW + 8000,
        fireOffsets: FIRE_OFFSETS,
        timeOffset: 0,
        lang: 'ko',
        volume: 0.3,
        muted: false,
      }),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    await flush();
    expect(started).toHaveLength(0);

    Date.now.mockReturnValue(FIXED_NOW + 3000);
    lastCtx._setState('running');
    await flush();
    expect(whensOf('captain_1')).toEqual([105]);
  });

  it('정지된 카운트다운은 재개돼도 되살아나지 않는다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'suspended', resumeMode: 'pending' });
    const { scheduleRallyCountdown, stopRallyCountdown } = await import('../rallyGroupPlayer');

    await Promise.race([
      scheduleRallyCountdown({
        startedAtServerMs: FIXED_NOW + 8000,
        fireOffsets: FIRE_OFFSETS,
        timeOffset: 0,
        lang: 'ko',
        volume: 0.3,
        muted: false,
      }),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    await flush();
    stopRallyCountdown();
    started.length = 0;

    lastCtx._setState('running');
    await flush();
    expect(started).toHaveLength(0);
  });
});
