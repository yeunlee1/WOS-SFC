// 작전판 소켓 훅의 presence 기반 권한 갱신과 일괄 적용·거절 고지를 검증한다.
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOperationBoardSocket } from '../useOperationBoardSocket';

const socketMock = vi.hoisted(() => ({
  connected: true,
  id: 's-member',
  handlers: {},
  acks: [],
  on: vi.fn((event, handler) => {
    socketMock.handlers[event] = handler;
  }),
  off: vi.fn((event) => {
    delete socketMock.handlers[event];
  }),
  emit: vi.fn((event, payload, ack) => {
    if (typeof ack === 'function') socketMock.acks.push({ event, ack });
  }),
}));

vi.mock('../../../api', () => ({
  connectSocket: () => socketMock,
}));

function emitCalls(event) {
  return socketMock.emit.mock.calls.filter((call) => call[0] === event);
}

describe('useOperationBoardSocket', () => {
  beforeEach(() => {
    socketMock.connected = true;
    socketMock.id = 's-member';
    socketMock.handlers = {};
    socketMock.acks = [];
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
        sessionId: 'session-1',
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

  it('저장본 불러오기를 이벤트 1건으로 보낸다', () => {
    const { result } = renderHook(() => useOperationBoardSocket(false));
    socketMock.emit.mockClear();

    const elements = Array.from({ length: 500 }, (_, index) => ({
      id: `e${index}`,
      type: 'marker',
    }));

    act(() => {
      result.current.emitReplaceBoard({
        elements,
        background: { type: 'grid', imageUrl: null },
      });
    });

    expect(socketMock.emit).toHaveBeenCalledTimes(1);
    expect(emitCalls('operation:element:add')).toHaveLength(0);
    expect(emitCalls('operation:clear')).toHaveLength(0);
    expect(emitCalls('operation:background:update')).toHaveLength(0);
    expect(socketMock.emit.mock.calls[0][0]).toBe('operation:board:replace');
    expect(socketMock.emit.mock.calls[0][1]).toEqual({
      elements,
      background: { type: 'grid', imageUrl: null },
    });
  });

  it('서버가 보낸 일괄 적용 이벤트로 요소와 배경을 한 번에 바꾼다', () => {
    const { result } = renderHook(() => useOperationBoardSocket(false));

    act(() => {
      socketMock.handlers['operation:board:replace']({
        elements: [{ id: 'e1', type: 'marker' }],
        background: { type: 'image', imageUrl: '/uploads/operation-boards/a.webp' },
      });
    });

    expect(result.current.elements).toEqual([{ id: 'e1', type: 'marker' }]);
    expect(result.current.background).toEqual({
      type: 'image',
      imageUrl: '/uploads/operation-boards/a.webp',
    });
  });

  it('서버가 거절하면 사유를 lastError 로 알린다', () => {
    const { result } = renderHook(() => useOperationBoardSocket(false));
    socketMock.acks = [];

    act(() => {
      result.current.emitElement({ id: 'e1', type: 'marker' });
    });
    expect(socketMock.acks).toHaveLength(1);

    act(() => {
      socketMock.acks[0].ack({ ok: false, reason: '작전판 데이터가 너무 큽니다.' });
    });

    expect(result.current.lastError).toBe('작전판 데이터가 너무 큽니다.');

    act(() => {
      result.current.clearError();
    });
    expect(result.current.lastError).toBe('');
  });

  it('join 이 요청 제한에 걸리면 조용히 빈 보드로 두지 않고 사유를 알린다', () => {
    const { result } = renderHook(() => useOperationBoardSocket(false));

    const joinAck = socketMock.acks.find(
      (entry) => entry.event === 'operation:join',
    );
    expect(joinAck).toBeDefined();

    act(() => {
      joinAck.ack({ ok: false, reason: '작전판 요청이 너무 잦습니다.' });
    });

    expect(result.current.lastError).toBe('작전판 요청이 너무 잦습니다.');
  });

  it('서버 재시작으로 세션 식별자가 바뀌면 라이브 상태 소실을 알린다', () => {
    const { result } = renderHook(() => useOperationBoardSocket(false));

    act(() => {
      socketMock.handlers['operation:state']({
        elements: [{ id: 'e1', type: 'marker' }],
        background: { type: 'grid', imageUrl: null },
        participants: [],
        canDraw: true,
        sessionId: 'session-1',
      });
    });
    expect(result.current.sessionReset).toBe(false);

    act(() => {
      socketMock.handlers['operation:state']({
        elements: [],
        background: { type: 'grid', imageUrl: null },
        participants: [],
        canDraw: true,
        sessionId: 'session-2',
      });
    });

    expect(result.current.sessionReset).toBe(true);
  });
});
