// rallyGroupPlayer.spec.js — warmupRallyAudio + 충돌 회귀 검증
//
// 검증 목적:
// 1) warmupRallyAudio가 모든 expected 키(captain_1~6, rally_start_1~6, prep, numeric 1~60)를
//    fetch + decode 한다. 첫 카운트다운 시작 시 bufferCache가 비어있어 발생하던 first-shot 누락
//    버그의 회귀 방지.
// 2) scheduleRallyCountdown이 captain 발화 직후 같은 초의 numeric을 skip한다 (captain end +
//    1.0s 마진 안에 다음 numeric 시작이 끼어들어 청취 충돌이 일어나지 않음).
//
// 설계 메모:
// - rallyGroupPlayer.js는 모듈 레벨 싱글톤(ctx, bufferCache 등)이라 매 it 마다 vi.resetModules로
//   초기화한다. window.AudioContext와 global.fetch도 매번 재설정.

import { describe, it, expect, beforeEach, vi } from 'vitest';

function setupAudioMocks() {
  // arraybuffer를 디코드해 numberOfChannels 가 들어있는 객체를 반환 — schedulePlay의
  // `'numberOfChannels' in entry` 판정을 통과시키기 위함.
  const decodedBuffer = { numberOfChannels: 1, duration: 0.84 };

  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  }));

  const createGain = () => ({
    gain: {
      value: 0.3,
      cancelScheduledValues: vi.fn(),
      setTargetAtTime: vi.fn(),
    },
    connect: vi.fn(),
  });
  const createAnalyser = () => ({ fftSize: 0, connect: vi.fn() });
  const createBufferSource = () => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    onended: null,
  });
  const createBuffer = () => ({});

  class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
    }
    createGain = createGain;
    createAnalyser = createAnalyser;
    createBufferSource = createBufferSource;
    createBuffer = createBuffer;
    decodeAudioData = vi.fn(() => Promise.resolve(decodedBuffer));
    resume = vi.fn(() => Promise.resolve());
  }

  window.AudioContext = FakeAudioContext;
  delete window.webkitAudioContext;
}

describe('rallyGroupPlayer — warmupRallyAudio', () => {
  beforeEach(() => {
    vi.resetModules();
    setupAudioMocks();
  });

  it('워밍업 시 captain_1~6 + rally_start_1~6 + prep + numeric 1~180 fetch', async () => {
    const { warmupRallyAudio } = await import('../rallyGroupPlayer');
    await warmupRallyAudio({ lang: 'ko' });

    const fetched = global.fetch.mock.calls.map(([url]) => url);

    // captain_1 ~ captain_6
    for (let i = 1; i <= 6; i++) {
      expect(fetched).toContain(`/tts-audio/ko/captain_${i}`);
    }
    // rally_start_1 ~ rally_start_6
    for (let i = 1; i <= 6; i++) {
      expect(fetched).toContain(`/tts-audio/ko/rally_start_${i}`);
    }
    // prep "3","2","1"
    for (const k of ['3', '2', '1']) {
      expect(fetched).toContain(`/tts-audio/ko/${encodeURIComponent(k)}`);
    }
    // numeric 4~180 (prep 1~3은 위에서 이미 카운트, MAX_OFFSET_SEC=180)
    for (let t = 4; t <= 180; t++) {
      expect(fetched).toContain(`/tts-audio/ko/${t}`);
    }
    // 총 6 + 6 + 3 + 177 = 192개
    expect(fetched.length).toBe(192);
  });

  it('lang 파라미터로 비-기본 언어도 워밍업 (en)', async () => {
    const { warmupRallyAudio } = await import('../rallyGroupPlayer');
    await warmupRallyAudio({ lang: 'en' });
    const fetched = global.fetch.mock.calls.map(([url]) => url);
    expect(fetched).toContain('/tts-audio/en/captain_1');
    expect(fetched).toContain('/tts-audio/en/rally_start_3');
    // ko 키는 fetch되지 않음
    expect(fetched).not.toContain('/tts-audio/ko/captain_1');
  });

  it('비지원 lang(ru) 사용 시 ko로 fallback — 서버 400/404 spam 방지', async () => {
    // AuthModal LANGUAGES에는 'ru', 'other'가 있으나 TTS 서버는 ko/en/ja/zh만 지원.
    // SUPPORTED_TTS_LANGS 화이트리스트로 safeLang='ko'로 정규화되어야 함.
    const { warmupRallyAudio } = await import('../rallyGroupPlayer');
    await warmupRallyAudio({ lang: 'ru' });
    const fetched = global.fetch.mock.calls.map(([url]) => url);
    // ru 경로는 하나도 fetch되면 안 됨
    expect(fetched.every((url) => !url.includes('/tts-audio/ru/'))).toBe(true);
    // ko 경로로 fetch됨
    expect(fetched).toContain('/tts-audio/ko/captain_1');
    expect(fetched.length).toBe(192);
  });

  it('비-string lang(null) 사용 시 ko로 fallback — SUPPORTED_TTS_LANGS.has 가드', async () => {
    // 호출자가 명시적으로 lang:null을 넘기면 destructuring 기본값(`= 'ko'`)이 적용되지 않음.
    // 이때 SUPPORTED_TTS_LANGS.has(null)이 false → safeLang='ko'로 fallback해야 한다.
    // 가드를 `(lang || 'ko')`로 회귀시키면 동일하게 동작하지만 `'invalid'` 문자열도
    // 그대로 통과시키므로 ru 테스트와 함께 화이트리스트 가드의 정확성을 보장.
    const { warmupRallyAudio } = await import('../rallyGroupPlayer');
    await warmupRallyAudio({ lang: null });
    const fetched = global.fetch.mock.calls.map(([url]) => url);
    // null 또는 undefined 문자열이 URL에 들어가면 안 됨
    expect(fetched.every((url) => !url.includes('/tts-audio/null/'))).toBe(true);
    expect(fetched.every((url) => !url.includes('/tts-audio/undefined/'))).toBe(true);
    // ko 경로로 fetch됨
    expect(fetched).toContain('/tts-audio/ko/captain_1');
    expect(fetched.length).toBe(192);
  });

  it('워밍업 후 두 번째 호출 시 동일 키 재fetch 안 함 (bufferCache 활용)', async () => {
    const { warmupRallyAudio } = await import('../rallyGroupPlayer');
    await warmupRallyAudio({ lang: 'ko' });
    const firstCount = global.fetch.mock.calls.length;
    expect(firstCount).toBe(192);

    await warmupRallyAudio({ lang: 'ko' });
    // 캐시 hit이면 새 fetch 발생하지 않음
    expect(global.fetch.mock.calls.length).toBe(firstCount);
  });

  it('onProgress 콜백 호출 — loaded는 단조증가, total=192', async () => {
    const { warmupRallyAudio } = await import('../rallyGroupPlayer');
    const calls = [];
    await warmupRallyAudio({ lang: 'ko', onProgress: (p) => calls.push(p) });
    expect(calls.length).toBe(192);
    expect(calls[calls.length - 1]).toEqual({ loaded: 192, total: 192 });
    // 모든 total은 192
    for (const c of calls) expect(c.total).toBe(192);
    // loaded는 단조증가
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].loaded).toBeGreaterThan(calls[i - 1].loaded);
    }
  });

  it('AudioContext 미지원 환경(window.AudioContext 없음)에서 graceful return — fetch 호출 0', async () => {
    // ensureContext가 null 반환 → warmupRallyAudio는 즉시 return해야 함.
    // SSR/구형 브라우저 회귀 방지.
    delete window.AudioContext;
    delete window.webkitAudioContext;
    const { warmupRallyAudio } = await import('../rallyGroupPlayer');
    await expect(warmupRallyAudio({ lang: 'ko' })).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetch 실패 시 bufferCache가 오염되지 않아 재시도 가능', async () => {
    // loadBuffer 내부 catch에서 bufferCache.delete(cacheKey)가 호출되어야 함.
    // 첫 시도 실패 → 두 번째 warmup 시 동일 키 재fetch가 발생해야 회귀 없음.
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      status: 500,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));
    const { warmupRallyAudio } = await import('../rallyGroupPlayer');
    await warmupRallyAudio({ lang: 'ko' });
    const firstCount = global.fetch.mock.calls.length;
    expect(firstCount).toBe(192);

    // 두 번째 호출 — 캐시가 오염되지 않았다면 모두 재fetch
    await warmupRallyAudio({ lang: 'ko' });
    expect(global.fetch.mock.calls.length).toBe(firstCount * 2);
  });

  it('onProgress 콜백이 throw해도 워밍업 진행 — 모든 키 fetch 완료', async () => {
    // 외부 콜백 예외가 워밍업 자체를 깨뜨리면 안 됨 (try/catch 가드 검증).
    const { warmupRallyAudio } = await import('../rallyGroupPlayer');
    let calledTimes = 0;
    await expect(
      warmupRallyAudio({
        lang: 'ko',
        onProgress: () => {
          calledTimes += 1;
          throw new Error('intentional onProgress failure');
        },
      }),
    ).resolves.toBeUndefined();
    // 콜백이 매번 throw해도 192개 모두 호출되어야 함
    expect(calledTimes).toBe(192);
    // fetch도 정상적으로 192회 발생
    expect(global.fetch.mock.calls.length).toBe(192);
  });
});

describe('rallyGroupPlayer — scheduleRallyCountdown 청취 충돌 회귀', () => {
  // captain 음성 실측 ~0.84s. 다음 1초 슬롯과 겹치지 않으려면 동일 초에 captain이 있는 numeric은
  // skip되어야 한다. 이 테스트는 schedulePlay가 등록한 시각 목록(scheduleLog)에서
  // captain 시각과 같은 시각의 numeric이 없음을 검증한다.
  const CAPTAIN_DURATION_MARGIN_S = 1.0;

  beforeEach(() => {
    vi.resetModules();
    setupAudioMocks();
  });

  it('captain 발화 초의 numeric은 skip — 청취 충돌 0건', async () => {
    const { scheduleRallyCountdown } = await import('../rallyGroupPlayer');

    // captain at offset 5s, 10s, 15s. maxOffsetSec=15.
    // numeric은 4,6,7,8,9,11,12,13,14 만 스케줄되어야 함 (5,10,15는 captain이 점유).
    const fireOffsets = [
      { orderIndex: 1, offsetMs: 5000, userId: 1 },
      { orderIndex: 2, offsetMs: 10000, userId: 2 },
      { orderIndex: 3, offsetMs: 15000, userId: 3 },
    ];

    await scheduleRallyCountdown({
      startedAtServerMs: Date.now(),
      fireOffsets,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
      displayOrder: 1,
    });

    // 마이크로태스크 큐 비우기 — schedulePlay는 buffer.then(startSource)이므로
    await new Promise((r) => setTimeout(r, 0));

    const items = window.__rallyScheduleLog.items;
    expect(items.length).toBeGreaterThan(0);

    // captain key 식별
    const captainItems = items.filter((it) => /^captain_\d+$/.test(it.key));
    expect(captainItems.length).toBe(3);

    // numeric 키 (정수 문자열)
    const numericItems = items.filter((it) => /^\d+$/.test(it.key));

    // 청취 충돌 검증: captain 발화 시각 [t, t + CAPTAIN_DURATION_MARGIN_S) 안에 시작하는
    // numeric 슬롯이 없어야 함.
    for (const cap of captainItems) {
      for (const num of numericItems) {
        const gap = num.ctxTimeAtPlay - cap.ctxTimeAtPlay;
        if (gap >= 0 && gap < CAPTAIN_DURATION_MARGIN_S) {
          throw new Error(
            `청취 충돌: captain ${cap.key}@${cap.ctxTimeAtPlay} 와 numeric ${num.key}@${num.ctxTimeAtPlay} (gap=${gap}s)`,
          );
        }
      }
    }

    // 동일 초 captain 점유 확인 — numeric "5","10","15"는 schedule되면 안 됨
    const numericKeys = new Set(numericItems.map((it) => it.key));
    expect(numericKeys.has('5')).toBe(false);
    expect(numericKeys.has('10')).toBe(false);
    expect(numericKeys.has('15')).toBe(false);
    // 인접 초는 정상 스케줄
    expect(numericKeys.has('4')).toBe(true);
    expect(numericKeys.has('6')).toBe(true);
  });

  it('프리카운트("3","2","1")는 t=1~3 numeric과 중복 예약 안 됨', async () => {
    const { scheduleRallyCountdown } = await import('../rallyGroupPlayer');

    const fireOffsets = [{ orderIndex: 1, offsetMs: 7000, userId: 1 }];
    await scheduleRallyCountdown({
      startedAtServerMs: Date.now(),
      fireOffsets,
      timeOffset: 0,
      lang: 'ko',
      volume: 0.3,
      muted: false,
      displayOrder: 1,
    });
    await new Promise((r) => setTimeout(r, 0));

    const items = window.__rallyScheduleLog.items;

    // "3","2","1" 키는 정확히 한 번씩만 등장 (프리카운트). T+1,T+2,T+3 numeric은 skip.
    const counts = { '1': 0, '2': 0, '3': 0 };
    for (const it of items) {
      if (it.key in counts) counts[it.key] += 1;
    }
    expect(counts['1']).toBe(1);
    expect(counts['2']).toBe(1);
    expect(counts['3']).toBe(1);
  });
});
