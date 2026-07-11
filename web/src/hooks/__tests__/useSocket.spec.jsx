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
