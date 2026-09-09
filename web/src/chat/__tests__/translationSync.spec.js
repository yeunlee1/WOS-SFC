// 채팅 번역 동기화 상태 기계 — 푸시 반영·폴백·배치 상한·재시도·리셋 규칙을 가짜 타이머로 고정한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { useStore } from '../../store';
import {
  BATCH_MAX_CHARS,
  BATCH_MAX_ITEMS,
  BATCH_MIN_INTERVAL_MS,
  HISTORY_FIRST_BATCH_COUNT,
  HISTORY_FIRST_BATCH_DELAY_MS,
  PUSH_WAIT_MS,
  RETRY_DELAYS_MS,
  createTranslationSync,
} from '../translationSync';

const fixtures = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../docs/contracts/chat-events.json',
    ),
    'utf8',
  ),
);

const T0 = 1_800_000_000_000;
function msg(id, content, extra = {}) {
  return {
    id,
    nickname: `u${id}`,
    allianceName: 'KOR',
    language: 'ko',
    content,
    createdAt: new Date(T0 + id * 1000).toISOString(),
    ...extra,
  };
}

function okBatch(targetLang, items) {
  return {
    translated: Object.fromEntries(
      items.map((item) => [String(item.id), `${targetLang}:${item.text}`]),
    ),
    skipped: [],
    failed: [],
  };
}

function makeSync(overrides = {}) {
  const translateBatch = vi.fn(async (targetLang, items) =>
    okBatch(targetLang, items),
  );
  const emitLanguage = vi.fn();
  const sync = createTranslationSync({
    store: useStore,
    translateBatch,
    emitLanguage,
    ...overrides,
  });
  return { sync, translateBatch, emitLanguage };
}

const state = () => useStore.getState();
const calledIds = (fn, n) => fn.mock.calls[n][1].map((item) => item.id);

describe('translationSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    useStore.setState({
      chatMessages: [],
      chatTranslations: {},
      chatTranslationPending: {},
      chatTranslationFailed: {},
      chatAutoTranslate: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 규칙 1 — 언어 보고와 타이머 리셋
  describe('규칙 1: chat:language 보고', () => {
    it('접속·언어 변경·토글 변경 때 emitLanguage를 부르고 off면 null', () => {
      const { sync, emitLanguage } = makeSync();
      sync.onConnect('en', true);
      expect(emitLanguage).toHaveBeenLastCalledWith('en');
      sync.onLanguageChange('ja');
      expect(emitLanguage).toHaveBeenLastCalledWith('ja');
      sync.onAutoTranslateChange(false);
      expect(emitLanguage).toHaveBeenLastCalledWith(null);
      sync.onAutoTranslateChange(true);
      expect(emitLanguage).toHaveBeenLastCalledWith('ja');
      expect(emitLanguage).toHaveBeenCalledTimes(4);
    });

    it('other·미지 UI 언어는 en으로 보고한다', () => {
      const { sync, emitLanguage } = makeSync();
      sync.onConnect('other', true);
      expect(emitLanguage).toHaveBeenLastCalledWith('en');
    });

    it('같은 값으로 다시 부르면 다시 보고하지 않는다', () => {
      const { sync, emitLanguage } = makeSync();
      sync.onConnect('en', true);
      sync.onLanguageChange('en');
      sync.onAutoTranslateChange(true);
      expect(emitLanguage).toHaveBeenCalledTimes(1);
    });

    it('접속 전 언어 변경은 보고하지 않고, 재접속 때 다시 보고한다', () => {
      const { sync, emitLanguage } = makeSync();
      sync.onLanguageChange('ja');
      expect(emitLanguage).not.toHaveBeenCalled();
      sync.onConnect('ja', true);
      sync.onConnect('ja', true);
      expect(emitLanguage).toHaveBeenCalledTimes(2);
    });

    it('언어를 바꾸면 대기 타이머가 리셋되어 옛 언어 폴백이 나가지 않는다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('en', true);
      state().appendChatMessage(msg(1, '집결 갑니다'));
      sync.onMessage(msg(1, '집결 갑니다'));
      sync.onLanguageChange('ja');
      await vi.advanceTimersByTimeAsync(PUSH_WAIT_MS + HISTORY_FIRST_BATCH_DELAY_MS);
      // ja로는 스토어 재검사 배치 1회만, en 요청은 없어야 한다.
      expect(translateBatch.mock.calls.every((c) => c[0] === 'ja')).toBe(true);
      expect(translateBatch).toHaveBeenCalledTimes(1);
    });
  });

  // 규칙 2 — 푸시 반영
  describe('규칙 2: onPushed', () => {
    it('픽스처 chat:translation을 즉시 맵에 병합하고 폴백을 취소한다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('en', true);
      const m = msg(101, fixtures['chat:message'].content);
      state().appendChatMessage(m);
      sync.onMessage(m);
      expect(state().chatTranslationPending[101]).toBe(true);

      sync.onPushed(fixtures['chat:translation']);

      expect(state().chatTranslations[101]).toEqual(
        fixtures['chat:translation'].translations,
      );
      expect(state().chatTranslationPending[101]).toBeUndefined();
      await vi.advanceTimersByTimeAsync(PUSH_WAIT_MS + 1000);
      expect(translateBatch).not.toHaveBeenCalled();
    });

    it('failed에 내 언어가 있으면 15초 뒤 배치 후보에 넣는다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('en', true);
      const m = msg(101, fixtures['chat:message'].content);
      state().appendChatMessage(m);
      sync.onMessage(m);
      sync.onPushed(fixtures['chat:translation:failed']);

      await vi.advanceTimersByTimeAsync(PUSH_WAIT_MS - 1);
      expect(translateBatch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      expect(calledIds(translateBatch, 0)).toEqual([101]);
      expect(state().chatTranslations[101]).toEqual({ en: 'en:10분 뒤 SFC 집결 갑니다' });
    });

    it('translations:{} (대상 없음)이면 폴백 타이머를 취소하고 대기 표시를 지운다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('en', true);
      const m = msg(102, '숫자만 아닌 한국어');
      state().appendChatMessage(m);
      sync.onMessage(m);
      sync.onPushed(fixtures['chat:translation:empty']);

      expect(state().chatTranslationPending[102]).toBeUndefined();
      await vi.advanceTimersByTimeAsync(PUSH_WAIT_MS + 1000);
      expect(translateBatch).not.toHaveBeenCalled();
    });

    it('다른 언어만 실려 오면 폴백 타이머는 그대로 돈다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('zh', true);
      const m = msg(101, fixtures['chat:message'].content);
      state().appendChatMessage(m);
      sync.onMessage(m);
      sync.onPushed(fixtures['chat:translation']); // en·ja만

      await vi.advanceTimersByTimeAsync(PUSH_WAIT_MS);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      expect(translateBatch.mock.calls[0][0]).toBe('zh');
    });
  });

  // 규칙 3 — 실시간 메시지 폴백
  describe('규칙 3: onMessage', () => {
    it('외국어 메시지는 15초 안에 푸시가 없으면 배치를 요청한다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('en', true);
      const m = msg(1, '집결 갑니다');
      state().appendChatMessage(m);
      sync.onMessage(m);
      await vi.advanceTimersByTimeAsync(PUSH_WAIT_MS - 1);
      expect(translateBatch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      expect(calledIds(translateBatch, 0)).toEqual([1]);
    });

    it('내 언어가 확실한 메시지·글자 없는 메시지·자동번역 off면 아무것도 안 한다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('ko', true);
      state().setChatHistory([msg(1, '집결 갑니다'), msg(2, '456,789 👍')]);
      sync.onMessage(msg(1, '집결 갑니다'));
      sync.onMessage(msg(2, '456,789 👍'));
      sync.onAutoTranslateChange(false);
      sync.onMessage(msg(3, 'hello there'));
      await vi.advanceTimersByTimeAsync(PUSH_WAIT_MS + 1000);
      expect(translateBatch).not.toHaveBeenCalled();
      expect(state().chatTranslationPending).toEqual({});
    });
  });

  // 규칙 4 — 히스토리 최신 50건 우선, 나머지는 스크롤
  describe('규칙 4: onHistory / onScrolledToOlder', () => {
    it('내 언어 번역이 없는 최신 50건만 1초 뒤 배치하고 나머지는 스크롤 때 요청한다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('en', true);
      const history = [];
      for (let id = 1; id <= 60; id += 1) {
        history.push(
          msg(id, `한국어 ${id}`, {
            translations: id % 10 === 0 ? { en: `already ${id}` } : {},
          }),
        );
      }
      state().setChatHistory(history);
      sync.onHistory(history);

      await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS - 1);
      expect(translateBatch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(translateBatch).toHaveBeenCalledTimes(1);

      // 후보 54건(번역 없는 것) 중 최신 50건 → 20·20·10 세 번, 1초 간격.
      await vi.advanceTimersByTimeAsync(BATCH_MIN_INTERVAL_MS * 3);
      expect(translateBatch).toHaveBeenCalledTimes(3);
      const requested = translateBatch.mock.calls.flatMap((c) => c[1].map((i) => i.id));
      expect(requested).toHaveLength(HISTORY_FIRST_BATCH_COUNT);
      expect(Math.min(...requested)).toBe(5); // 54 − 50 = 오래된 4건(1~4)은 스크롤 전까지 미요청
      expect(requested).not.toContain(10);
      expect(requested).not.toContain(60);

      sync.onScrolledToOlder([1, 2, 3, 4, 10]);
      await vi.advanceTimersByTimeAsync(BATCH_MIN_INTERVAL_MS);
      expect(translateBatch).toHaveBeenCalledTimes(4);
      expect(calledIds(translateBatch, 3)).toEqual([1, 2, 3, 4]);
    });

    it('재접속으로 같은 히스토리를 다시 받아도 중복 배치가 없다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('en', true);
      const history = [msg(1, '하나'), msg(2, '둘')];
      state().setChatHistory(history);
      sync.onHistory(history);
      await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS);
      expect(translateBatch).toHaveBeenCalledTimes(1);

      // 재접속 — 서버가 번역이 실린 히스토리를 다시 보낸다.
      sync.onConnect('en', true);
      const again = history.map((m) => ({ ...m, translations: { en: `en:${m.content}` } }));
      state().setChatHistory(again);
      sync.onHistory(again);
      await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS * 5);
      expect(translateBatch).toHaveBeenCalledTimes(1);
    });
  });

  // 규칙 5 — 배치 상한과 페이싱
  describe('규칙 5: 배치 상한', () => {
    it('항목 20개 상한과 원문 합 2000자 상한을 함께 지킨다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('en', true);
      const long = '가'.repeat(500);
      const history = [];
      for (let id = 1; id <= 5; id += 1) history.push(msg(id, long));
      for (let id = 6; id <= 30; id += 1) history.push(msg(id, `짧은 ${id}`));
      state().setChatHistory(history);
      sync.onHistory(history);
      await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS);
      // 후보 순서는 오래된 것부터: 500자 4개 = 2000자에서 끊긴다.
      expect(calledIds(translateBatch, 0)).toEqual([1, 2, 3, 4]);
      const chars = translateBatch.mock.calls[0][1].reduce((n, i) => n + i.text.length, 0);
      expect(chars).toBeLessThanOrEqual(BATCH_MAX_CHARS);
      await vi.advanceTimersByTimeAsync(BATCH_MIN_INTERVAL_MS);
      // 5번(500자) + 짧은 것 19개 = 20개 상한.
      expect(calledIds(translateBatch, 1)).toHaveLength(BATCH_MAX_ITEMS);
      expect(calledIds(translateBatch, 1)[0]).toBe(5);
    });

    it('요청은 동시에 하나만 나가고 요청 시작 간격은 최소 1초다', async () => {
      let resolveFirst;
      const translateBatch = vi.fn(
        (lang, items) =>
          new Promise((res) => {
            resolveFirst = () => res(okBatch(lang, items));
          }),
      );
      const { sync } = makeSync({ translateBatch });
      sync.onConnect('en', true);
      const history = [];
      for (let id = 1; id <= 25; id += 1) history.push(msg(id, `문장 ${id}`));
      state().setChatHistory(history);
      sync.onHistory(history);
      await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      expect(state().chatTranslationPending[25]).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(translateBatch).toHaveBeenCalledTimes(1); // 첫 요청이 끝나기 전엔 두 번째 없음

      // 첫 요청이 10초 걸렸으므로 시작 간격 1초는 이미 지났다 — 응답 즉시 다음 요청.
      resolveFirst();
      await vi.advanceTimersByTimeAsync(0);
      expect(translateBatch).toHaveBeenCalledTimes(2);
      expect(calledIds(translateBatch, 1)).toEqual([21, 22, 23, 24, 25]);
    });

    it('빠르게 끝난 요청 뒤에는 시작 간격 1초를 채운 뒤 다음 요청을 보낸다', async () => {
      const { sync, translateBatch } = makeSync();
      sync.onConnect('en', true);
      const history = [];
      for (let id = 1; id <= 25; id += 1) history.push(msg(id, `문장 ${id}`));
      state().setChatHistory(history);
      sync.onHistory(history);
      await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(BATCH_MIN_INTERVAL_MS - 1);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(translateBatch).toHaveBeenCalledTimes(2);
    });
  });

  // 규칙 6 — 응답 처리와 재시도
  describe('규칙 6: 응답 처리', () => {
    it('translated는 병합, skipped는 조용히 완료, failed는 10초·30초 뒤 2회 재시도 후 실패 표시', async () => {
      const translateBatch = vi.fn(async () => ({
        translated: { 1: 'one' },
        skipped: [2],
        failed: [3],
      }));
      const { sync } = makeSync({ translateBatch });
      sync.onConnect('en', true);
      const history = [msg(1, '하나'), msg(2, '둘'), msg(3, '셋')];
      state().setChatHistory(history);
      sync.onHistory(history);
      await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      expect(state().chatTranslations[1]).toEqual({ en: 'one' });
      expect(state().chatTranslationPending[1]).toBeUndefined();
      expect(state().chatTranslationPending[2]).toBeUndefined();
      expect(state().chatTranslationPending[3]).toBe(true);

      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] - 1);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(translateBatch).toHaveBeenCalledTimes(2);
      expect(calledIds(translateBatch, 1)).toEqual([3]);

      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1]);
      expect(translateBatch).toHaveBeenCalledTimes(3);
      expect(calledIds(translateBatch, 2)).toEqual([3]);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(translateBatch).toHaveBeenCalledTimes(3);
      expect(state().chatTranslationFailed[3]).toBe(true);
      expect(state().chatTranslationPending[3]).toBeUndefined();
    });

    it('429는 retryAfterMs 뒤에 같은 항목을 다시 요청한다', async () => {
      const throttled = Object.assign(new Error('rate limited'), {
        status: 429,
        retryAfterMs: 12_000,
      });
      const translateBatch = vi
        .fn()
        .mockRejectedValueOnce(throttled)
        .mockImplementation(async (lang, items) => okBatch(lang, items));
      const { sync } = makeSync({ translateBatch });
      sync.onConnect('en', true);
      state().setChatHistory([msg(1, '하나')]);
      sync.onHistory([msg(1, '하나')]);
      await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(11_999);
      expect(translateBatch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(translateBatch).toHaveBeenCalledTimes(2);
      expect(state().chatTranslations[1]).toEqual({ en: 'en:하나' });
    });

    it('네트워크 예외는 failed와 같은 재시도 규칙을 탄다', async () => {
      const translateBatch = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockImplementation(async (lang, items) => okBatch(lang, items));
      const { sync } = makeSync({ translateBatch });
      sync.onConnect('en', true);
      state().setChatHistory([msg(1, '하나')]);
      sync.onHistory([msg(1, '하나')]);
      await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS);
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
      expect(translateBatch).toHaveBeenCalledTimes(2);
      expect(state().chatTranslations[1]).toEqual({ en: 'en:하나' });
    });
  });

  // 규칙 7 — 수동 재시도
  it('규칙 7: retry(id)는 실패 표시를 지우고 즉시 후보에 넣는다', async () => {
    const { sync, translateBatch } = makeSync();
    sync.onConnect('en', true);
    state().setChatHistory([msg(1, '하나')]);
    useStore.setState({ chatTranslationFailed: { 1: true } });
    sync.retry(1);
    expect(state().chatTranslationFailed[1]).toBeUndefined();
    expect(state().chatTranslationPending[1]).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(calledIds(translateBatch, 0)).toEqual([1]);
  });

  // 규칙 8 — dispose
  it('규칙 8: dispose는 타이머와 진행 중 요청을 취소한다', async () => {
    let seenSignal;
    const translateBatch = vi.fn(
      (lang, items, { signal }) =>
        new Promise((res, rej) => {
          seenSignal = signal;
          signal.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    );
    const { sync } = makeSync({ translateBatch });
    sync.onConnect('en', true);
    const history = [];
    for (let id = 1; id <= 25; id += 1) history.push(msg(id, `문장 ${id}`));
    state().setChatHistory(history);
    sync.onHistory(history);
    sync.onMessage(msg(26, '실시간'));
    await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS);
    expect(translateBatch).toHaveBeenCalledTimes(1);

    sync.dispose();
    expect(seenSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(state().chatTranslationPending).toEqual({});
  });

  // 규칙 9 — 스토어에 없는 id
  it('규칙 9: 스토어에 없는 id는 후보에서 제외한다', async () => {
    const { sync, translateBatch } = makeSync();
    sync.onConnect('en', true);
    state().setChatHistory([msg(1, '하나')]);
    sync.onScrolledToOlder([999, 1]);
    sync.onMessage(msg(1000, '없는 메시지'));
    await vi.advanceTimersByTimeAsync(PUSH_WAIT_MS + BATCH_MIN_INTERVAL_MS);
    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(calledIds(translateBatch, 0)).toEqual([1]);
    expect(state().chatTranslationPending[999]).toBeUndefined();
    expect(state().chatTranslationPending[1000]).toBeUndefined();
  });

  it('배치 직전에 상한으로 밀려난 id는 요청에서 빠진다', async () => {
    const { sync, translateBatch } = makeSync();
    sync.onConnect('en', true);
    state().setChatHistory([msg(1, '하나'), msg(2, '둘')]);
    sync.onHistory([msg(1, '하나'), msg(2, '둘')]);
    // 배치가 나가기 전에 스토어에서 1번이 사라진다.
    useStore.setState({ chatMessages: state().chatMessages.filter((m) => m.id !== 1) });
    await vi.advanceTimersByTimeAsync(HISTORY_FIRST_BATCH_DELAY_MS);
    expect(calledIds(translateBatch, 0)).toEqual([2]);
  });
});
