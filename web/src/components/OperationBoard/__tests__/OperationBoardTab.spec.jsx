// 작전판 탭의 권한별 도구 노출과 파괴적 동작 확인 절차를 검증한다.
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationBoardTab from '../OperationBoardTab';
import { useStore } from '../../../store';

const mockSocketState = vi.hoisted(() => ({
  value: null,
}));

const mockApi = vi.hoisted(() => ({
  listOperationBoards: vi.fn(async () => []),
  getOperationBoard: vi.fn(),
  uploadOperationBoardBackground: vi.fn(),
  saveOperationBoard: vi.fn(),
  renameOperationBoard: vi.fn(),
  deleteOperationBoard: vi.fn(),
}));

vi.mock('../useOperationBoardSocket', () => ({
  useOperationBoardSocket: () => mockSocketState.value,
}));

vi.mock('../../../api', () => ({
  api: mockApi,
}));

function makeSocketState(overrides = {}) {
  return {
    connected: true,
    canDraw: false,
    participants: [],
    elements: [],
    background: { type: 'grid', imageUrl: null },
    lastError: '',
    sessionReset: false,
    clearError: vi.fn(),
    emitElement: vi.fn(),
    emitRemoveElement: vi.fn(),
    emitClear: vi.fn(),
    emitPermission: vi.fn(),
    emitBackground: vi.fn(),
    emitChatOpen: vi.fn(),
    emitReplaceBoard: vi.fn(),
    ...overrides,
  };
}

describe('OperationBoardTab', () => {
  beforeEach(() => {
    cleanup();
    mockApi.listOperationBoards.mockResolvedValue([]);
    mockSocketState.value = makeSocketState();
    useStore.setState({
      user: {
        id: 1,
        nickname: 'memberKo',
        role: 'member',
        allianceName: 'KOR',
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a read-only operation board for members without draw permission', () => {
    render(<OperationBoardTab />);

    expect(screen.getByRole('heading', { name: '작전판' })).toBeInTheDocument();
    expect(screen.getByText('보기 전용')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '펜' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  it('enables drawing tools when a member receives session draw permission', () => {
    mockSocketState.value.canDraw = true;

    render(<OperationBoardTab />);

    expect(screen.getByText('그리기 가능')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '펜' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '배경' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '격자' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '지우기' })).toBeDisabled();
  });

  it('always enables operation tools for admin and developer users', () => {
    useStore.setState({
      user: {
        id: 2,
        nickname: 'adminKo',
        role: 'admin',
        allianceName: 'KOR',
      },
    });

    render(<OperationBoardTab />);

    expect(screen.getByRole('button', { name: '펜' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '저장' })).not.toBeDisabled();
  });

  describe('파괴적 동작 확인 절차', () => {
    beforeEach(() => {
      useStore.setState({
        user: { id: 2, nickname: 'adminKo', role: 'admin', allianceName: 'KOR' },
      });
    });

    it('지우기는 확인을 받아야 라이브 보드를 비운다', async () => {
      const confirmSpy = vi
        .spyOn(window, 'confirm')
        .mockReturnValue(false);
      render(<OperationBoardTab />);

      await userEvent.click(screen.getByRole('button', { name: '지우기' }));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(mockSocketState.value.emitClear).not.toHaveBeenCalled();

      confirmSpy.mockReturnValue(true);
      await userEvent.click(screen.getByRole('button', { name: '지우기' }));

      expect(mockSocketState.value.emitClear).toHaveBeenCalledTimes(1);
    });

    it('저장본 불러오기는 확인을 받은 뒤 일괄 적용 1건만 보낸다', async () => {
      // 목록 응답에는 요소가 없다(메타만) — 요소는 불러올 때 개별 조회로 받는다.
      mockApi.listOperationBoards.mockResolvedValue([
        {
          id: 7,
          title: '서쪽 협공',
          backgroundType: 'grid',
          backgroundImageUrl: null,
        },
      ]);
      mockApi.getOperationBoard.mockResolvedValue({
        id: 7,
        title: '서쪽 협공',
        backgroundType: 'grid',
        backgroundImageUrl: null,
        elements: Array.from({ length: 500 }, (_, index) => ({
          id: `e${index}`,
          type: 'marker',
          x: index,
          y: index,
        })),
      });
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      render(<OperationBoardTab />);

      const loadButton = await screen.findByRole('button', {
        name: '서쪽 협공',
      });

      await userEvent.click(loadButton);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(mockSocketState.value.emitReplaceBoard).not.toHaveBeenCalled();
      // 확인을 거절하면 개별 조회도 하지 않는다 — 요소를 헛되이 내려받지 않는다.
      expect(mockApi.getOperationBoard).not.toHaveBeenCalled();

      confirmSpy.mockReturnValue(true);
      await userEvent.click(loadButton);

      await waitFor(() =>
        expect(mockSocketState.value.emitReplaceBoard).toHaveBeenCalledTimes(1),
      );
      expect(mockApi.getOperationBoard).toHaveBeenCalledWith(7);
      expect(mockSocketState.value.emitElement).not.toHaveBeenCalled();
      expect(mockSocketState.value.emitClear).not.toHaveBeenCalled();
      expect(mockSocketState.value.emitBackground).not.toHaveBeenCalled();

      const payload = mockSocketState.value.emitReplaceBoard.mock.calls[0][0];
      expect(payload.elements).toHaveLength(500);
      expect(payload.background).toEqual({ type: 'grid', imageUrl: null });
    });

    it('저장본 개별 조회가 실패하면 라이브 보드를 건드리지 않고 알린다', async () => {
      mockApi.listOperationBoards.mockResolvedValue([
        { id: 9, title: '동쪽 방어', backgroundType: 'grid', backgroundImageUrl: null },
      ]);
      mockApi.getOperationBoard.mockRejectedValue(new Error('불러오기 실패'));
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<OperationBoardTab />);

      await userEvent.click(
        await screen.findByRole('button', { name: '동쪽 방어' }),
      );

      await waitFor(() =>
        expect(screen.getByText('불러오기 실패')).toBeInTheDocument(),
      );
      expect(mockSocketState.value.emitReplaceBoard).not.toHaveBeenCalled();
    });
  });

  it('서버 거절 사유와 라이브 상태 소실을 사용자에게 알린다', () => {
    mockSocketState.value = makeSocketState({
      lastError: '작전판 요청이 너무 잦습니다.',
      sessionReset: true,
    });

    render(<OperationBoardTab />);

    expect(screen.getByText('작전판 요청이 너무 잦습니다.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('초기화');
  });

  it('라이브 작전판이 저장되지 않는다는 사실을 항상 표시한다', () => {
    render(<OperationBoardTab />);

    expect(screen.getByText(/저장하지 않으면/)).toBeInTheDocument();
  });
});
