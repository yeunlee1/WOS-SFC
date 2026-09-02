// RallyGroupCountdown.spec.jsx — 재접속 스냅샷이 재생 중인 오디오를 끊지 않는지 검증
//
// 배경: 게이트웨이가 재접속자에게 진행 중 카운트다운 스냅샷을 되돌려주는데,
//       스케줄 effect 의 deps 가 원시값이 아니라 countdown "객체"면 참조만 바뀌어도
//       재실행된다. scheduleRallyCountdown 은 첫 줄에서 stopRallyCountdown() 을 불러
//       울리던 단어를 자르고, 재예약 때 past-due 가드가 그 슬롯을 버린다.
//       → 본인 순번 안내를 통째로 놓친다.
//       절대예약은 소켓 상태와 무관하게 정확히 재생되므로 재접속 클라이언트의 오디오는
//       원래 건드릴 필요가 없다.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../rallyGroupPlayer', () => ({
  scheduleRallyCountdown: vi.fn(),
  stopRallyCountdown: vi.fn(),
  setRallyVolume: vi.fn(),
  primeRallyAudio: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({ lang: 'ko', t: (k) => k }),
}));

vi.mock('../../../api', () => ({
  api: { updateRallyMarchOverride: vi.fn(() => Promise.resolve()) },
  getSocket: () => null,
}));

vi.mock('../../../clockSync', () => ({ RESCHEDULE_THRESHOLD_MS: 1000 }));

import RallyGroupCountdown from '../RallyGroupCountdown';
import { scheduleRallyCountdown, stopRallyCountdown } from '../rallyGroupPlayer';
import { useStore } from '../../../store';

const GROUP = {
  id: 'g1',
  displayOrder: 1,
  members: [
    { id: 'm1', orderIndex: 1, userId: 1, user: { id: 1, nickname: 'me', marchSeconds: 30 } },
    { id: 'm2', orderIndex: 2, userId: 2, user: { id: 2, nickname: 'alice', marchSeconds: 40 } },
  ],
};

/** 서버가 보내는 페이로드 — 재접속 스냅샷은 값이 같은 "새 객체"로 다시 도착한다. */
function makeCountdown(startedAtServerMs = 1_700_000_000_000) {
  return {
    groupId: 'g1',
    startedAtServerMs,
    fireOffsets: [
      { orderIndex: 1, offsetMs: 0, userId: 1 },
      { orderIndex: 2, offsetMs: 45_000, userId: 2 },
    ],
  };
}

describe('RallyGroupCountdown — 재접속 스냅샷', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useStore.setState({
      user: { id: 1, nickname: 'me' },
      timeOffset: 0,
      personalOffsetMs: 0,
      ttsVolume: 0.3,
      ttsMuted: false,
    });
  });

  it('값이 같은 페이로드를 다시 받아도 재스케줄하지 않는다', () => {
    const { rerender } = render(
      <RallyGroupCountdown group={GROUP} countdown={makeCountdown()} />,
    );
    expect(scheduleRallyCountdown).toHaveBeenCalledTimes(1);

    // 재접속 스냅샷 — 값은 같고 객체 참조만 다르다
    rerender(<RallyGroupCountdown group={GROUP} countdown={makeCountdown()} />);
    rerender(<RallyGroupCountdown group={GROUP} countdown={makeCountdown()} />);

    expect(scheduleRallyCountdown).toHaveBeenCalledTimes(1);
    // 재생 중인 발화를 자르는 stop 도 추가로 불리지 않아야 한다
    expect(stopRallyCountdown).not.toHaveBeenCalled();
  });

  it('startedAtServerMs 가 바뀌면(새 카운트다운) 재스케줄한다', () => {
    const { rerender } = render(
      <RallyGroupCountdown group={GROUP} countdown={makeCountdown(1_700_000_000_000)} />,
    );
    expect(scheduleRallyCountdown).toHaveBeenCalledTimes(1);

    rerender(
      <RallyGroupCountdown group={GROUP} countdown={makeCountdown(1_700_000_050_000)} />,
    );
    expect(scheduleRallyCountdown).toHaveBeenCalledTimes(2);
  });

  it('fireOffsets 가 바뀌면 재스케줄한다', () => {
    const { rerender } = render(
      <RallyGroupCountdown group={GROUP} countdown={makeCountdown()} />,
    );
    expect(scheduleRallyCountdown).toHaveBeenCalledTimes(1);

    const changed = makeCountdown();
    changed.fireOffsets = [
      { orderIndex: 1, offsetMs: 0, userId: 1 },
      { orderIndex: 2, offsetMs: 60_000, userId: 2 },
    ];
    rerender(<RallyGroupCountdown group={GROUP} countdown={changed} />);
    expect(scheduleRallyCountdown).toHaveBeenCalledTimes(2);
  });

  it('countdown 이 사라지면 오디오를 정지한다', () => {
    const { rerender } = render(
      <RallyGroupCountdown group={GROUP} countdown={makeCountdown()} />,
    );
    vi.clearAllMocks();

    rerender(<RallyGroupCountdown group={GROUP} countdown={null} />);
    expect(stopRallyCountdown).toHaveBeenCalled();
    expect(scheduleRallyCountdown).not.toHaveBeenCalled();
  });
});
