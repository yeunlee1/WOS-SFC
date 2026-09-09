// online:updated 목록의 차이로 입퇴장 시스템 메시지를 만들고 2초 창으로 합치는 순수 함수 모음. 서버는 입퇴장을 방송하지 않는다 (C-5).

export const ONLINE_COALESCE_MS = 2_000;

let systemSequence = 0;

function nicknameOf(entry) {
  if (typeof entry === 'string') return entry;
  return entry && typeof entry.nickname === 'string' ? entry.nickname : null;
}

function nicknameSet(list) {
  const out = new Set();
  for (const entry of Array.isArray(list) ? list : []) {
    const nick = nicknameOf(entry);
    if (nick) out.add(nick);
  }
  return out;
}

// 닉네임 기준 diff — 같은 사람의 다중 탭은 한 명으로 센다.
export function diffOnline(prev, next) {
  const before = nicknameSet(prev);
  const after = nicknameSet(next);
  return {
    joined: Array.from(after).filter((nick) => !before.has(nick)),
    left: Array.from(before).filter((nick) => !after.has(nick)),
  };
}

// 첫 목록은 내 접속 기준선이라 메시지를 만들지 않는다. 그 뒤 변화는 windowMs 안에 모아 onFlush 한 번.
export function createOnlineTracker({
  windowMs = ONLINE_COALESCE_MS,
  onFlush,
  setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: cancel = (timer) => globalThis.clearTimeout(timer),
}) {
  let known = null;
  const joined = new Set();
  const left = new Set();
  let timer = null;

  function flush() {
    timer = null;
    const j = Array.from(joined);
    const l = Array.from(left);
    joined.clear();
    left.clear();
    if (j.length > 0 || l.length > 0) onFlush({ joined: j, left: l });
  }

  function update(list) {
    const names = nicknameSet(list);
    if (known === null) {
      known = names;
      return;
    }
    const diff = diffOnline(Array.from(known), Array.from(names));
    known = names;
    // 창 안에서 들어왔다 나간 사람(또는 그 반대)은 상쇄한다.
    for (const nick of diff.joined) {
      if (left.has(nick)) left.delete(nick);
      else joined.add(nick);
    }
    for (const nick of diff.left) {
      if (joined.has(nick)) joined.delete(nick);
      else left.add(nick);
    }
    if ((joined.size > 0 || left.size > 0) && !timer) {
      timer = schedule(flush, windowMs);
    }
  }

  function dispose() {
    if (timer) cancel(timer);
    timer = null;
    joined.clear();
    left.clear();
    known = null;
  }

  return { update, flush, dispose };
}

// 스토어에 넣는 시스템 메시지 객체. 문구는 렌더 시점에 formatSystemMessage가 현재 UI 언어로 만든다.
export function createSystemMessage(fields) {
  systemSequence += 1;
  return {
    _type: 'system',
    _id: `${Date.now()}-${systemSequence}`,
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

const KIND_KEYS = {
  joined: 'chatJoined',
  left: 'chatLeft',
  joinedMany: 'chatJoinedMany',
  leftMany: 'chatLeftMany',
  history_error: 'chatHistoryError',
};

// kind → i18n 키 → {nickname}·{count} 치환. 옛 서버의 문자열(text)은 그대로.
export function formatSystemMessage(message, t) {
  if (!message) return '';
  if (typeof message.text === 'string' && (message.kind === 'text' || !message.kind)) {
    return message.text;
  }
  const key = KIND_KEYS[message.kind];
  if (!key) return String(message.kind ?? message.text ?? '');
  const template = String(t(key) ?? key);
  return template
    .replace('{nickname}', message.nickname ?? '')
    .replace('{count}', String(message.count ?? ''));
}
