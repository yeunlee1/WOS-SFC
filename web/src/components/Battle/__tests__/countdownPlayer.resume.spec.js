// countdownPlayer.resume.spec.js — AudioContext 정지/재개와 개인 '출발' 슬롯의 절대예약 계약
//
// 검증 목적:
// 1) 자동재생 차단으로 resume() 이 pending 인 채 상한에 걸리면, 멈춘 ctx 클럭으로
//    앵커를 잡지 않는다(= 아무 것도 예약하지 않는다).
// 2) statechange 로 running 이 되면 그 시점의 클럭·벽시계로 남은 슬롯을 다시 예약한다.
//    재생 도중 정지된 경우 이미 지난 슬롯은 past-due 가드가 거른다.
// 3) iOS 의 'interrupted' 도 'suspended' 와 동일하게 다룬다.
// 4) 개인 출발('march')이 숫자와 같은 ctx 절대예약에 편입되고, 범위 밖 값은 예약되지 않는다.
// 5) 자동 출력지연 보정값을 ms 로 외부에 노출한다(개인 보정 UI 합산 표시용).
//
// 설계 메모:
// - countdownPlayer.js 는 모듈 싱글톤이라 매 it 마다 vi.resetModules 로 초기화한다.
// - Date.now 를 고정해 앵커 계산을 결정적으로 만든다. 정지 구간을 흉내 낼 때는
//   Date.now 만 진행시키고 ctx.currentTime 은 그대로 둔다(= ctx 클럭이 멈춘 상태).
// - 어떤 키가 예약됐는지 보려고 fetch URL → ArrayBuffer → 디코드 결과에 키를 실어 나른다.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const FIXED_NOW = 1_700_000_000_000;

let started;   // { when, key } 로 실제 예약된 목록
let lastCtx;   // 모듈이 생성한 FakeAudioContext 인스턴스

function setupAudioMocks({
  currentTime = 100,
  state = 'running',
  resumeMode = 'resolve',   // 'resolve' | 'pending'
  outputLatency,
  baseLatency,
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
      if (outputLatency !== undefined) this.outputLatency = outputLatency;
      if (baseLatency !== undefined) this.baseLatency = baseLatency;
      lastCtx = this;
    }
    addEventListener(type, fn) { if (type === 'statechange') this._listeners.push(fn); }
    removeEventListener(type, fn) {
      if (type !== 'statechange') return;
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    }
    /** 테스트에서 상태 전이를 흉내 낸다 — 실제 브라우저처럼 statechange 를 발화. */
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

/** 마이크로태스크 + 매크로태스크를 여러 번 비운다. */
async function flush(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

function whensOf(key) {
  return started.filter((s) => s.key === key).map((s) => s.when);
}

function numericWhens() {
  return started
    .filter((s) => /^\d+$/.test(s.key ?? ''))
    .map((s) => s.when)
    .sort((a, b) => a - b);
}

describe('countdownPlayer — AudioContext 정지/재개', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('자동재생 차단(resume pending)이면 멈춘 클럭으로 앵커를 잡지 않는다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'suspended', resumeMode: 'pending' });
    const { scheduleCountdown } = await import('../countdownPlayer');

    await scheduleCountdown({
      totalSeconds: 5,
      startedAt: FIXED_NOW + 3000,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
    });
    await flush();

    // 멈춘 ctx 클럭(100)으로 앵커를 잡으면 사용자가 나중에 화면을 터치한 순간
    // 카운트다운 전체가 그만큼 늦게 처음부터 재생된다. 예약 자체를 하지 않아야 한다.
    expect(started).toHaveLength(0);
  });

  it('suspended → running 전이 시 그 시점의 클럭으로 남은 슬롯을 다시 예약한다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'suspended', resumeMode: 'pending' });
    const { scheduleCountdown } = await import('../countdownPlayer');

    await scheduleCountdown({
      totalSeconds: 5,
      startedAt: FIXED_NOW + 3000,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
    });
    await flush();
    started.length = 0;

    // 정지 상태로 2초가 흐른다 — 벽시계만 진행하고 ctx 클럭은 100 에 멈춰 있다.
    Date.now.mockReturnValue(FIXED_NOW + 2000);
    lastCtx._setState('running');
    await flush();

    // 새 앵커 = ctx.currentTime + (startedAt - serverNow)/1000 = 100 + (3000-2000)/1000 = 101
    // 슬롯 n(5..1) → 101 + (5 - n)
    expect(numericWhens()).toEqual([101, 102, 103, 104, 105]);
  });

  it('재생 도중 정지됐다 재개되면 남은 슬롯만 새 절대시각으로 예약한다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'running' });
    const { scheduleCountdown } = await import('../countdownPlayer');

    // 앵커 = 100, 슬롯 n(10..1) → 100..109
    await scheduleCountdown({
      totalSeconds: 10,
      startedAt: FIXED_NOW,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
    });
    await flush();
    expect(numericWhens()).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    started.length = 0;

    // ctx 클럭이 103 까지 흐른 뒤 정지. 정지 상태로 벽시계만 4초 더 흐른다.
    lastCtx.currentTime = 103;
    lastCtx._setState('suspended');
    Date.now.mockReturnValue(FIXED_NOW + 7000);
    lastCtx._setState('running');
    await flush();

    // 새 앵커 = 103 + (0 - 7000)/1000 = 96 → 슬롯 96..105
    // past-due 가드(now=103, 임계 102.8)가 96~102 를 거르고 103,104,105 만 남는다.
    expect(numericWhens()).toEqual([103, 104, 105]);
  });

  it("iOS 'interrupted' 도 suspended 와 동일하게 다룬다", async () => {
    setupAudioMocks({ currentTime: 100, state: 'interrupted', resumeMode: 'pending' });
    const { scheduleCountdown } = await import('../countdownPlayer');

    await scheduleCountdown({
      totalSeconds: 5,
      startedAt: FIXED_NOW + 3000,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
    });
    await flush();
    expect(started).toHaveLength(0);

    Date.now.mockReturnValue(FIXED_NOW + 1000);
    lastCtx._setState('running');
    await flush();

    // 새 앵커 = 100 + (3000-1000)/1000 = 102
    expect(numericWhens()).toEqual([102, 103, 104, 105, 106]);
  });

  it('정지된 카운트다운은 재개돼도 되살아나지 않는다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'suspended', resumeMode: 'pending' });
    const { scheduleCountdown, stopCountdownAudio } = await import('../countdownPlayer');

    await scheduleCountdown({
      totalSeconds: 5,
      startedAt: FIXED_NOW + 3000,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
    });
    await flush();
    stopCountdownAudio();
    started.length = 0;

    lastCtx._setState('running');
    await flush();
    expect(started).toHaveLength(0);
  });
});

describe("countdownPlayer — 개인 출발('march') 절대예약", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marchSeconds 가 앵커 + (totalSeconds - marchSeconds) 시각에 예약된다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'running' });
    const { scheduleCountdown } = await import('../countdownPlayer');

    await scheduleCountdown({
      totalSeconds: 10,
      startedAt: FIXED_NOW,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
      marchSeconds: 4,
    });
    await flush();

    // 앵커 = 100. 남은 4초 시점 = 100 + (10 - 4) = 106
    expect(whensOf('march')).toEqual([106]);
  });

  it('march 도 숫자 슬롯과 같은 출력지연 보정을 받는다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'running', outputLatency: 0.25 });
    const { scheduleCountdown } = await import('../countdownPlayer');

    await scheduleCountdown({
      totalSeconds: 10,
      startedAt: FIXED_NOW + 1000,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
      marchSeconds: 4,
    });
    await flush();

    // 앵커 = 100 + 1 - 0.25 = 100.75 → march = 100.75 + 6 = 106.75
    expect(whensOf('march')).toEqual([106.75]);
    // 같은 앵커에서 나온 숫자 슬롯과의 간격이 정확히 유지된다
    expect(numericWhens()[0]).toBe(100.75);
  });

  it.each([
    ['미설정(null)', null],
    ['미설정(undefined)', undefined],
    ['0 (하한 밖)', 0],
    ['181 (상한 밖)', 181],
    ['소수', 3.5],
    ['문자열', '4'],
    ['totalSeconds 초과', 11],
  ])('marchSeconds 가 %s 이면 예약하지 않는다', async (_label, marchSeconds) => {
    setupAudioMocks({ currentTime: 100, state: 'running' });
    const { scheduleCountdown } = await import('../countdownPlayer');

    await scheduleCountdown({
      totalSeconds: 10,
      startedAt: FIXED_NOW,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
      marchSeconds,
    });
    await flush();

    expect(whensOf('march')).toEqual([]);
    // 숫자 슬롯은 정상 예약돼야 한다 — march 검증이 전체 실패로 위장되지 않도록
    expect(numericWhens()).toHaveLength(10);
  });

  it('marchSeconds 를 바꿔 다시 스케줄하면 새 시각으로만 예약된다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'running' });
    const { scheduleCountdown } = await import('../countdownPlayer');

    const base = {
      totalSeconds: 10,
      startedAt: FIXED_NOW,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
    };
    await scheduleCountdown({ ...base, marchSeconds: 4 });
    await flush();
    started.length = 0;

    await scheduleCountdown({ ...base, marchSeconds: 7 });
    await flush();

    expect(whensOf('march')).toEqual([103]); // 100 + (10 - 7)
  });

  it('재개 리스케줄에도 march 가 함께 실린다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'suspended', resumeMode: 'pending' });
    const { scheduleCountdown } = await import('../countdownPlayer');

    await scheduleCountdown({
      totalSeconds: 10,
      startedAt: FIXED_NOW + 3000,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
      marchSeconds: 4,
    });
    await flush();
    expect(started).toHaveLength(0);

    Date.now.mockReturnValue(FIXED_NOW + 1000);
    lastCtx._setState('running');
    await flush();

    // 새 앵커 = 100 + (3000-1000)/1000 = 102 → march = 102 + 6 = 108
    expect(whensOf('march')).toEqual([108]);
  });
});

describe('countdownPlayer — 자동 출력지연 보정값 노출', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AudioContext 생성 전에는 0 을 돌려준다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'running', outputLatency: 0.25 });
    const { getAutoLatencyMs } = await import('../countdownPlayer');
    expect(getAutoLatencyMs()).toBe(0);
  });

  it('outputLatency 를 ms 정수로 돌려준다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'running', outputLatency: 0.25 });
    const { primeCountdownAudio, getAutoLatencyMs } = await import('../countdownPlayer');
    await primeCountdownAudio([], 'ko');
    expect(getAutoLatencyMs()).toBe(250);
  });

  it('outputLatency 미지원이면 baseLatency 를 쓴다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'running', baseLatency: 0.04 });
    const { primeCountdownAudio, getAutoLatencyMs } = await import('../countdownPlayer');
    await primeCountdownAudio([], 'ko');
    expect(getAutoLatencyMs()).toBe(40);
  });

  it('상한(500ms)을 넘는 보고값은 상한으로 잘라 노출한다', async () => {
    setupAudioMocks({ currentTime: 100, state: 'running', outputLatency: 3 });
    const { primeCountdownAudio, getAutoLatencyMs } = await import('../countdownPlayer');
    await primeCountdownAudio([], 'ko');
    expect(getAutoLatencyMs()).toBe(500);
  });
});
