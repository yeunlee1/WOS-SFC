// RallyGroupPanel.marchOverride.spec.jsx — 대기(idle) 상태의 멤버별 행군시간 편집 UI 계약 검증
//
// 배경: 진행 중(running) 변경이 전원의 절대 발사 시각과 호명 번호를 밀기 때문에
//       서버가 409로 거절하고 RallyGroupCountdown 의 "수정" 버튼도 비활성화됐다.
//       그런데 RallyGroupCountdown 은 running 일 때만 마운트되므로 그 버튼은 항상 비활성이고,
//       idle 상태에서 행군시간을 고칠 UI 가 어디에도 남지 않았다.
//       → idle 목록에서 편집할 수 있어야 하고, running 이면 막혀야 한다.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../rallyGroupPlayer', () => ({
  scheduleRallyCountdown: vi.fn(),
  stopRallyCountdown: vi.fn(),
  setRallyVolume: vi.fn(),
  primeRallyAudio: vi.fn(() => Promise.resolve()),
}));

// 자식 컴포넌트는 이 스펙의 관심사가 아니다 — 마운트 여부만 확인할 수 있게 스텁으로 둔다.
vi.mock('../RallyDots', () => ({ default: () => <div data-testid="rally-dots" /> }));
vi.mock('../RallyGroupEditor', () => ({ default: () => <div data-testid="rally-editor" /> }));
vi.mock('../RallyGroupCountdown', () => ({
  default: () => <div data-testid="rally-countdown" />,
}));

vi.mock('../../../api', () => ({
  api: {
    // 마운트 직후 목록을 덮어써 테스트가 세팅한 store 를 지우지 않도록 영원히 pending
    listRallyGroups: vi.fn(() => new Promise(() => {})),
    updateRallyMarchOverride: vi.fn(() => Promise.resolve()),
  },
  getSocket: () => null,
}));

import RallyGroupPanel from '../RallyGroupPanel';
import { api } from '../../../api';
import { useStore } from '../../../store';

const ME = { id: 1, nickname: 'me', marchSeconds: 30 };
const ALICE = { id: 2, nickname: 'alice', marchSeconds: 40 };

function makeGroup(overrides = {}) {
  return {
    id: 'g1',
    name: '1번 집결그룹',
    displayOrder: 1,
    state: 'idle',
    members: [
      { id: 'm1', orderIndex: 1, userId: 1, user: ME, marchSecondsOverride: null },
      { id: 'm2', orderIndex: 2, userId: 2, user: ALICE, marchSecondsOverride: null },
    ],
    ...overrides,
  };
}

/** 특정 멤버의 행(li) 안으로 쿼리를 좁힌다. */
function rowOf(nickname) {
  return within(screen.getByText(nickname).closest('li'));
}

function setup({ group = makeGroup(), user = { ...ME, role: 'user' }, countdowns = {} } = {}) {
  useStore.setState({
    user,
    rallyGroups: [group],
    rallyCountdowns: countdowns,
    busyHolder: null,
  });
  return render(<RallyGroupPanel />);
}

describe('RallyGroupPanel — idle 상태 행군시간 편집', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('idle 이면 본인 행에 편집 진입 버튼이 렌더된다', () => {
    setup();
    const btn = rowOf('me').getByRole('button', { name: '행군시간 수정' });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('일반 사용자는 남의 행을 편집할 수 없다', () => {
    setup();
    expect(rowOf('alice').queryByRole('button', { name: '행군시간 수정' })).toBeNull();
  });

  it('관리자는 남의 행도 편집할 수 있다', () => {
    setup({ user: { id: 9, nickname: 'boss', role: 'admin' } });
    expect(rowOf('alice').getByRole('button', { name: '행군시간 수정' })).toBeInTheDocument();
  });

  it('running(스냅샷 있음) 이면 idle 목록 자체가 없어 편집에 진입할 수 없다', () => {
    setup({
      group: makeGroup({ state: 'running' }),
      countdowns: { g1: { startedAtServerMs: 1, fireOffsets: [] } },
    });
    expect(screen.getByTestId('rally-countdown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '행군시간 수정' })).toBeNull();
  });

  it('running 인데 스냅샷이 아직 없어 목록이 보이면 편집 버튼이 비활성이다', () => {
    setup({ group: makeGroup({ state: 'running' }), countdowns: {} });
    const btn = rowOf('me').getByRole('button', { name: '행군시간 수정' });
    expect(btn).toBeDisabled();
  });

  it('유효한 값을 저장하면 정수로 서버에 보낸다', async () => {
    const u = userEvent.setup();
    setup();
    await u.click(rowOf('me').getByRole('button', { name: '행군시간 수정' }));
    const input = rowOf('me').getByRole('spinbutton');
    await u.clear(input);
    await u.type(input, '45');
    await u.click(rowOf('me').getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(api.updateRallyMarchOverride).toHaveBeenCalledWith('g1', 'm1', 45),
    );
  });

  it.each([
    ['빈 값', ''],
    ['숫자 아님', 'abc'],
    ['범위 초과', '500'],
  ])('%s 이면 null 로 보내 override 를 해제한다', async (_label, typed) => {
    const u = userEvent.setup();
    setup();
    await u.click(rowOf('me').getByRole('button', { name: '행군시간 수정' }));
    const input = rowOf('me').getByRole('spinbutton');
    await u.clear(input);
    if (typed) await u.type(input, typed);
    await u.click(rowOf('me').getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(api.updateRallyMarchOverride).toHaveBeenCalledWith('g1', 'm1', null),
    );
  });

  it('서버가 409 를 주면 사유를 화면에 보여준다', async () => {
    const err = new Error('카운트다운 진행 중에는 행군 시간을 바꿀 수 없습니다. 정지 후 변경하세요.');
    err.status = 409;
    api.updateRallyMarchOverride.mockRejectedValueOnce(err);

    const u = userEvent.setup();
    setup();
    await u.click(rowOf('me').getByRole('button', { name: '행군시간 수정' }));
    const input = rowOf('me').getByRole('spinbutton');
    await u.clear(input);
    await u.type(input, '45');
    await u.click(rowOf('me').getByRole('button', { name: '저장' }));

    expect(
      await screen.findByText(/카운트다운 진행 중에는 행군 시간을 바꿀 수 없습니다/),
    ).toBeInTheDocument();
  });

  it('취소하면 서버를 호출하지 않고 편집이 닫힌다', async () => {
    const u = userEvent.setup();
    setup();
    await u.click(rowOf('me').getByRole('button', { name: '행군시간 수정' }));
    await u.click(rowOf('me').getByRole('button', { name: '취소' }));

    expect(rowOf('me').queryByRole('spinbutton')).toBeNull();
    expect(api.updateRallyMarchOverride).not.toHaveBeenCalled();
  });
});
