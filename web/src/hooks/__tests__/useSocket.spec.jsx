// 전역 소켓 훅의 채팅 기록 유지와 자동번역 호출 조건을 검증한다.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocket } from '../useSocket';
import { useStore } from '../../store';

const socketMocks = vi.hoisted(() => {
  const handlers = {};
  const socket = {
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    off: vi.fn((event, handler) => {
      if (!handler || handlers[event] === handler) delete handlers[event];
    }),
  };
  return {
    handlers,
    socket,
    connectSocket: vi.fn(() => socket),
    translateChatMessage: vi.fn(async (message, language) => ({
      ...message,
      translatedContent: 'hello',
      translatedLanguage: language,
    })),
  };
});

vi.mock('../../api', () => ({
  connectSocket: socketMocks.connectSocket,
  translateChatMessage: socketMocks.translateChatMessage,
}));

const user = {
  id: 1,
  nickname: 'tester',
  role: 'member',
  allianceName: 'KOR',
  language: 'ko',
};

describe('useSocket chat state', () => {
  beforeEach(() => {
    Object.keys(socketMocks.handlers).forEach(
      (key) => delete socketMocks.handlers[key],
    );
    socketMocks.socket.on.mockClear();
    socketMocks.socket.off.mockClear();
    socketMocks.connectSocket.mockClear();
    socketMocks.translateChatMessage.mockClear();
    useStore.setState({
      user,
      chatMessages: [],
      chatAutoTranslate: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps history in the store and translates only after the toggle is enabled', async () => {
    const firstMount = renderHook(() => useSocket(user, 'en'));
    const message = {
      id: 10,
      nickname: '한국인',
      language: 'ko',
      content: '안녕',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    act(() => socketMocks.handlers['chat:history']([message]));
    expect(useStore.getState().chatMessages).toHaveLength(1);
    expect(socketMocks.translateChatMessage).not.toHaveBeenCalled();

    firstMount.unmount();
    renderHook(() => useSocket(user, 'en'));
    expect(useStore.getState().chatMessages).toHaveLength(1);

    act(() => useStore.getState().setChatAutoTranslate(true));
    await waitFor(() =>
      expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(1),
    );
    expect(socketMocks.translateChatMessage).toHaveBeenCalledWith(
      message,
      'en',
      expect.objectContaining({ signal: expect.anything() }),
    );
    await waitFor(() => {
      expect(useStore.getState().chatMessages[0]).toMatchObject({
        translatedContent: 'hello',
        translatedLanguage: 'en',
      });
    });

    act(() => socketMocks.handlers['chat:message'](message));
    expect(useStore.getState().chatMessages).toHaveLength(1);
  });

  it('paces history translation requests and eventually processes the queue', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    useStore.setState({ chatAutoTranslate: true });
    const mounted = renderHook(() => useSocket(user, 'en'));
    const messages = [1, 2, 3].map((id) => ({
      id,
      nickname: `user-${id}`,
      language: 'ko',
      content: `message-${id}`,
      createdAt: `2026-01-01T00:00:0${id}.000Z`,
    }));

    act(() => socketMocks.handlers['chat:history'](messages));
    await vi.advanceTimersByTimeAsync(0);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6499);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(6500);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(3);
    expect(
      useStore
        .getState()
        .chatMessages.every(
          (message) =>
            message.translatedContent === 'hello' &&
            message.translatedLanguage === 'en',
        ),
    ).toBe(true);

    act(() => useStore.getState().setChatAutoTranslate(false));
    mounted.unmount();
  });

  it('retries a throttled translation without starting a burst', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-01-01T00:00:00.000Z'));
    socketMocks.translateChatMessage
      .mockResolvedValueOnce({ id: 20, language: 'ko', content: '재시도' })
      .mockResolvedValueOnce({
        id: 20,
        language: 'ko',
        content: '재시도',
        translatedContent: 'retry',
        translatedLanguage: 'en',
      });
    useStore.setState({ chatAutoTranslate: true });
    const mounted = renderHook(() => useSocket(user, 'en'));
    const message = {
      id: 20,
      nickname: 'retry-user',
      language: 'ko',
      content: '재시도',
      createdAt: '2026-01-01T00:00:20.000Z',
    };

    act(() => socketMocks.handlers['chat:history']([message]));
    await vi.advanceTimersByTimeAsync(0);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6499);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(2);
    expect(useStore.getState().chatMessages[0]).toMatchObject({
      translatedContent: 'retry',
      translatedLanguage: 'en',
    });

    act(() => useStore.getState().setChatAutoTranslate(false));
    mounted.unmount();
  });

  it('429 응답은 서버가 준 retryAfterMs 이후에 다시 시도한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2032-01-01T00:00:00.000Z'));
    const throttled = Object.assign(new Error('rate limited'), {
      status: 429,
      retryAfterMs: 60_000,
    });
    socketMocks.translateChatMessage
      .mockRejectedValueOnce(throttled)
      .mockResolvedValueOnce({
        id: 30,
        language: 'ko',
        content: '제한 재시도',
        translatedContent: 'retried after window',
        translatedLanguage: 'en',
      });
    useStore.setState({ chatAutoTranslate: true });
    const mounted = renderHook(() => useSocket(user, 'en'));
    const message = {
      id: 30,
      nickname: 'rate-user',
      language: 'ko',
      content: '제한 재시도',
      createdAt: '2026-01-01T00:00:30.000Z',
    };

    act(() => socketMocks.handlers['chat:history']([message]));
    await vi.advanceTimersByTimeAsync(0);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_249);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(2);
    expect(useStore.getState().chatMessages[0]).toMatchObject({
      translatedContent: 'retried after window',
    });

    act(() => useStore.getState().setChatAutoTranslate(false));
    mounted.unmount();
  });

  it('끝나지 않는 번역 작업을 watchdog으로 넘기고 다음 메시지를 처리한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2033-01-01T00:00:00.000Z'));
    socketMocks.translateChatMessage
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation(async (message, language) => ({
        ...message,
        translatedContent: `translated-${message.id}`,
        translatedLanguage: language,
      }));
    useStore.setState({ chatAutoTranslate: true });
    const mounted = renderHook(() => useSocket(user, 'en'));
    const messages = [40, 41].map((id) => ({
      id,
      nickname: `timeout-${id}`,
      language: 'ko',
      content: `timeout-message-${id}`,
      createdAt: `2026-01-01T00:00:${id}.000Z`,
    }));

    act(() => socketMocks.handlers['chat:history'](messages));
    await vi.advanceTimersByTimeAsync(0);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(39_999);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(6_500);
    expect(socketMocks.translateChatMessage).toHaveBeenCalledTimes(2);
    expect(useStore.getState().chatMessages[1]).toMatchObject({
      translatedContent: 'translated-41',
    });

    act(() => useStore.getState().setChatAutoTranslate(false));
    mounted.unmount();
  });
});

// 재접속 복구 경로 — 서버(RallyGroupsGateway.handleConnection)가 접속한 소켓에만
// rallyGroup:updated + rallyGroup:countdown:start 를 되돌려준다.
// 이 훅이 두 이벤트를 스토어까지 흘려보내야 RallyGroupPanel이 running으로 렌더된다.
describe('useSocket 집결 그룹 재접속 스냅샷', () => {
  const STARTED_AT = 1_800_000_000_000;
  const FIRE_OFFSETS = [
    { orderIndex: 1, offsetMs: 0, userId: 11 },
    { orderIndex: 2, offsetMs: 187_000, userId: 12 },
  ];

  beforeEach(() => {
    Object.keys(socketMocks.handlers).forEach(
      (key) => delete socketMocks.handlers[key],
    );
    socketMocks.socket.on.mockClear();
    socketMocks.socket.off.mockClear();
    useStore.setState({ user, rallyGroups: [], rallyCountdowns: {} });
  });

  it('스냅샷 두 이벤트를 스토어에 반영해 남은 슬롯의 절대시각을 복원한다', () => {
    const mounted = renderHook(() => useSocket(user, 'ko'));

    act(() => {
      socketMocks.handlers['rallyGroup:updated']({
        id: 'g1',
        name: '1번 집결그룹',
        displayOrder: 1,
        state: 'running',
        members: [],
      });
      socketMocks.handlers['rallyGroup:countdown:start']({
        groupId: 'g1',
        startedAtServerMs: STARTED_AT,
        fireOffsets: FIRE_OFFSETS,
      });
    });

    const state = useStore.getState();
    expect(state.rallyGroups.find((g) => g.id === 'g1')?.state).toBe('running');
    const countdown = state.rallyCountdowns.g1;
    expect(countdown).toEqual({
      groupId: 'g1',
      startedAtServerMs: STARTED_AT,
      fireOffsets: FIRE_OFFSETS,
    });
    // 스케줄러가 쓰는 절대시각이 그대로 복원되는지 수치로 확인
    expect(
      countdown.fireOffsets.map((f) => countdown.startedAtServerMs + f.offsetMs),
    ).toEqual([STARTED_AT, STARTED_AT + 187_000]);

    mounted.unmount();
  });

  it('정지 이벤트가 오면 복원된 카운트다운을 비운다', () => {
    const mounted = renderHook(() => useSocket(user, 'ko'));

    act(() => {
      socketMocks.handlers['rallyGroup:countdown:start']({
        groupId: 'g1',
        startedAtServerMs: STARTED_AT,
        fireOffsets: FIRE_OFFSETS,
      });
    });
    expect(useStore.getState().rallyCountdowns.g1).toBeDefined();

    act(() => socketMocks.handlers['rallyGroup:countdown:stop']({ groupId: 'g1' }));
    expect(useStore.getState().rallyCountdowns.g1).toBeUndefined();

    mounted.unmount();
  });

  it('히스토리 조회 실패(chat:error)를 시스템 메시지로 드러낸다', () => {
    useStore.setState({ chatMessages: [] });
    renderHook(() => useSocket(user, 'ko'));

    act(() => {
      socketMocks.handlers['chat:error']({ scope: 'history' });
    });

    const messages = useStore.getState().chatMessages;
    expect(messages).toHaveLength(1);
    expect(messages[0]._type).toBe('system');
    expect(messages[0].text.trim().length).toBeGreaterThan(0);
  });
});
