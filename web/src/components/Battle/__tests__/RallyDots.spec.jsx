import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import RallyDots from '../RallyDots';
import { useStore } from '../../../store';

describe('RallyDots', () => {
  beforeEach(() => {
    cleanup();
    useStore.setState({
      rallyGroups: [],
      rallyCountdowns: {},
      timeOffset: 0,
      personalOffsetMs: 0,
      user: null,
    });
  });

  it('running 그룹 없음 — 안내 메시지', () => {
    render(<RallyDots />);
    expect(screen.getByText(/공격 카운트가 시작되면/)).toBeInTheDocument();
  });

  it('running 그룹 + fireOffsets 3개 — 멤버 닉네임 마커 렌더', () => {
    const groupId = 'g1';
    useStore.setState({
      user: { id: 1, nickname: 'me' },
      rallyGroups: [{
        id: groupId,
        state: 'running',
        members: [
          { orderIndex: 1, userId: 1, user: { id: 1, nickname: 'me' } },
          { orderIndex: 2, userId: 2, user: { id: 2, nickname: 'alice' } },
          { orderIndex: 3, userId: 3, user: { id: 3, nickname: 'bob' } },
        ],
      }],
      rallyCountdowns: {
        [groupId]: {
          startedAtServerMs: Date.now(),
          fireOffsets: [
            { orderIndex: 1, offsetMs: 0,    userId: 1 },
            { orderIndex: 2, offsetMs: 3000, userId: 2 },
            { orderIndex: 3, offsetMs: 6000, userId: 3 },
          ],
        },
      },
    });
    const { container } = render(<RallyDots />);
    expect(container.querySelector('.timeline-bar')).toBeInTheDocument();
    expect(screen.getByText('me')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    // 본인 마커는 timeline-marker--me 클래스
    expect(container.querySelector('.timeline-marker--me')).toBeInTheDocument();
  });

  it('동일 인덱스 다수 멤버 — ", " 결합', () => {
    const groupId = 'g1';
    // 두 멤버가 같은 초(1s bin)에 그룹핑 되도록 offsetMs를 500, 600으로 설정
    // totalMs = max(500, 600) = 600ms → totalSec = 1 → empty 분기 우회
    useStore.setState({
      user: null,
      rallyGroups: [{
        id: groupId,
        state: 'running',
        members: [
          { orderIndex: 1, userId: 1, user: { id: 1, nickname: 'a' } },
          { orderIndex: 2, userId: 2, user: { id: 2, nickname: 'b' } },
        ],
      }],
      rallyCountdowns: {
        [groupId]: {
          startedAtServerMs: Date.now(),
          fireOffsets: [
            { orderIndex: 1, offsetMs: 500,  userId: 1 },
            { orderIndex: 2, offsetMs: 600,  userId: 2 },
          ],
        },
      },
    });
    render(<RallyDots />);
    expect(screen.getByText('a, b')).toBeInTheDocument();
  });
});
