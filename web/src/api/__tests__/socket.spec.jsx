// Socket.IO singleton 재사용과 신뢰 경계용 API payload를 검증한다.
import React, { StrictMode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, connectSocket, disconnectSocket, getSocket } from '../index';
import { useSocket } from '../../hooks/useSocket';
import { useReadyProbe } from '../../hooks/useReadyProbe';

const socketMocks = vi.hoisted(() => {
  const handlers = {};
  const socket = {
    connected: false,
    id: undefined,
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
      return socket;
    }),
    off: vi.fn((event, handler) => {
      if (!handler || handlers[event] === handler) delete handlers[event];
      return socket;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return { socket, handlers, io: vi.fn(() => socket) };
});

vi.mock('socket.io-client', () => ({ io: socketMocks.io }));

const user = {
  id: 1,
  nickname: 'tester',
  role: 'member',
  allianceName: 'KOR',
  language: 'ko',
};

function SocketHarness() {
  useSocket(user, 'ko');
  useReadyProbe(user);
  return null;
}

describe('socket singleton', () => {
  beforeEach(() => {
    cleanup();
    disconnectSocket();
    socketMocks.io.mockClear();
    socketMocks.socket.on.mockClear();
    socketMocks.socket.off.mockClear();
    socketMocks.socket.emit.mockClear();
    socketMocks.socket.disconnect.mockClear();
    socketMocks.socket.connected = false;
    Object.keys(socketMocks.handlers).forEach(
      (key) => delete socketMocks.handlers[key],
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    disconnectSocket();
    vi.unstubAllGlobals();
  });

  it('reuses the same socket while the initial connection is still pending', () => {
    const first = connectSocket();
    const second = connectSocket();

    expect(first).toBe(second);
    expect(socketMocks.io).toHaveBeenCalledTimes(1);
  });

  it('expires auth only when the server forcibly disconnects the socket', () => {
    const onExpired = vi.fn();
    window.addEventListener('auth:expired', onExpired);

    try {
      const socket = connectSocket();

      socketMocks.handlers.disconnect('transport close');
      expect(getSocket()).toBe(socket);
      expect(onExpired).not.toHaveBeenCalled();

      socketMocks.handlers.disconnect('io server disconnect');
      expect(getSocket()).toBeNull();
      expect(onExpired).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('auth:expired', onExpired);
    }
  });

  it('does not expire auth during a manual disconnect', () => {
    const onExpired = vi.fn();
    window.addEventListener('auth:expired', onExpired);

    try {
      connectSocket();
      socketMocks.handlers.disconnect('io client disconnect');
      disconnectSocket();

      expect(getSocket()).toBeNull();
      expect(onExpired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('auth:expired', onExpired);
    }
  });

  it('keeps one connection when useSocket and useReadyProbe mount under StrictMode', () => {
    render(
      <StrictMode>
        <SocketHarness />
      </StrictMode>,
    );

    expect(socketMocks.io).toHaveBeenCalledTimes(1);
  });

  it('does not send client-supplied identity fields when creating a board post', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: 1 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.addBoardPost('KOR', {
      content: '작전 공유',
      lang: 'ko',
      nickname: 'spoofed-user',
      userAlliance: 'UFO',
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      alliance: 'KOR',
      content: '작전 공유',
      lang: 'ko',
    });
  });

  it('번역 429의 상태와 retryAfterMs를 호출자에게 보존한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 429,
        headers: { get: () => null },
        json: async () => ({ message: 'rate limited', retryAfterMs: 12_345 }),
      })),
    );

    await expect(api.translate('안녕', 'en')).rejects.toMatchObject({
      message: 'rate limited',
      status: 429,
      retryAfterMs: 12_345,
    });
  });

  it('응답이 끝나지 않는 API 요청을 35초 뒤 중단한다', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_, options) =>
          new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => {
              reject(options.signal.reason || new Error('aborted'));
            });
          }),
      ),
    );

    const pending = expect(api.translate('안녕', 'en')).rejects.toBeTruthy();
    await vi.advanceTimersByTimeAsync(35_000);

    await pending;
  });

  it('401 뒤 refresh가 멈추면 35초 후 인증을 만료하고 공유 Promise를 비운다', async () => {
    vi.useFakeTimers();
    const onExpired = vi.fn();
    window.addEventListener('auth:expired', onExpired);
    const unauthorized = {
      ok: false,
      status: 401,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorized)
      .mockImplementationOnce(
        (_, options) =>
          new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => {
              reject(options.signal.reason || new Error('aborted'));
            });
          }),
      );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const pending = expect(api.translate('안녕', 'en')).rejects.toThrow(
        '세션이 만료되었습니다',
      );
      await vi.advanceTimersByTimeAsync(35_000);
      await pending;

      fetchMock
        .mockResolvedValueOnce(unauthorized)
        .mockResolvedValueOnce({ ok: false, status: 401 });
      await expect(api.translate('다시', 'en')).rejects.toThrow(
        '세션이 만료되었습니다',
      );

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(onExpired).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('auth:expired', onExpired);
    }
  });

  it('refresh 성공 뒤에도 401이면 한 번만 재시도하고 인증을 만료한다', async () => {
    const onExpired = vi.fn();
    window.addEventListener('auth:expired', onExpired);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: true, status: 204 })
        .mockResolvedValueOnce({ ok: false, status: 401 }),
    );

    try {
      await expect(api.translate('안녕', 'en')).rejects.toThrow(
        '세션이 만료되었습니다',
      );
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(onExpired).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('auth:expired', onExpired);
    }
  });
});
