// countdownPlayer.spec.js — 카운트다운 TTS 동기화 정밀도 수치 검증
//
// 검증 목적 (이 저장소에 동기화 정밀도를 수치로 검증하는 테스트가 0건이었다):
// 1) 절대 예약 — 각 슬롯이 `src.start(when)` 으로 예약되고, when 이
//    "서버 절대시각 - serverNow" 를 ctx.currentTime 에 더한 값과 정확히 일치하는가.
//    timeOffset 을 0 이 아닌 값(부호 포함)으로 넣어 offset 수식의 부호 뒤집기를 잡는다.
// 2) past-due — 예정 시각이 이미 지난 슬롯은 재생되지 않는가.
//    (버퍼가 늦게 도착한 경우 포함 — "27 뒤에 30이 끼어드는" 순서 역전 회귀 방지)
// 3) 출력 지연 보정 — ctx.outputLatency / ctx.baseLatency 만큼 예약 시각이 앞당겨지는가.
// 4) mp3 fetch 가 `cache: 'no-cache'` 로 매 요청 재검증을 강제하지 않는가.
//
// 설계 메모:
// - countdownPlayer.js 는 모듈 레벨 싱글톤(ctx, bufferCache 등)이라 매 it 마다
//   vi.resetModules 로 초기화한다. window.AudioContext 와 global.fetch 도 매번 재설정.
// - Date.now 를 고정해 앵커 계산을 결정적으로 만든다. 고정하지 않으면 await 구간의
//   실제 경과 시간이 기대값에 섞여 수 ms 오차가 난다.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const FIXED_NOW = 1_700_000_000_000;

// 테스트별 상태
let started;        // src.start(when) 로 실제 예약된 목록
let lastCtx;        // 모듈이 생성한 FakeAudioContext 인스턴스
let releaseDecode;  // manualDecode 모드에서 대기 중인 decodeAudioData 를 일괄 해제

function setupAudioMocks({ currentTime = 100, outputLatency, baseLatency, manualDecode = false } = {}) {
  started = [];
  lastCtx = null;
  const decodedBuffer = { numberOfChannels: 1, duration: 0.9 };

  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  }));

  const pendingDecodes = [];
  releaseDecode = () => { for (const r of pendingDecodes.splice(0)) r(decodedBuffer); };

  class FakeAudioContext {
    constructor() {
      this.currentTime = currentTime;
      this.state = 'running';
      this.destination = {};
      // 미지원 브라우저 재현을 위해 undefined 일 때는 속성 자체를 만들지 않는다.
      if (outputLatency !== undefined) this.outputLatency = outputLatency;
      if (baseLatency !== undefined) this.baseLatency = baseLatency;
      lastCtx = this;
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
        start: vi.fn((when) => { started.push({ when, src }); }),
      };
      return src;
    }
    decodeAudioData = vi.fn(() => (
      manualDecode
        ? new Promise((r) => pendingDecodes.push(r))
        : Promise.resolve(decodedBuffer)
    ));
    resume = vi.fn(() => Promise.resolve());
  }

  window.AudioContext = FakeAudioContext;
  delete window.webkitAudioContext;
}

/** 마이크로태스크 큐를 여러 번 비운다 — schedulePlay 는 buffer.then 체인을 탄다. */
async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/** 예약된 when 목록을 오름차순으로 */
function scheduledWhens() {
  return started.map((s) => s.when).sort((a, b) => a - b);
}

describe('countdownPlayer — Web Audio 절대 예약', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('각 슬롯이 src.start(when) 절대 시각으로 예약된다 (timeOffset=0)', async () => {
    setupAudioMocks({ currentTime: 100 });
    const { scheduleCountdown } = await import('../countdownPlayer');

    const totalSeconds = 5;
    const startedAt = FIXED_NOW + 3000; // 3초 뒤 시작

    await scheduleCountdown({
      totalSeconds,
      startedAt,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
    });
    await flush();

    // ctxAnchor = currentTime + (startedAt - serverNow)/1000 = 100 + 3 = 103
    // 슬롯 n 은 anchor + (totalSeconds - n) 초에 발화
    expect(scheduledWhens()).toEqual([103, 104, 105, 106, 107]);
    // setTimeout → start(0) 방식이면 when 이 전부 0 이 된다 — 그 회귀를 직접 차단
    expect(started.every((s) => s.when > 0)).toBe(true);
  });

  it('timeOffset 이 음수여도 서버 절대시각과 일치한다 (부호 뒤집기 검출)', async () => {
    setupAudioMocks({ currentTime: 100 });
    const { scheduleCountdown } = await import('../countdownPlayer');

    const totalSeconds = 3;
    const timeOffset = -1234;          // 클라 시계가 서버보다 1.234초 빠름
    const startedAt = FIXED_NOW + 3000;
    // serverNow = FIXED_NOW - 1234 → (startedAt - serverNow)/1000 = 4.234
    const expectedAnchor = 100 + 4.234;

    await scheduleCountdown({
      totalSeconds,
      startedAt,
      timeOffset,
      lang: 'ko',
      volume: 0.3,
      muted: false,
    });
    await flush();

    const whens = scheduledWhens();
    expect(whens.length).toBe(3);
    // 부호를 뒤집으면 anchor 가 100 + 1.766 이 되어 전부 어긋난다
    expect(whens[0]).toBeCloseTo(expectedAnchor, 6);
    expect(whens[1]).toBeCloseTo(expectedAnchor + 1, 6);
    expect(whens[2]).toBeCloseTo(expectedAnchor + 2, 6);
  });

  it('슬롯 예약 시각이 서버 절대시각 공식과 1:1 대응한다', async () => {
    setupAudioMocks({ currentTime: 42.5 });
    const { scheduleCountdown } = await import('../countdownPlayer');

    const totalSeconds = 6;
    const timeOffset = 777;
    const startedAt = FIXED_NOW + 5000;
    const serverNow = FIXED_NOW + timeOffset;

    await scheduleCountdown({
      totalSeconds, startedAt, timeOffset, lang: 'ko', volume: 0.3, muted: false,
    });
    await flush();

    const expected = [];
    for (let n = totalSeconds; n >= 1; n--) {
      const playServerTime = startedAt + (totalSeconds - n) * 1000;
      expected.push(42.5 + (playServerTime - serverNow) / 1000);
    }
    expected.sort((a, b) => a - b);

    const whens = scheduledWhens();
    expect(whens.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(whens[i]).toBeCloseTo(expected[i], 6);
    }
  });

  it('첫 슬롯은 totalSeconds 부터 시작한다 (기존 고유 동작 유지)', async () => {
    setupAudioMocks({ currentTime: 0 });
    const { scheduleCountdown } = await import('../countdownPlayer');

    await scheduleCountdown({
      totalSeconds: 4, startedAt: FIXED_NOW + 2000, timeOffset: 0,
      lang: 'ko', volume: 0.3, muted: false,
    });
    await flush();

    const fetched = global.fetch.mock.calls.map(([url]) => url);
    expect(fetched).toContain('/tts-audio/ko/4');
    expect(fetched).toContain('/tts-audio/ko/1');
    expect(fetched).not.toContain('/tts-audio/ko/0');
    // 4개 슬롯(4,3,2,1)이 모두 예약
    expect(started.length).toBe(4);
  });

  it('suspended 상태면 resume 이후의 ctx.currentTime 으로 앵커를 잡는다', async () => {
    // 절대 예약은 ctx 클럭 기준이라 suspended 상태에서 앵커를 잡으면(그때 currentTime은
    // 멈춰 있다) 재개 이후 전 슬롯이 통째로 밀린다. resume 이 끝난 뒤의 시각으로 잡아야 한다.
    setupAudioMocks({ currentTime: 0 });
    // resume 이 50ms 뒤에 완료되면서 클럭이 50초 지점에서 다시 흐르기 시작하는 상황
    const Ctx = window.AudioContext;
    window.AudioContext = class extends Ctx {
      constructor() {
        super();
        this.state = 'suspended';
        this.resume = vi.fn(() => new Promise((r) => setTimeout(() => {
          this.state = 'running';
          this.currentTime = 50;
          r();
        }, 50)));
      }
    };

    const { scheduleCountdown } = await import('../countdownPlayer');
    await scheduleCountdown({
      totalSeconds: 3, startedAt: FIXED_NOW + 3000, timeOffset: 0,
      lang: 'ko', volume: 0.3, muted: false,
    });
    await flush();

    // resume 전 시각(0)으로 잡으면 3, resume 후 시각(50)으로 잡으면 53
    expect(scheduledWhens()[0]).toBeCloseTo(53, 6);
  });

  it('totalSeconds < 2 이면 아무것도 예약하지 않는다 (0 키 404 가드 유지)', async () => {
    setupAudioMocks({ currentTime: 0 });
    const { scheduleCountdown } = await import('../countdownPlayer');

    await scheduleCountdown({
      totalSeconds: 1, startedAt: FIXED_NOW + 1000, timeOffset: 0,
      lang: 'ko', volume: 0.3, muted: false,
    });
    await flush();

    expect(started.length).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('countdownPlayer — past-due 가드', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('예정 시각이 이미 지난 슬롯은 재생하지 않는다', async () => {
    setupAudioMocks({ currentTime: 100 });
    const { scheduleCountdown } = await import('../countdownPlayer');

    const totalSeconds = 5;
    const startedAt = FIXED_NOW - 3000; // 3초 전에 시작된 카운트다운에 뒤늦게 합류
    // ctxAnchor = 100 - 3 = 97
    // 슬롯: 5@97, 4@98, 3@99, 2@100, 1@101 — now=100, 허용 하한 99.8
    await scheduleCountdown({
      totalSeconds, startedAt, timeOffset: 0, lang: 'ko', volume: 0.3, muted: false,
    });
    await flush();

    const whens = scheduledWhens();
    // 97, 98, 99 는 스킵되어야 한다
    expect(whens.every((w) => w >= 99.8)).toBe(true);
    expect(whens).toEqual([100, 101]);
  });

  it('버퍼가 늦게 도착해도 예정 시각이 지났으면 재생하지 않는다 (순서 역전 회귀)', async () => {
    // 콜드캐시 LTE 재현 — 스케줄 시점에는 버퍼가 없고, decode 가 늦게 끝난다.
    // 그 사이 ctx.currentTime 이 흘러 모든 슬롯이 past-due 가 되면 단 하나도
    // 재생되면 안 된다. 시각 검사 없이 세대(myId)만 보면 여기서 전부 터진다.
    setupAudioMocks({ currentTime: 100, manualDecode: true });
    const { scheduleCountdown } = await import('../countdownPlayer');

    const totalSeconds = 5;
    const startedAt = FIXED_NOW + 500; // anchor = 100.5, 슬롯 100.5~104.5

    await scheduleCountdown({
      totalSeconds, startedAt, timeOffset: 0, lang: 'ko', volume: 0.3, muted: false,
    });
    await flush();
    // 아직 디코드 전이므로 아무것도 예약되지 않음
    expect(started.length).toBe(0);

    // 오디오 시계가 10초 흘렀다 — 모든 슬롯이 과거
    lastCtx.currentTime = 110;
    releaseDecode();
    // setTimeout 기반 구현이 슬롯을 발화할 만큼 충분히 기다린다.
    // (구 구현은 fireAt=500ms 로 타이머를 걸어 두므로 여기서 start(0) 이 터진다.)
    await new Promise((r) => setTimeout(r, 700));
    await flush();

    expect(started.length).toBe(0);
  });

  it('늦게 도착해도 아직 미래인 슬롯은 정상 예약된다', async () => {
    setupAudioMocks({ currentTime: 100, manualDecode: true });
    const { scheduleCountdown } = await import('../countdownPlayer');

    const totalSeconds = 5;
    const startedAt = FIXED_NOW + 500; // anchor = 100.5 → 슬롯 100.5, 101.5, 102.5, 103.5, 104.5

    await scheduleCountdown({
      totalSeconds, startedAt, timeOffset: 0, lang: 'ko', volume: 0.3, muted: false,
    });
    await flush();

    lastCtx.currentTime = 102.6; // 100.5, 101.5 는 과거, 102.5 는 허용 오차(0.2) 안
    releaseDecode();
    await flush();

    const whens = scheduledWhens();
    // 102.5 는 now(102.6)로 당겨 즉시 재생, 103.5 / 104.5 는 예약 시각 그대로
    expect(whens.length).toBe(3);
    expect(whens[0]).toBeCloseTo(102.6, 6);
    expect(whens[1]).toBeCloseTo(103.5, 6);
    expect(whens[2]).toBeCloseTo(104.5, 6);
  });
});

describe('countdownPlayer — 출력 지연(outputLatency) 보정', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function firstWhen(mockOpts) {
    setupAudioMocks({ currentTime: 100, ...mockOpts });
    const { scheduleCountdown } = await import('../countdownPlayer');
    await scheduleCountdown({
      totalSeconds: 3, startedAt: FIXED_NOW + 3000, timeOffset: 0,
      lang: 'ko', volume: 0.3, muted: false,
    });
    await flush();
    return scheduledWhens()[0];
  }

  it('outputLatency(0.25s) 만큼 예약 시각을 앞당긴다 — 블루투스 이어버드', async () => {
    // 보정 없음 = 103, 보정 있음 = 102.75
    expect(await firstWhen({ outputLatency: 0.25 })).toBeCloseTo(102.75, 6);
  });

  it('outputLatency 미지원 시 baseLatency 로 보정한다', async () => {
    expect(await firstWhen({ baseLatency: 0.02 })).toBeCloseTo(102.98, 6);
  });

  it('outputLatency / baseLatency 둘 다 없으면 보정 0', async () => {
    expect(await firstWhen({})).toBeCloseTo(103, 6);
  });

  it('outputLatency 가 0 이면 baseLatency 로 폴백한다', async () => {
    // Chrome 은 렌더 시작 전 outputLatency=0 을 보고하는 구간이 있다.
    expect(await firstWhen({ outputLatency: 0, baseLatency: 0.02 })).toBeCloseTo(102.98, 6);
  });

  it('음수 outputLatency 는 무시한다 (비정상 값 방어)', async () => {
    expect(await firstWhen({ outputLatency: -0.5 })).toBeCloseTo(103, 6);
  });

  it('NaN outputLatency 는 무시한다 (비정상 값 방어)', async () => {
    expect(await firstWhen({ outputLatency: Number.NaN })).toBeCloseTo(103, 6);
  });

  it('과대 outputLatency 는 상한(0.5s)으로 잘라낸다 (비정상 값 방어)', async () => {
    // 5초를 그대로 빼면 앵커가 98 이 되어 전 슬롯이 past-due 로 사라진다.
    expect(await firstWhen({ outputLatency: 5 })).toBeCloseTo(102.5, 6);
  });
});

describe('countdownPlayer — mp3 캐시 정책', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetch 가 cache:'no-cache' 로 매번 재검증을 강제하지 않는다", async () => {
    // 서버는 Cache-Control: public, max-age=3600 을 준다
    // (server/src/tts/tts.controller.ts). no-cache 는 이를 무력화해 로그인마다
    // 수백 건의 조건부 GET 을 발생시킨다.
    setupAudioMocks({ currentTime: 0 });
    const { primeCountdownAudio } = await import('../countdownPlayer');
    await primeCountdownAudio([1, 2, 3], 'ko');

    expect(global.fetch).toHaveBeenCalled();
    for (const [, opts] of global.fetch.mock.calls) {
      expect(opts?.cache).not.toBe('no-cache');
      expect(opts?.cache).not.toBe('no-store');
      expect(opts?.cache).not.toBe('reload');
      // 인증 쿠키는 계속 실려야 한다
      expect(opts?.credentials).toBe('same-origin');
    }
  });
});
