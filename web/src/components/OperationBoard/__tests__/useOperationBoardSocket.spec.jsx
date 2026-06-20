// 작전판 소켓 훅의 presence 기반 권한 갱신을 검증한다.
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOperationBoardSocket } from '../useOperationBoardSocket';

const socketMock = vi.hoisted(() => ({
  connected: true,
  id: 's-member',
  handlers: {},
  on: vi.fn((event, handler) => {
    socketMock.handlers[event] = handler;
  }),
  off: vi.fn((event) => {
    delete socketMock.handlers[event];
  }),
  emit: vi.fn(),
}));

vi.mock('../../../api', () => ({
  connectSocket: () => socketMock,
}));

describe('useOperationBoardSocket', () => {
  beforeEach(() => {
    socketMock.connected = true;
    socketMock.id = 's-member';
    socketMock.handlers = {};
    socketMock.on.mockClear();
    socketMock.off.mockClear();
    socketMock.emit.mockClear();
  });

  it('updates local canDraw when operation presence grants this socket participant draw permission', () => {
    const { result } = renderHook(() => useOperationBoardSocket(false));

    act(() => {
      socketMock.handlers['operation:state']({
        elements: [],
        background: { type: 'grid', imageUrl: null },
        participants: [
          { participantId: 's-member', nickname: 'memberKo', canDraw: false },
        ],
        canDraw: false,
      });
    });
    expect(result.current.canDraw).toBe(false);

    act(() => {
      socketMock.handlers['operation:presence']([
        { participantId: 's-member', nickname: 'memberKo', canDraw: true },
      ]);
    });

    expect(result.current.canDraw).toBe(true);
  });
});
