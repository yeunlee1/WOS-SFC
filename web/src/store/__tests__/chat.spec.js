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
});
