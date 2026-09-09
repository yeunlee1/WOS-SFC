// 채팅 번역 동기화 상태 기계 — 서버 푸시(chat:translation)를 반영하고 빠진 번역만 배치로 요청한다. React·소켓에 의존하지 않는다.
import { detectScript, effectiveLang, unambiguousLang } from './script';

// 실시간 메시지 원문을 받은 뒤 내 언어 푸시를 기다리는 시간. 넘기면 배치 폴백.
export const PUSH_WAIT_MS = 15_000;
// 히스토리 수신 뒤 첫 배치까지의 여유 — 재연결 직후 푸시·히스토리가 겹치는 창을 흡수한다.
export const HISTORY_FIRST_BATCH_DELAY_MS = 1_000;
// 접속 즉시 요청하는 히스토리 상한. 그보다 오래된 것은 스크롤로 화면에 들어올 때 요청한다 (C 5절 D).
export const HISTORY_FIRST_BATCH_COUNT = 50;
export const BATCH_MAX_ITEMS = 20;
export const BATCH_MAX_CHARS = 2_000;
export const BATCH_MIN_INTERVAL_MS = 1_000;
// failed 항목 재시도 간격. 두 번 다 실패하면 markTranslationFailed → 수동 재시도.
export const RETRY_DELAYS_MS = [10_000, 30_000];

export function createTranslationSync({
  store,
  translateBatch,
  emitLanguage,
  now = () => Date.now(),
  setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: cancel = (timer) => globalThis.clearTimeout(timer),
}) {
  let myLang = null;
  let autoTranslate = false;
  let connected = false;
  let disposed = false;

  // 실시간 메시지의 푸시 대기 타이머 — id 문자열 → timer
  const pushWait = new Map();
  // 재시도(또는 서버 failed 뒤 폴백) 대기 타이머 — id 문자열 → timer
  const retryTimers = new Map();
  // 실패 횟수 — id 문자열 → n
  const attempts = new Map();
  // 배치 후보 (오래된 것부터). 중복은 candidateSet으로 막는다.
  let candidates = [];
  const candidateSet = new Set();
  let inFlight = null; // { ids, controller }
  let batchTimer = null;
  let batchTimerAt = 0;
  let lastRequestAt = -Infinity;

  const S = () => store.getState();
  const key = (id) => String(id);

  function messageById(id) {
    const k = key(id);
    return S().chatMessages.find(
      (m) =>
        m &&
        m._type !== 'system' &&
        m.id !== undefined &&
        m.id !== null &&
        key(m.id) === k,
    );
  }

  function hasMine(id) {
    const entry = S().chatTranslations[id];
    return !!entry && typeof entry[myLang] === 'string';
  }

  // 배치 후보가 될 수 있는가 — 스토어에 있고, 글자가 있고, 내 언어가 확실하지 않고, 아직 내 언어 번역이 없다.
  function eligible(message) {
    if (!message || message._type === 'system') return false;
    if (message.id === undefined || message.id === null) return false;
    const text = String(message.content ?? '');
    if (detectScript(text) === 'none') return false;
    if (unambiguousLang(text) === myLang) return false;
    return !hasMine(message.id);
  }

  function clearWait(id) {
    const k = key(id);
    if (pushWait.has(k)) {
      cancel(pushWait.get(k));
      pushWait.delete(k);
    }
  }

  function clearRetry(id) {
    const k = key(id);
    if (retryTimers.has(k)) {
      cancel(retryTimers.get(k));
      retryTimers.delete(k);
    }
  }

  function removeCandidate(id) {
    const k = key(id);
    if (!candidateSet.has(k)) return;
    candidateSet.delete(k);
    candidates = candidates.filter((c) => key(c) !== k);
  }

  function scheduleBatch(delayMs = 0) {
    if (disposed || inFlight || candidates.length === 0) return;
    const at = Math.max(now() + delayMs, lastRequestAt + BATCH_MIN_INTERVAL_MS);
    if (batchTimer) {
      if (at >= batchTimerAt) return;
      cancel(batchTimer);
      batchTimer = null;
    }
    if (at <= now()) {
      // 이미 때가 됐으면 타이머를 거치지 않고 바로 보낸다.
      runBatch();
      return;
    }
    batchTimerAt = at;
    batchTimer = schedule(() => {
      batchTimer = null;
      runBatch();
    }, at - now());
  }

  function enqueue(ids, delayMs) {
    if (disposed || !autoTranslate || !myLang) return;
    const fresh = [];
    for (const id of ids) {
      const k = key(id);
      if (candidateSet.has(k)) continue;
      if (inFlight && inFlight.ids.some((x) => key(x) === k)) continue;
      const message = messageById(id);
      if (!eligible(message)) continue;
      clearWait(k);
      candidateSet.add(k);
      candidates.push(message.id);
      fresh.push(message.id);
    }
    if (fresh.length === 0) return;
    S().markTranslationPending(fresh);
    scheduleBatch(delayMs);
  }

  // 후보 머리에서 항목 ≤20 그리고 원문 합 ≤2000자만큼 꺼낸다. 자격을 잃은 후보는 버린다.
  function takeBatch() {
    const items = [];
    let chars = 0;
    while (candidates.length > 0) {
      const id = candidates[0];
      const message = messageById(id);
      if (!eligible(message)) {
        candidates.shift();
        candidateSet.delete(key(id));
        S().clearTranslationPending([id]);
        continue;
      }
      const text = String(message.content);
      if (
        items.length > 0 &&
        (items.length >= BATCH_MAX_ITEMS || chars + text.length > BATCH_MAX_CHARS)
      ) {
        break;
      }
      candidates.shift();
      candidateSet.delete(key(id));
      items.push({ id: message.id, text });
      chars += text.length;
    }
    return items;
  }

  function runBatch() {
    if (disposed || inFlight || !autoTranslate || !myLang) return;
    const items = takeBatch();
    if (items.length === 0) return;
    const lang = myLang;
    const controller = new AbortController();
    const request = { ids: items.map((item) => item.id), controller };
    inFlight = request;
    lastRequestAt = now();

    Promise.resolve()
      .then(() => translateBatch(lang, items, { signal: controller.signal }))
      .then(
        (response) => {
          if (inFlight !== request) return;
          settle(items, response, lang);
        },
        (error) => {
          if (inFlight !== request || controller.signal.aborted) return;
          fail(items, error);
        },
      )
      .finally(() => {
        if (inFlight !== request) return;
        inFlight = null;
        scheduleBatch(0);
      });
  }

  function settle(items, response, lang) {
    const translated = response?.translated || {};
    const failed = new Set((response?.failed || []).map(key));
    const entries = [];
    const done = [];
    const failedIds = [];
    for (const { id } of items) {
      const k = key(id);
      if (typeof translated[k] === 'string') {
        entries.push([id, { [lang]: translated[k] }]);
        done.push(id);
      } else if (failed.has(k)) {
        failedIds.push(id);
      } else {
        // skipped(이미 그 언어) 또는 응답 누락 — 조용히 완료.
        done.push(id);
      }
    }
    if (entries.length > 0) S().mergeChatTranslationsBulk(entries);
    if (done.length > 0) {
      S().clearTranslationPending(done);
      for (const id of done) attempts.delete(key(id));
    }
    scheduleRetries(failedIds);
  }

  function fail(items, error) {
    const ids = items.map((item) => item.id);
    if (error?.status === 429) {
      const wait = Number.isFinite(error.retryAfterMs)
        ? error.retryAfterMs
        : RETRY_DELAYS_MS[0];
      scheduleRetries(ids, wait);
      return;
    }
    scheduleRetries(ids);
  }

  // 실패 횟수에 따라 10초·30초 뒤 재요청, 그 뒤엔 실패 표시. 429는 서버가 준 시간을 대신 쓴다.
  function scheduleRetries(ids, delayOverride) {
    for (const id of ids) {
      const k = key(id);
      const n = attempts.get(k) || 0;
      if (n >= RETRY_DELAYS_MS.length) {
        attempts.delete(k);
        S().markTranslationFailed([id]);
        continue;
      }
      attempts.set(k, n + 1);
      scheduleReenqueue(id, delayOverride ?? RETRY_DELAYS_MS[n]);
    }
  }

  function scheduleReenqueue(id, delayMs) {
    const k = key(id);
    clearRetry(k);
    retryTimers.set(
      k,
      schedule(() => {
        retryTimers.delete(k);
        enqueue([id], 0);
      }, delayMs),
    );
  }

  // 스토어의 최신 50건 중 내 언어 번역이 없는 것만 후보에 넣는다. 나머지는 스크롤 때.
  function scanStore(delayMs) {
    if (!autoTranslate || !myLang) return;
    const recent = S()
      .chatMessages.filter(eligible)
      .slice(-HISTORY_FIRST_BATCH_COUNT)
      .map((m) => m.id);
    enqueue(recent, delayMs);
  }

  function resetWork() {
    for (const timer of pushWait.values()) cancel(timer);
    pushWait.clear();
    for (const timer of retryTimers.values()) cancel(timer);
    retryTimers.clear();
    attempts.clear();
    if (batchTimer) {
      cancel(batchTimer);
      batchTimer = null;
    }
    if (inFlight) {
      inFlight.controller.abort();
      inFlight = null;
    }
    candidates = [];
    candidateSet.clear();
  }

  function report() {
    emitLanguage(autoTranslate ? myLang : null);
  }

  // ── 공개 API ──

  // 접속(재접속 포함). 소켓별 대상 언어를 서버가 새로 잡으므로 매번 보고한다.
  function onConnect(lang, on) {
    if (disposed) return;
    myLang = effectiveLang(lang);
    autoTranslate = !!on;
    connected = true;
    resetWork();
    S().clearTranslationPending(null);
    report();
    scanStore(HISTORY_FIRST_BATCH_DELAY_MS);
  }

  function onHistory() {
    if (disposed) return;
    // 히스토리에 내 언어 번역이 실려 왔으면 그 푸시 대기는 끝난 것이다.
    for (const k of Array.from(pushWait.keys())) {
      if (hasMine(k)) {
        clearWait(k);
        S().clearTranslationPending([k]);
      }
    }
    scanStore(HISTORY_FIRST_BATCH_DELAY_MS);
  }

  function onMessage(message) {
    if (disposed || !autoTranslate || !myLang) return;
    if (message?.id === undefined || message?.id === null) return;
    // 스토어에 들어간 메시지만 대상 (C-3). 상한으로 밀린 것은 여기서 걸러진다.
    if (!eligible(messageById(message.id))) return;
    const k = key(message.id);
    clearWait(k);
    S().markTranslationPending([message.id]);
    pushWait.set(
      k,
      schedule(() => {
        pushWait.delete(k);
        enqueue([message.id], 0);
      }, PUSH_WAIT_MS),
    );
  }

  function onPushed(payload) {
    if (disposed || !payload || payload.id === undefined || payload.id === null)
      return;
    const id = payload.id;
    const translations =
      payload.translations && typeof payload.translations === 'object'
        ? payload.translations
        : {};
    const langs = Object.keys(translations);
    if (langs.length > 0) S().mergeChatTranslations(id, translations);
    if (!myLang) return;

    if (typeof translations[myLang] === 'string') {
      clearWait(id);
      clearRetry(id);
      removeCandidate(id);
      attempts.delete(key(id));
      S().clearTranslationPending([id]);
      return;
    }
    const failed = Array.isArray(payload.failed) ? payload.failed : [];
    if (failed.includes(myLang)) {
      clearWait(id);
      if (autoTranslate) scheduleReenqueue(id, PUSH_WAIT_MS);
      return;
    }
    if (langs.length === 0 && failed.length === 0) {
      // 대상 언어 0 — 서버가 번역할 것이 없다고 알린 것. 폴백을 걸지 않는다 (C 5절 O).
      clearWait(id);
      S().clearTranslationPending([id]);
    }
  }

  function onLanguageChange(lang) {
    if (disposed) return;
    const next = effectiveLang(lang);
    if (next === myLang) return;
    myLang = next;
    resetWork();
    S().resetTranslationStatus();
    if (connected) report();
    scanStore(HISTORY_FIRST_BATCH_DELAY_MS);
  }

  function onAutoTranslateChange(on) {
    if (disposed) return;
    const next = !!on;
    if (next === autoTranslate) return;
    autoTranslate = next;
    resetWork();
    S().resetTranslationStatus();
    if (connected) report();
    scanStore(HISTORY_FIRST_BATCH_DELAY_MS);
  }

  function onScrolledToOlder(ids) {
    if (disposed || !Array.isArray(ids)) return;
    enqueue(ids, 0);
  }

  function retry(id) {
    if (disposed) return;
    S().clearTranslationFailed(id);
    attempts.delete(key(id));
    clearRetry(id);
    enqueue([id], 0);
  }

  function dispose() {
    disposed = true;
    connected = false;
    resetWork();
    S().clearTranslationPending(null);
  }

  function _debug() {
    return {
      myLang,
      autoTranslate,
      connected,
      disposed,
      candidates: candidates.slice(),
      inFlight: inFlight ? inFlight.ids.slice() : null,
      waiting: Array.from(pushWait.keys()),
      retrying: Array.from(retryTimers.keys()),
    };
  }

  return {
    onConnect,
    onHistory,
    onMessage,
    onPushed,
    onLanguageChange,
    onAutoTranslateChange,
    onScrolledToOlder,
    retry,
    dispose,
    _debug,
  };
}
