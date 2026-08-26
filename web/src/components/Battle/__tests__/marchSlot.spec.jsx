// marchSlot.spec.jsx — 개인 출발('march') 음성의 배선 계약
//
// 배경: '출발'은 사용자가 실제로 행동하는 신호인데 setInterval(tick, 200) 안의
//       speak('march') → new Audio(url).play() 경로에 남아 있었다. Web Audio 클럭도,
//       past-due 가드도, outputLatency 보정도 받지 못해 숫자 트랙과 새로 벌어졌다.
//
// 이 파일이 고정하는 계약:
// 1) Countdown 이 scheduleCountdown 에 marchSeconds 를 넘긴다(= 절대예약에 편입).
// 2) marchSeconds 가 카운트다운 도중 바뀌면 재예약한다. 같은 값이면 재예약하지 않는다.
// 3) PersonalPanel 의 tick 은 화면 표시만 담당하고 speak('march') 를 부르지 않는다.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';

vi.mock('../countdownPlayer', () => ({
  primeCountdownAudio: vi.fn(() => Promise.resolve()),
  scheduleCountdown: vi.fn(),
  stopCountdownAudio: vi.fn(),
  setCountdownVolume: vi.fn(),
  getAutoLatencyMs: vi.fn(() => 0),
}));

vi.mock('../tts', () => ({
  speak: vi.fn(),
  stopAllTts: vi.fn(),
  prefetchTts: vi.fn(),
  ttsUrl: (lang, key) => `/tts-audio/${lang}/${key}`,
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ lang: 'ko', t: (k) => k }),
}));

vi.mock('../../../api', () => ({
  api: {
    getBattleSettings: vi.fn(() => Promise.resolve({ marchSeconds: 30 })),
    saveBattleSettings: vi.fn(() => Promise.resolve()),
  },
  getSocket: () => null,
}));

vi.mock('../../../clockSync', () => ({ RESCHEDULE_THRESHOLD_MS: 1000 }));

import Countdown from '../Countdown';
import PersonalPanel from '../PersonalPanel';
import { scheduleCountdown } from '../countdownPlayer';
import { speak } from '../tts';
import { useStore } from '../../../store';

const START = 1_700_000_000_000;

/** scheduleCountdown 이 마지막으로 받은 marchSeconds */
function lastMarch() {
  const calls = scheduleCountdown.mock.calls;
  return calls[calls.length - 1]?.[0]?.marchSeconds;
}

describe('Countdown — march 절대예약 배선', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useStore.setState({
      user: { id: 1, nickname: 'me', role: 'member' },
      timeOffset: 0,
      personalOffsetMs: 0,
      ttsVolume: 0.3,
      ttsMuted: false,
      busyHolder: null,
      myMarchSeconds: 30,
      countdown: { active: true, startedAt: START, totalSeconds: 60 },
    });
  });

  it('scheduleCountdown 에 marchSeconds 를 함께 넘긴다', () => {
    render(<Countdown />);
    expect(scheduleCountdown).toHaveBeenCalledTimes(1);
    expect(lastMarch()).toBe(30);
  });

  it('카운트다운 도중 marchSeconds 가 바뀌면 새 값으로 재예약한다', () => {
    render(<Countdown />);
    expect(scheduleCountdown).toHaveBeenCalledTimes(1);

    act(() => { useStore.setState({ myMarchSeconds: 20 }); });

    expect(scheduleCountdown).toHaveBeenCalledTimes(2);
    expect(lastMarch()).toBe(20);
    // 나머지 파라미터는 그대로여야 한다 — 숫자 슬롯도 같은 앵커로 다시 잡힌다
    const arg = scheduleCountdown.mock.calls[1][0];
    expect(arg.totalSeconds).toBe(60);
    expect(arg.startedAt).toBe(START);
  });

  it('같은 marchSeconds 로 갱신되면 재예약하지 않는다', () => {
    render(<Countdown />);
    expect(scheduleCountdown).toHaveBeenCalledTimes(1);

    act(() => { useStore.setState({ myMarchSeconds: 30 }); });
    act(() => { useStore.setState({ onlineUsers: [{ id: 2 }] }); });

    expect(scheduleCountdown).toHaveBeenCalledTimes(1);
  });

  it('marchSeconds 가 미설정(null)이면 그대로 null 을 넘긴다', () => {
    useStore.setState({ myMarchSeconds: null });
    render(<Countdown />);
    expect(lastMarch()).toBeNull();
  });
});

describe('PersonalPanel — tick 은 화면 표시만 한다', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useStore.setState({
      user: { id: 1, nickname: 'me' },
      rallyGroups: [],
      timeOffset: 0,
      personalOffsetMs: 0,
      ttsVolume: 0.3,
      ttsMuted: false,
      myMarchSeconds: null,
      countdown: { active: true, startedAt: Date.now(), totalSeconds: 60 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("march 시점을 지나도 speak('march') 를 부르지 않는다", async () => {
    const now = Date.now();
    // 남은 시간이 30초를 막 지나도록 — tick 첫 호출에서 곧바로 march 조건에 걸리는 지점
    useStore.setState({
      countdown: { active: true, startedAt: now - 30_500, totalSeconds: 60 },
    });

    render(<PersonalPanel />);
    // getBattleSettings 프라미스(marchSeconds: 30) 해소 대기.
    // tick() 은 effect setup 에서 곧바로 한 번 실행되므로 타이머를 돌릴 필요가 없다 —
    // 남은 시간 29.5초 → ceil 30 === marchSeconds 로 기존 구현이라면 여기서 발화한다.
    await screen.findByText(/내 출발까지|출발!/);

    expect(speak).not.toHaveBeenCalled();
  });

  it('내 출발까지 남은 시간은 계속 표시한다', async () => {
    const now = Date.now();
    useStore.setState({
      countdown: { active: true, startedAt: now, totalSeconds: 60 },
    });

    render(<PersonalPanel />);
    // marchSeconds 30, 총 60초 → 내 출발까지 약 30초
    const el = await screen.findByText(/내 출발까지 \d+초/);
    expect(el).toBeInTheDocument();
  });
});
