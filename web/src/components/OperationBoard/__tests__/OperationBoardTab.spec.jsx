// 작전판 탭의 권한별 도구 노출과 기본 렌더링을 검증한다.
import { render, screen, cleanup } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperationBoardTab from '../OperationBoardTab';
import { useStore } from '../../../store';

const mockSocketState = vi.hoisted(() => ({
  value: {
    connected: true,
    canDraw: false,
    participants: [],
    elements: [],
    background: { type: 'grid', imageUrl: null },
    emitElement: vi.fn(),
    emitRemoveElement: vi.fn(),
    emitClear: vi.fn(),
    emitPermission: vi.fn(),
    emitBackground: vi.fn(),
    emitChatOpen: vi.fn(),
  },
}));

vi.mock('../useOperationBoardSocket', () => ({
  useOperationBoardSocket: () => mockSocketState.value,
}));

vi.mock('../../../api', () => ({
  api: {
    listOperationBoards: vi.fn(async () => []),
    uploadOperationBoardBackground: vi.fn(),
    saveOperationBoard: vi.fn(),
  },
}));

describe('OperationBoardTab', () => {
  beforeEach(() => {
    cleanup();
    mockSocketState.value = {
      connected: true,
      canDraw: false,
      participants: [],
      elements: [],
      background: { type: 'grid', imageUrl: null },
      emitElement: vi.fn(),
      emitRemoveElement: vi.fn(),
      emitClear: vi.fn(),
      emitPermission: vi.fn(),
      emitBackground: vi.fn(),
      emitChatOpen: vi.fn(),
    };
    useStore.setState({
      user: {
        id: 1,
        nickname: 'memberKo',
        role: 'member',
        allianceName: 'KOR',
      },
    });
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
});
