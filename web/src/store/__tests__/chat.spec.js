// 채팅 기록의 중앙 저장, 중복 제거, 번역 설정 지속을 검증한다.
import { beforeEach, describe, expect, it } from 'vitest';
import { getChatMessageKey, useStore } from '../index';

describe('chat store', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ chatMessages: [], chatAutoTranslate: false });
  });

  it('merges history and live messages by server id without duplicates', () => {
    const store = useStore.getState();
    store.setChatHistory([
      { id: 1, content: 'first', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, content: 'second', createdAt: '2026-01-01T00:00:01.000Z' },
    ]);
    store.appendChatMessage({
      id: 2,
      content: 'second',
      createdAt: '2026-01-01T00:00:01.000Z',
    });
    store.appendChatMessage({
      id: 3,
      content: 'third',
      createdAt: '2026-01-01T00:00:02.000Z',
    });
    store.setChatHistory([
      { id: 1, content: 'first', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, content: 'second', createdAt: '2026-01-01T00:00:01.000Z' },
    ]);

    expect(
      useStore.getState().chatMessages.map((message) => message.id),
    ).toEqual([1, 2, 3]);
  });

  it('stores a translation against the stable message key', () => {
    const store = useStore.getState();
    const message = { id: 7, content: '안녕' };
    store.appendChatMessage(message);
    store.setChatMessageTranslation(getChatMessageKey(message), 'hello', 'en');

    expect(useStore.getState().chatMessages[0]).toMatchObject({
      translatedContent: 'hello',
      translatedLanguage: 'en',
    });
  });

  it('persists the shared auto-translate toggle', () => {
    useStore.getState().setChatAutoTranslate(true);

    expect(useStore.getState().chatAutoTranslate).toBe(true);
    expect(localStorage.getItem('wos-chat-auto-translate')).toBe('1');
  });

  it('입퇴장 시스템 메시지가 실제 채팅을 버퍼에서 밀어내지 않는다', () => {
    const store = useStore.getState();

    // 실제 대화 10건이 먼저 쌓인다.
    for (let i = 0; i < 10; i += 1) {
      store.appendChatMessage({
        id: i + 1,
        content: `real-${i}`,
        createdAt: new Date(1735689600000 + i * 1000).toISOString(),
      });
    }
    // 그 뒤 100명 규모의 입퇴장이 몰아친다 (600건 > 버퍼 500).
    for (let i = 0; i < 600; i += 1) {
      store.appendChatMessage({
        _type: 'system',
        _id: `sys-${i}`,
        text: `join-${i}`,
        createdAt: new Date(1735689700000 + i * 1000).toISOString(),
      });
    }

    const kept = useStore.getState().chatMessages;
    const realIds = kept
      .filter((m) => m._type !== 'system')
      .map((m) => m.id);

    expect(realIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(kept.filter((m) => m._type === 'system').length).toBeLessThanOrEqual(
      100,
    );
  });

  it('실제 채팅 자체는 500건 상한을 유지한다', () => {
    const store = useStore.getState();
    for (let i = 0; i < 520; i += 1) {
      store.appendChatMessage({
        id: i + 1,
        content: `real-${i}`,
        createdAt: new Date(1735689600000 + i * 1000).toISOString(),
      });
    }

    const real = useStore
      .getState()
      .chatMessages.filter((m) => m._type !== 'system');
    expect(real).toHaveLength(500);
    expect(real[0].id).toBe(21);
    expect(real[real.length - 1].id).toBe(520);
  });
});
