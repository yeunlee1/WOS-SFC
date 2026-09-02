// 채팅 입력창의 IME 조합 처리와 전송 실패 노출을 ChatTab/ChatDock 양쪽에서 검증한다.
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { CHAT_ACK_TIMEOUT_MS } from '../useChatComposer';
import { useStore } from '../../../store';
import ChatTab from '../ChatTab';
import ChatDock from '../ChatDock';

const socketMock = vi.hoisted(() => {
  const state = { emit: null };
  const socket = {
    emit: vi.fn((...args) => {
      state.emit = args;
    }),
  };
  return { socket, state, present: { value: true } };
});

vi.mock('../../../api', () => ({
  getSocket: () => (socketMock.present.value ? socketMock.socket : null),
}));

// 전송 emit에 붙은 ack 콜백을 꺼낸다.
function lastAck() {
  const args = socketMock.state.emit;
  if (!args) return null;
  const cb = args[args.length - 1];
  return typeof cb === 'function' ? cb : null;
}

function lastContent() {
  const args = socketMock.state.emit;
  return args ? args[1] : null;
}

const CASES = [
  ['ChatTab', () => <ChatTab />],
  ['ChatDock', () => <ChatDock onClose={() => {}} />],
];

describe.each(CASES)('%s 입력창', (_name, renderComponent) => {
  beforeEach(() => {
    // jsdom에는 scrollIntoView가 없다 — 자동 스크롤 effect가 터지지 않게 채운다.
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    socketMock.present.value = true;
    socketMock.state.emit = null;
    socketMock.socket.emit.mockClear();
    useStore.setState({
      chatMessages: [],
      onlineUsers: [],
      chatAutoTranslate: false,
      user: { id: 1, nickname: 'tester', allianceName: 'KOR', language: 'ko' },
    });
    render(<I18nProvider>{renderComponent()}</I18nProvider>);
  });

  afterEach(() => cleanup());

  function input() {
    return screen.getByRole('textbox');
  }

  // ── 항목 3: IME 조합 중 Enter ──
  it.each([
    ['ja', 'にほんご'],
    ['zh', '中文输入'],
    ['ko', '한국어입력'],
  ])('IME(%s) 조합 중 Enter는 전송하지 않는다', (_lang, text) => {
    const el = input();
    fireEvent.compositionStart(el);
    fireEvent.change(el, { target: { value: text } });
    fireEvent.keyDown(el, { key: 'Enter' });

    expect(socketMock.state.emit).toBeNull();
    expect(el.value).toBe(text);
  });

  it('isComposing 플래그가 실린 Enter도 전송하지 않는다', () => {
    const el = input();
    fireEvent.change(el, { target: { value: '조합중' } });
    fireEvent.keyDown(el, { key: 'Enter', isComposing: true });

    expect(socketMock.state.emit).toBeNull();
  });

  it('keyCode 229(구형 크롬 IME) Enter도 전송하지 않는다', () => {
    const el = input();
    fireEvent.change(el, { target: { value: '조합중' } });
    fireEvent.keyDown(el, { key: 'Enter', keyCode: 229 });

    expect(socketMock.state.emit).toBeNull();
  });

  it('조합이 끝난 뒤의 Enter는 전송한다', () => {
    const el = input();
    fireEvent.compositionStart(el);
    fireEvent.change(el, { target: { value: '한국어' } });
    fireEvent.compositionEnd(el, { target: { value: '한국어' } });
    fireEvent.keyDown(el, { key: 'Enter' });

    expect(lastContent()).toBe('한국어');
  });

  // ── 항목 5: 전송 실패 노출 ──
  it('서버 ack 전에는 입력 내용을 지우지 않는다', () => {
    const el = input();
    fireEvent.change(el, { target: { value: 'hello' } });
    fireEvent.keyDown(el, { key: 'Enter' });

    expect(el.value).toBe('hello');
  });

  // 저장소 선례와 같은 계약이어야 한다 —
  // clockSync.js:100  sock.emit('time:ping', null, (res) => ...)
  // Countdown.jsx:239 getSocket()?.emit('countdown:start', s, (ack) => ...)
  it('선례와 같이 emit(event, payload, ack) 3인자 형태로 보낸다', () => {
    const el = input();
    fireEvent.change(el, { target: { value: 'hello' } });
    fireEvent.keyDown(el, { key: 'Enter' });

    expect(socketMock.socket.emit).toHaveBeenCalledTimes(1);
    const args = socketMock.socket.emit.mock.calls[0];
    expect(args).toHaveLength(3);
    expect(args[0]).toBe('chat:message');
    expect(args[1]).toBe('hello');
    expect(args[2]).toBeTypeOf('function');
  });

  it('서버가 거절하면 입력을 보존하고 사유에 맞는 실패를 알린다', () => {
    const el = input();
    fireEvent.change(el, { target: { value: 'hello' } });
    fireEvent.keyDown(el, { key: 'Enter' });

    // 선례와 동일하게 ack 인자는 서버 반환값 하나뿐이다.
    act(() => lastAck()({ ok: false, reason: 'rate_limit' }));

    expect(el.value).toBe('hello');
    const rateLimitText = screen.getByTestId('chat-send-error').textContent;
    expect(rateLimitText.trim().length).toBeGreaterThan(0);

    // 사유를 실제로 읽는지 — 다른 사유는 다른 문구여야 한다.
    fireEvent.keyDown(el, { key: 'Enter' });
    act(() => lastAck()({ ok: false, reason: 'invalid' }));
    expect(screen.getByTestId('chat-send-error').textContent).not.toBe(
      rateLimitText,
    );
  });

  it('ack가 오지 않으면 타임아웃으로 입력을 보존하고 실패를 알린다', () => {
    vi.useFakeTimers();
    try {
      const el = input();
      fireEvent.change(el, { target: { value: 'hello' } });
      fireEvent.keyDown(el, { key: 'Enter' });

      expect(screen.queryByTestId('chat-send-error')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(CHAT_ACK_TIMEOUT_MS);
      });

      expect(el.value).toBe('hello');
      expect(screen.getByTestId('chat-send-error')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('타임아웃 뒤 늦게 도착한 ack가 실패 표시를 뒤엎지 않는다', () => {
    vi.useFakeTimers();
    try {
      const el = input();
      fireEvent.change(el, { target: { value: 'hello' } });
      fireEvent.keyDown(el, { key: 'Enter' });
      const ack = lastAck();
      act(() => {
        vi.advanceTimersByTime(CHAT_ACK_TIMEOUT_MS);
      });

      act(() => ack({ ok: true }));

      expect(el.value).toBe('hello');
      expect(screen.getByTestId('chat-send-error')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('성공 ack에서만 입력창을 비우고 실패 표시를 지운다', () => {
    const el = input();
    fireEvent.change(el, { target: { value: 'hello' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    act(() => lastAck()({ ok: true }));

    expect(el.value).toBe('');
    expect(screen.queryByTestId('chat-send-error')).toBeNull();
  });

  it('소켓이 없으면 조용히 버리지 않고 실패를 알린다', () => {
    socketMock.present.value = false;
    const el = input();
    fireEvent.change(el, { target: { value: 'hello' } });
    fireEvent.keyDown(el, { key: 'Enter' });

    expect(el.value).toBe('hello');
    expect(screen.getByTestId('chat-send-error')).toBeInTheDocument();
  });
});
