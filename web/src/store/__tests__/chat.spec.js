// 채팅 기록의 중앙 저장, 중복 제거, 번역 맵, 번역 설정 지속을 검증한다.
import { beforeEach, describe, expect, it } from 'vitest';
import { ALLIANCES, ALLIANCE_COLORS, getChatMessageKey, useStore } from '../index';

function resetStore() {
  localStorage.clear();
  useStore.setState({
    chatMessages: [],
    chatTranslations: {},
    chatTranslationPending: {},
    chatTranslationFailed: {},
    chatAutoTranslate: false,
  });
}

describe('chat store', () => {
  beforeEach(resetStore);

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

  it('키 형식은 message:{id} / system:{_id} 를 유지한다', () => {
    expect(getChatMessageKey({ id: 7 })).toBe('message:7');
    expect(getChatMessageKey({ _type: 'system', _id: 'abc' })).toBe('system:abc');
  });

  // B-4: 같은 id를 다시 받으면 서버가 보낸 필드가 이긴다 (기존은 previous가 덮었다).
  it('같은 id를 다시 받으면 서버(incoming) 필드가 이긴다', () => {
    const store = useStore.getState();
    store.appendChatMessage({
      id: 5,
      content: 'old',
      nickname: 'a',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    store.setChatHistory([
      {
        id: 5,
        content: 'new',
        nickname: 'a',
        allianceName: 'KOR',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(useStore.getState().chatMessages[0]).toMatchObject({
      id: 5,
      content: 'new',
      allianceName: 'KOR',
    });
  });

  // B-5: 번역은 메시지 객체가 아니라 id → { lang: text } 맵에 둔다.
  it('mergeChatTranslations는 기존 언어를 유지하고 새 언어를 더한다', () => {
    const store = useStore.getState();
    store.appendChatMessage({ id: 7, content: '안녕' });
    store.mergeChatTranslations(7, { en: 'hello' });
    store.mergeChatTranslations(7, { ja: 'こんにちは' });

    expect(useStore.getState().chatTranslations[7]).toEqual({
      en: 'hello',
      ja: 'こんにちは',
    });
    expect(useStore.getState().chatMessages[0]).not.toHaveProperty(
      'translatedContent',
    );
    expect(useStore.getState().setChatMessageTranslation).toBeUndefined();
  });

  it('히스토리 항목의 translations는 맵으로 옮기고 메시지 객체에는 남기지 않는다', () => {
    const store = useStore.getState();
    store.mergeChatTranslations(100, { ja: 'gg' });
    store.setChatHistory([
      {
        id: 100,
        content: 'gg',
        createdAt: '2026-09-09T23:59:00.000Z',
        translations: {},
      },
      {
        id: 101,
        content: '10분 뒤 SFC 집결 갑니다',
        createdAt: '2026-09-10T00:00:00.000Z',
        translations: { en: 'Rally to SFC in 10 min' },
      },
    ]);

    const state = useStore.getState();
    expect(state.chatMessages.map((m) => m.id)).toEqual([100, 101]);
    expect(state.chatMessages.every((m) => !('translations' in m))).toBe(true);
    // 먼저 받은 푸시(ja)는 빈 히스토리 translations에 덮이지 않는다.
    expect(state.chatTranslations[100]).toEqual({ ja: 'gg' });
    expect(state.chatTranslations[101]).toEqual({ en: 'Rally to SFC in 10 min' });
  });

  it('mergeChatTranslationsBulk는 여러 id를 한 번에 합친다', () => {
    const store = useStore.getState();
    store.mergeChatTranslations(1, { en: 'one' });
    store.mergeChatTranslationsBulk([
      [1, { ja: 'いち' }],
      [2, { en: 'two' }],
    ]);
    expect(useStore.getState().chatTranslations).toEqual({
      1: { en: 'one', ja: 'いち' },
      2: { en: 'two' },
    });
  });

  it('pending/failed 표시를 켜고 끌 수 있고 failed는 pending을 지운다', () => {
    const store = useStore.getState();
    store.markTranslationPending([1, 2, 3]);
    expect(useStore.getState().chatTranslationPending).toEqual({
      1: true,
      2: true,
      3: true,
    });
    store.clearTranslationPending([2]);
    expect(useStore.getState().chatTranslationPending).toEqual({ 1: true, 3: true });
    store.markTranslationFailed([1]);
    expect(useStore.getState().chatTranslationPending).toEqual({ 3: true });
    expect(useStore.getState().chatTranslationFailed).toEqual({ 1: true });
    store.clearTranslationFailed(1);
    expect(useStore.getState().chatTranslationFailed).toEqual({});
    store.resetTranslationStatus();
    expect(useStore.getState().chatTranslationPending).toEqual({});
  });

  // C-3: 500건 상한으로 밀린 id는 번역 맵·상태에서도 사라진다.
  it('상한으로 밀린 id는 pruneChatTranslations 뒤 맵에서 사라진다', () => {
    const store = useStore.getState();
    for (let i = 0; i < 520; i += 1) {
      store.appendChatMessage({
        id: i + 1,
        content: `real-${i}`,
        createdAt: new Date(1735689600000 + i * 1000).toISOString(),
      });
    }
    useStore.setState({
      chatTranslations: { 1: { en: 'gone' }, 21: { en: 'kept' }, 999: { en: 'x' } },
      chatTranslationPending: { 1: true, 21: true },
      chatTranslationFailed: { 2: true, 22: true },
    });
    store.pruneChatTranslations();

    const state = useStore.getState();
    expect(state.chatTranslations).toEqual({ 21: { en: 'kept' } });
    expect(state.chatTranslationPending).toEqual({ 21: true });
    expect(state.chatTranslationFailed).toEqual({ 22: true });
  });

  it('메시지를 더 받아 상한을 넘기면 자동으로도 정리된다', () => {
    const store = useStore.getState();
    for (let i = 0; i < 500; i += 1) {
      store.appendChatMessage({
        id: i + 1,
        content: `real-${i}`,
        createdAt: new Date(1735689600000 + i * 1000).toISOString(),
      });
    }
    store.mergeChatTranslations(1, { en: 'first' });
    store.appendChatMessage({
      id: 501,
      content: 'push',
      createdAt: new Date(1735689600000 + 501 * 1000).toISOString(),
    });
    expect(useStore.getState().chatMessages[0].id).toBe(2);
    expect(useStore.getState().chatTranslations[1]).toBeUndefined();
  });

  it('로그아웃(clearUser)은 번역 맵과 상태도 비운다', () => {
    const store = useStore.getState();
    store.appendChatMessage({ id: 1, content: 'a' });
    store.mergeChatTranslations(1, { en: 'a' });
    store.markTranslationPending([1]);
    store.clearUser();
    const state = useStore.getState();
    expect(state.chatMessages).toEqual([]);
    expect(state.chatTranslations).toEqual({});
    expect(state.chatTranslationPending).toEqual({});
    expect(state.chatTranslationFailed).toEqual({});
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

// B-18: 연맹 색표는 store에 한 벌만 둔다. UFO는 채팅·온라인 패널이 쓰던 값으로 통일.
describe('ALLIANCE_COLORS', () => {
  it('ALLIANCES 다섯 개 모두에 색이 있고 UFO는 #ec4899', () => {
    for (const a of ALLIANCES) {
      expect(ALLIANCE_COLORS[a]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(ALLIANCE_COLORS.UFO).toBe('#ec4899');
  });
});
