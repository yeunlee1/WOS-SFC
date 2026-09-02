// PersonalSyncOffset.spec.jsx — 자동 출력지연 보정과 수동 보정의 합산 표시 검증
//
// 배경: personalOffsetMs 는 사용자가 "내 소리가 늦게 들린다"는 귀 판단으로 이미 출력
//       지연을 손으로 보정해 넣어 둔 값이고 localStorage 에 영구 보존된다. 여기에
//       outputLatency 자동 보정이 더해지면 같은 물리량을 두 번 당기게 되어, 한 번이라도
//       보정해 본 사람만 골라서 빨라진다. 두 값과 합계를 화면에 드러내 사용자가 그 위에서
//       재조정할 수 있게 한다.
//
// 부호 규칙(코드 실측): 두 값 모두 발화를 "앞당긴다".
//   - 자동  ctxAnchor = ... - outputLatency        → 클수록 앞당김
//   - 수동  serverNow = Date.now() + personalOffsetMs → 클수록 앵커가 앞당겨짐
//   따라서 같은 축에서 그대로 더한다.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

const getAutoLatencyMs = vi.fn(() => 0);

vi.mock('../countdownPlayer', () => ({
  primeCountdownAudio: vi.fn(() => Promise.resolve()),
  scheduleCountdown: vi.fn(),
  stopCountdownAudio: vi.fn(),
  setCountdownVolume: vi.fn(),
  getAutoLatencyMs: (...a) => getAutoLatencyMs(...a),
}));

import PersonalSyncOffset from '../PersonalSyncOffset';
import { useStore } from '../../../store';

/** 합산 안내 줄의 텍스트 */
function summaryText() {
  return document.querySelector('.sync-offset-summary')?.textContent ?? '';
}

describe('PersonalSyncOffset — 자동/수동 보정 합산 표시', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    getAutoLatencyMs.mockReturnValue(0);
    useStore.setState({ personalOffsetMs: 0 });
  });

  it('자동 보정과 수동 보정, 합계를 모두 보여준다', async () => {
    getAutoLatencyMs.mockReturnValue(250);
    useStore.setState({ personalOffsetMs: 300 });

    render(<PersonalSyncOffset />);
    await screen.findByText(/550/);

    const text = summaryText();
    expect(text).toMatch(/250/);   // 자동
    expect(text).toMatch(/300/);   // 수동
    expect(text).toMatch(/550/);   // 합계
  });

  it('수동 보정이 음수면 자동 보정에서 상쇄된 합계를 보여준다', async () => {
    getAutoLatencyMs.mockReturnValue(250);
    useStore.setState({ personalOffsetMs: -100 });

    render(<PersonalSyncOffset />);
    await screen.findByText(/150/);

    const text = summaryText();
    expect(text).toMatch(/250/);
    expect(text).toMatch(/-100|−100/);
    expect(text).toMatch(/150/);
  });

  it('자동 보정이 0이면(미지원 브라우저) 합계는 수동값과 같다', async () => {
    getAutoLatencyMs.mockReturnValue(0);
    useStore.setState({ personalOffsetMs: 200 });

    render(<PersonalSyncOffset />);
    await screen.findByText(/합계/);

    const text = summaryText();
    expect(text).toMatch(/자동.*0ms/);
    expect(text).toMatch(/200/);
  });

  it('기존 수동 조절 UI는 그대로 동작한다', () => {
    useStore.setState({ personalOffsetMs: 0 });
    render(<PersonalSyncOffset />);
    expect(screen.getByLabelText('100ms 당기기')).toBeInTheDocument();
    expect(screen.getByLabelText('100ms 늦추기')).toBeInTheDocument();
    expect(screen.getByLabelText('음성 미세 보정 슬라이더')).toBeInTheDocument();
  });
});
