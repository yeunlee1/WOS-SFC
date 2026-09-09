// 전역 소켓 훅이 계약 픽스처(docs/contracts/chat-events.json)를 스토어와 번역 동기화 모듈에 올바르게 흘려보내는지 검증한다.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { useSocket } from '../useSocket';
import { useStore } from '../../store';
import { PUSH_WAIT_MS, HISTORY_FIRST_BATCH_DELAY_MS } from '../../chat/translationSync';

const fixtures = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../docs/contracts/chat-events.json',
    ),
    'utf8',
  ),
);

const socketMocks = vi.hoisted(() => {
  const handlers = {};
  const socket = {
    connected: false,
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    off: vi.fn((event, handler) => {
      if (!handler || handlers[event] === handler) delete handlers[event];
    }),
    emit: vi.fn(),
  };
  return {
    handlers,
    socket,
    connectSocket: vi.fn(() => socket),
    translateBatch: vi.fn(async (targetLang, items) => ({
      translated: Object.fromEntries(
        items.map((item) => [String(item.id), `${targetLang}:${item.text}`]),
      ),
      skipped: [],
      failed: [],
    })),
  };
});

vi.mock('../../api', () => ({
  connectSocket: socketMocks.connectSocket,
  api: { translateBatch: socketMocks.translateBatch },
}));

const user = {
  id: 1,
  nickname: '테스터',
  role: 'member',
  allianceName: 'KOR',
  language: 'ko',
};

// 픽스처를 JSON 왕복시켜 넘긴다 — socket.io 기본 파서와 같은 경로.
const fx = (name) => JSON.parse(JSON.stringify(fixtures[name]));
const languageEmits = () =>
  socketMocks.socket.emit.mock.calls
    .filter((c) => c[0] === 'chat:language')
    .map((c) => c[1]);

function resetMocks() {
  Object.keys(socketMocks.handlers).forEach(
    (key) => delete socketMocks.handlers[key],
  );
  socketMocks.socket.connected = false;
  socketMocks.socket.on.mockClear();
  socketMocks.socket.off.mockClear();
  socketMocks.socket.emit.mockClear();
  socketMocks.connectSocket.mockClear();
  socketMocks.translateBatch.mockClear();
}

describe('useSocket 채팅 v2 계약', () => {
  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
    useStore.setState({
      user,
      chatMessages: [],
      chatTranslations: {},
      chatTranslationPending: {},
      chatTranslationFailed: {},
      onlineUsers: [],
      chatAutoTranslate: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('(a) chat:translation 픽스처가 store 번역 맵에 반영된다', () => {
    const mounted = renderHook(() => useSocket(user, 'en'));
    act(() => socketMocks.handlers.connect());
    act(() => socketMocks.handlers['chat:message'](fx('chat:message')));
    expect(useStore.getState().chatTranslationPending[101]).toBe(true);

    act(() => socketMocks.handlers['chat:translation'](fx('chat:translation')));

    expect(useStore.getState().chatTranslations[101]).toEqual(
      fixtures['chat:translation'].translations,
    );
    expect(useStore.getState().chatTranslationPending[101]).toBeUndefined();
    mounted.unmount();
  });

  it('(b) 히스토리 픽스처의 translations가 맵으로 들어가고 메시지에는 남지 않는다', () => {
    const mounted = renderHook(() => useSocket(user, 'en'));
    act(() => socketMocks.handlers.connect());
    act(() => socketMocks.handlers['chat:history'](fx('chat:history')));

    const state = useStore.getState();
    expect(state.chatMessages.map((m) => m.id)).toEqual([100, 101]);
    expect(state.chatMessages.every((m) => !('translations' in m))).toBe(true);
    expect(state.chatTranslations[101]).toEqual({ en: 'Rally to SFC in 10 min' });
    expect(state.chatTranslations[100]).toBeUndefined();
    mounted.unmount();
  });

  it('(c) 접속 시 chat:language를 보내고 언어·토글이 바뀌면 다시 보낸다 (off면 null)', () => {
    const mounted = renderHook(({ lang }) => useSocket(user, lang), {
      initialProps: { lang: 'en' },
    });
    expect(languageEmits()).toEqual([]);
    act(() => socketMocks.handlers.connect());
    expect(languageEmits()).toEqual([fx('chat:language')]);

    mounted.rerender({ lang: 'ja' });
    expect(languageEmits().at(-1)).toEqual({ lang: 'ja' });

    act(() => useStore.getState().setChatAutoTranslate(false));
    expect(languageEmits().at(-1)).toEqual(fx('chat:language:off'));

    act(() => useStore.getState().setChatAutoTranslate(true));
    expect(languageEmits().at(-1)).toEqual({ lang: 'ja' });
    mounted.unmount();
  });

  it('(c′) other UI 언어는 en으로 보고하고 재접속 때 다시 보고한다', () => {
    const mounted = renderHook(() => useSocket(user, 'other'));
    act(() => socketMocks.handlers.connect());
    act(() => socketMocks.handlers.connect());
    expect(languageEmits()).toEqual([{ lang: 'en' }, { lang: 'en' }]);
    mounted.unmount();
  });

  it('(d) online:updated diff로 입장 1·퇴장 1 시스템 메시지를 만들고 2초 안 5명은 한 줄', () => {
    const mounted = renderHook(() => useSocket(user, 'ko'));
    act(() => socketMocks.handlers.connect());
    act(() => socketMocks.handlers['online:updated'](fx('online:updated')));
    expect(useStore.getState().onlineUsers).toEqual(fixtures['online:updated']);
    expect(useStore.getState().chatMessages).toEqual([]);

    act(() =>
      socketMocks.handlers['online:updated']([
        { nickname: '테스터', alliance: 'KOR', role: 'member' },
        { nickname: 'b', alliance: 'NSL', role: 'member' },
      ]),
    );
    act(() => vi.advanceTimersByTime(2000));
    const first = useStore.getState().chatMessages;
    expect(first.map((m) => [m._type, m.kind, m.nickname])).toEqual([
      ['system', 'joined', 'b'],
      ['system', 'left', 'a'],
    ]);

    const many = ['c', 'd', 'e', 'f', 'g'];
    many.forEach((n, i) => {
      act(() =>
        socketMocks.handlers['online:updated']([
          { nickname: '테스터', alliance: 'KOR', role: 'member' },
          { nickname: 'b', alliance: 'NSL', role: 'member' },
          ...many.slice(0, i + 1).map((x) => ({ nickname: x, alliance: 'JKY', role: 'member' })),
        ]),
      );
      act(() => vi.advanceTimersByTime(200));
    });
    act(() => vi.advanceTimersByTime(2000));
    const added = useStore.getState().chatMessages.slice(2);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ _type: 'system', kind: 'joinedMany', count: 5 });
    mounted.unmount();
  });

  it('(e) chat:system {kind} 객체와 레거시 chat:error·문자열을 모두 시스템 메시지로 만든다', () => {
    const mounted = renderHook(() => useSocket(user, 'ko'));
    act(() => socketMocks.handlers['chat:system'](fx('chat:system')));
    act(() => socketMocks.handlers['chat:error']({ scope: 'history' }));
    act(() => socketMocks.handlers['chat:error']({ scope: 'other' }));
    act(() => socketMocks.handlers['chat:system']('옛 서버 문자열'));

    const messages = useStore.getState().chatMessages;
    expect(messages.map((m) => m.kind)).toEqual(['history_error', 'history_error', 'text']);
    expect(messages[2].text).toBe('옛 서버 문자열');
    expect(messages.every((m) => m._type === 'system' && m._id)).toBe(true);
    mounted.unmount();
  });

  it('(g) 재연결로 같은 히스토리를 다시 받아도 배치가 중복되지 않는다', async () => {
    const mounted = renderHook(() => useSocket(user, 'en'));
    act(() => socketMocks.handlers.connect());
    act(() => socketMocks.handlers['chat:history'](fx('chat:history')));
    await act(() => vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS));
    // 100번(영어 'gg')은 latin이라 후보, 101번은 en 번역이 실려 와서 제외.
    expect(socketMocks.translateBatch).toHaveBeenCalledTimes(1);
    expect(socketMocks.translateBatch.mock.calls[0][1].map((i) => i.id)).toEqual([100]);

    act(() => socketMocks.handlers.connect());
    act(() => socketMocks.handlers['chat:history'](fx('chat:history')));
    await act(() => vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS * 5));
    expect(socketMocks.translateBatch).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it('실시간 메시지는 15초 안에 푸시가 없으면 배치를 요청하고 결과가 맵에 들어간다', async () => {
    const mounted = renderHook(() => useSocket(user, 'en'));
    act(() => socketMocks.handlers.connect());
    act(() => socketMocks.handlers['chat:message'](fx('chat:message')));
    await act(() => vi.advanceTimersByTimeAsync(PUSH_WAIT_MS));
    expect(socketMocks.translateBatch).toHaveBeenCalledTimes(1);
    expect(socketMocks.translateBatch).toHaveBeenCalledWith(
      'en',
      [{ id: 101, text: fixtures['chat:message'].content }],
      expect.objectContaining({ signal: expect.anything() }),
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(useStore.getState().chatTranslations[101]).toEqual({
      en: `en:${fixtures['chat:message'].content}`,
    });
    mounted.unmount();
  });

  it('언마운트하면 핸들러를 해제하고 소켓은 끊지 않는다', () => {
    const mounted = renderHook(() => useSocket(user, 'en'));
    const registered = socketMocks.socket.on.mock.calls.map((c) => c[0]);
    expect(registered).toEqual(
      expect.arrayContaining(['connect', 'chat:translation', 'chat:history', 'chat:message']),
    );
    mounted.unmount();
    const released = socketMocks.socket.off.mock.calls.map((c) => c[0]);
    expect(released.sort()).toEqual(registered.slice().sort());
    expect(socketMocks.socket.disconnect).toBeUndefined();
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
    resetMocks();
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
});
