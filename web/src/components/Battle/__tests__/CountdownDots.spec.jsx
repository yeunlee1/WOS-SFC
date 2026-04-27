import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CountdownDots from '../CountdownDots';
import { useStore } from '../../../store';

describe('CountdownDots', () => {
  beforeEach(() => {
    cleanup();
    // store 초기 상태 reset (필요 시) — useStore.setState로 직접 세팅
    useStore.setState({
      countdown: { active: false, startedAt: 0, totalSeconds: 0 },
      timeOffset: 0,
      personalOffsetMs: 0,
      myMarchSeconds: null,
    });
  });

  it('비활성 상태 — 안내 메시지 렌더', () => {
    render(<CountdownDots />);
    expect(screen.getByText(/수비 카운트가 시작되면/)).toBeInTheDocument();
  });

  it('active + marchSeconds 설정 시 — 막대와 "출발" 마커 렌더', () => {
    useStore.setState({
      countdown: { active: true, startedAt: Date.now(), totalSeconds: 30 },
      timeOffset: 0,
      personalOffsetMs: 0,
      myMarchSeconds: 10,
    });
    const { container } = render(<CountdownDots />);
    expect(container.querySelector('.timeline-bar')).toBeInTheDocument();
    expect(screen.getByText('출발')).toBeInTheDocument();
  });

  it('marchSeconds > totalSeconds — "출발" 마커 미표시', () => {
    useStore.setState({
      countdown: { active: true, startedAt: Date.now(), totalSeconds: 5 },
      timeOffset: 0,
      personalOffsetMs: 0,
      myMarchSeconds: 100,
    });
    render(<CountdownDots />);
    expect(screen.queryByText('출발')).not.toBeInTheDocument();
  });

  it('myMarchSeconds === null — "출발" 마커 미표시', () => {
    useStore.setState({
      countdown: { active: true, startedAt: Date.now(), totalSeconds: 30 },
      myMarchSeconds: null,
    });
    render(<CountdownDots />);
    expect(screen.queryByText('출발')).not.toBeInTheDocument();
  });
});
