import { create } from 'zustand';

export const ALLIANCES = ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'];

// 5-연맹 색표 — 채팅·온라인 패널·게시판이 공유하는 한 벌 (B-18).
// UFO는 채팅·온라인 패널이 쓰던 #ec4899로 통일했다 (Board의 #06b6d4는 버림).
export const ALLIANCE_COLORS = {
  KOR: '#3b82f6',
  NSL: '#22c55e',
  JKY: '#a855f7',
  GPX: '#f97316',
  UFO: '#ec4899',
};
export const ALLIANCE_COLOR_FALLBACK = '#64748b';

export function getAllianceColor(alliance) {
  return ALLIANCE_COLORS[alliance] || ALLIANCE_COLOR_FALLBACK;
}

// ttsVolume 초기값: localStorage 우선, 없으면 0.3 (30%), 0~1 범위 clamp
function _initTtsVolume() {
  try {
    const raw = localStorage.getItem('wos-tts-volume');
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return 0.3;
    return Math.max(0, Math.min(1, v));
  } catch {
    // localStorage 접근 불가 (프라이버시 모드, iframe sandbox 등)
    return 0.3;
  }
}

// ttsMuted 초기값: localStorage 우선, 없으면 false
function _initTtsMuted() {
  try {
    return localStorage.getItem('wos-tts-muted') === '1';
  } catch {
    return false;
  }
}

// 채팅 자동번역 초기값: localStorage 우선, 없으면 true
function _initChatAutoTranslate() {
  try {
    return localStorage.getItem('wos-chat-auto-translate') !== '0';
  } catch {
    return true;
  }
}

export function getChatMessageKey(message) {
  if (message?.id !== undefined && message?.id !== null)
    return `message:${message.id}`;
  if (message?._id !== undefined && message?._id !== null)
    return `system:${message._id}`;
  return [
    message?._type || 'message',
    message?.createdAt || '',
    message?.nickname || '',
    message?.content || message?.text || '',
  ].join(':');
}

// 실제 대화와 입퇴장 시스템 메시지의 상한을 분리한다.
// 하나의 500칸 버퍼를 공유하면 100명이 입퇴장하는 순간 시스템 메시지가
// 실제 대화를 통째로 밀어내 버린다.
const CHAT_MESSAGE_LIMIT = 500;
const CHAT_SYSTEM_LIMIT = 50;

function mergeChatMessages(current, incoming) {
  const byKey = new Map(
    current.map((message) => [getChatMessageKey(message), message]),
  );
  for (const message of incoming) {
    const key = getChatMessageKey(message);
    const previous = byKey.get(key);
    // 같은 키면 서버가 새로 보낸(incoming) 필드가 이긴다 (B-4).
    byKey.set(key, previous ? { ...previous, ...message } : message);
  }
  const ordered = Array.from(byKey.values()).sort((a, b) => {
    const aTime = Date.parse(a.createdAt || '') || 0;
    const bTime = Date.parse(b.createdAt || '') || 0;
    return aTime - bTime;
  });

  const kept = new Set([
    ...ordered
      .filter((message) => message?._type !== 'system')
      .slice(-CHAT_MESSAGE_LIMIT)
      .map(getChatMessageKey),
    ...ordered
      .filter((message) => message?._type === 'system')
      .slice(-CHAT_SYSTEM_LIMIT)
      .map(getChatMessageKey),
  ]);
  // 시간순 정렬을 유지한 채 살아남은 항목만 남긴다.
  return ordered.filter((message) => kept.has(getChatMessageKey(message)));
}

// 서버가 메시지에 실어 보낸 translations를 떼어 [id, map] 목록으로 돌려준다.
// 번역은 메시지 객체가 아니라 chatTranslations 맵에 둔다 (B-5, C 5절 B).
function splitTranslations(incoming) {
  const messages = [];
  const entries = [];
  for (const message of incoming) {
    if (message && typeof message === 'object' && 'translations' in message) {
      const { translations, ...rest } = message;
      messages.push(rest);
      if (rest.id !== undefined && rest.id !== null) {
        entries.push([rest.id, translations]);
      }
    } else {
      messages.push(message);
    }
  }
  return { messages, entries };
}

// 언어별로 합친다. 빈 맵은 항목을 만들지 않고 기존 언어를 지우지도 않는다.
function mergeTranslationMap(current, entries) {
  let next = current;
  for (const [id, map] of entries) {
    if (!map || typeof map !== 'object') continue;
    const langs = Object.keys(map).filter(
      (lang) => typeof map[lang] === 'string',
    );
    if (langs.length === 0) continue;
    if (next === current) next = { ...current };
    const merged = { ...(next[id] || {}) };
    for (const lang of langs) merged[lang] = map[lang];
    next[id] = merged;
  }
  return next;
}

// 스토어에 남아 있는 메시지 id만 남긴다 (C-3). 바뀐 것이 없으면 같은 참조를 돌려준다.
function pruneTranslationState(state, chatMessages) {
  const alive = new Set();
  for (const message of chatMessages) {
    if (message?.id !== undefined && message?.id !== null) {
      alive.add(String(message.id));
    }
  }
  const keepAlive = (record) => {
    let changed = false;
    const out = {};
    for (const key of Object.keys(record)) {
      if (alive.has(key)) out[key] = record[key];
      else changed = true;
    }
    return changed ? out : record;
  };
  return {
    chatTranslations: keepAlive(state.chatTranslations),
    chatTranslationPending: keepAlive(state.chatTranslationPending),
    chatTranslationFailed: keepAlive(state.chatTranslationFailed),
  };
}

function withoutKeys(record, ids) {
  let changed = false;
  const out = { ...record };
  for (const id of ids) {
    if (id in out) {
      delete out[id];
      changed = true;
    }
  }
  return changed ? out : record;
}

// personalOffsetMs 초기값: localStorage 우선, 없으면 0. 범위 -1000~+1000ms로 clamp.
// 사용자가 디바이스별 카운트다운 TTS 발화 시점을 미세 보정하는 값 (단계 4 UI).
function _initPersonalOffsetMs() {
  try {
    const v = parseFloat(localStorage.getItem('wos-personal-offset-ms'));
    if (!Number.isFinite(v)) return 0;
    return Math.max(-1000, Math.min(1000, Math.round(v)));
  } catch {
    return 0;
  }
}

// 테마 초기값: localStorage 우선, 없으면 'frost' (기본 — FROST PROTOCOL).
// frost(다크 얼음)가 메인, spring(다크 벚꽃)이 Phase 8, daylight(백야 라이트)가 Phase 9.
// anthropic/dark 테마는 폐기됨 — localStorage에 남아있으면 frost로 마이그레이션.
export const THEMES = ['frost', 'spring', 'daylight'];
function _initTheme() {
  try {
    const t = localStorage.getItem('wos-theme');
    return THEMES.includes(t) ? t : 'frost';
  } catch {
    return 'frost';
  }
}

export const useStore = create((set) => ({
  // 인증 (토큰은 httpOnly 쿠키로 관리 — JS에서 접근 불가)
  user: null,
  timeOffset: 0,
  timeSyncRtt: 0, // 진단용 — 마지막 동기화 RTT(ms)
  // 시계 동기화 진행 상태. timeOffset 초기값 0은 "오차 0"이 아니라 "아직 모름"이므로
  // 두 상태를 반드시 이 필드로 구분한다. UI는 'synced'가 아닐 때 성공 표시를 하면 안 된다.
  // 'unsynced' 시작 전/정리 후 · 'syncing' 시도 중 · 'failed' 실패(재시도 대기) · 'synced' 성공
  timeSyncState: 'unsynced',
  personalOffsetMs: _initPersonalOffsetMs(), // 사용자 디바이스별 미세 보정 (-1000~+1000ms)

  // 실시간 데이터
  notices: [],
  rallies: [],
  members: [],
  onlineUsers: [],
  chatMessages: [],
  // 번역 맵 { [id]: { [lang]: text } } — 도착 순서·재연결·히스토리 재수신에 무관하다.
  chatTranslations: {},
  // { [id]: true } — 동기화 모듈이 내 언어 번역을 기다리는 중(푸시 대기 또는 배치 요청).
  chatTranslationPending: {},
  // { [id]: true } — 재시도까지 끝나 수동 재시도만 남은 것.
  chatTranslationFailed: {},
  chatAutoTranslate: _initChatAutoTranslate(),
  boards: Object.fromEntries(ALLIANCES.map((a) => [a, []])),
  allianceNotices: { KOR: [], NSL: [], JKY: [], GPX: [], UFO: [] },
  countdown: { active: false, startedAt: 0, totalSeconds: 0 },

  // Rally Group Sync
  rallyGroups: [],
  rallyCountdowns: {}, // groupId → { startedAtServerMs, fireOffsets }

  // 개인 행군 시간 (PersonalPanel과 시각화 컴포넌트 공유)
  myMarchSeconds: null,

  // busy lock holder: { type: 'countdown' } | { type: 'rally', groupId: string } | null
  busyHolder: null,

  // TTS 볼륨 (0~1, 기본 0.3 = 30%)
  ttsVolume: _initTtsVolume(),
  // TTS 음소거 플래그 (볼륨과 독립 — 스피커 아이콘 토글용)
  ttsMuted: _initTtsMuted(),

  // 테마: 'frost' | 'spring' | 'anthropic' | 'dark' — body.theme-* 클래스로 적용
  theme: _initTheme(),

  // Actions
  setUser: (user) => set({ user }),
  clearUser: () =>
    set({
      user: null,
      chatMessages: [],
      chatTranslations: {},
      chatTranslationPending: {},
      chatTranslationFailed: {},
      onlineUsers: [],
    }),
  setTimeOffset: (timeOffset) => set({ timeOffset }),
  setTimeSyncRtt: (timeSyncRtt) => set({ timeSyncRtt }),
  setTimeSyncState: (timeSyncState) => set({ timeSyncState }),
  setPersonalOffsetMs: (ms) => {
    const n = Number(ms);
    const clamped = Number.isFinite(n)
      ? Math.max(-1000, Math.min(1000, Math.round(n)))
      : 0;
    try {
      localStorage.setItem('wos-personal-offset-ms', String(clamped));
    } catch {
      /* 무시 */
    }
    set({ personalOffsetMs: clamped });
  },
  setNotices: (notices) => set({ notices }),
  setRallies: (rallies) => set({ rallies }),
  setMembers: (members) => set({ members }),
  setOnlineUsers: (onlineUsers) => set({ onlineUsers }),
  setChatHistory: (messages) =>
    set((state) => {
      const split = splitTranslations(Array.isArray(messages) ? messages : []);
      const chatMessages = mergeChatMessages(state.chatMessages, split.messages);
      const chatTranslations = mergeTranslationMap(
        state.chatTranslations,
        split.entries,
      );
      return {
        chatMessages,
        ...pruneTranslationState({ ...state, chatTranslations }, chatMessages),
      };
    }),
  appendChatMessage: (message) =>
    set((state) => {
      const split = splitTranslations([message]);
      const chatMessages = mergeChatMessages(state.chatMessages, split.messages);
      const chatTranslations = mergeTranslationMap(
        state.chatTranslations,
        split.entries,
      );
      return {
        chatMessages,
        ...pruneTranslationState({ ...state, chatTranslations }, chatMessages),
      };
    }),
  // ── 번역 맵 액션 ──
  mergeChatTranslations: (id, map) =>
    set((state) => ({
      chatTranslations: mergeTranslationMap(state.chatTranslations, [[id, map]]),
    })),
  mergeChatTranslationsBulk: (entries) =>
    set((state) => ({
      chatTranslations: mergeTranslationMap(
        state.chatTranslations,
        Array.isArray(entries) ? entries : [],
      ),
    })),
  markTranslationPending: (ids) =>
    set((state) => ({
      chatTranslationPending: {
        ...state.chatTranslationPending,
        ...Object.fromEntries(ids.map((id) => [id, true])),
      },
    })),
  clearTranslationPending: (ids) =>
    set((state) => ({
      chatTranslationPending: ids
        ? withoutKeys(state.chatTranslationPending, ids)
        : {},
    })),
  markTranslationFailed: (ids) =>
    set((state) => ({
      chatTranslationFailed: {
        ...state.chatTranslationFailed,
        ...Object.fromEntries(ids.map((id) => [id, true])),
      },
      chatTranslationPending: withoutKeys(state.chatTranslationPending, ids),
    })),
  clearTranslationFailed: (id) =>
    set((state) => ({
      chatTranslationFailed: withoutKeys(state.chatTranslationFailed, [id]),
    })),
  resetTranslationStatus: () =>
    set({ chatTranslationPending: {}, chatTranslationFailed: {} }),
  pruneChatTranslations: () =>
    set((state) => pruneTranslationState(state, state.chatMessages)),
  setChatAutoTranslate: (enabled) => {
    const chatAutoTranslate = !!enabled;
    try {
      localStorage.setItem(
        'wos-chat-auto-translate',
        chatAutoTranslate ? '1' : '0',
      );
    } catch {
      /* 무시 */
    }
    set({ chatAutoTranslate });
  },
  setBoardPosts: (alliance, posts) =>
    set((s) => ({ boards: { ...s.boards, [alliance]: posts } })),
  setAllianceNotices: (alliance, notices) =>
    set((state) => ({
      allianceNotices: { ...state.allianceNotices, [alliance]: notices },
    })),
  setCountdown: (countdown) => set({ countdown }),

  setMyMarchSeconds: (v) => set({ myMarchSeconds: v }),
  setBusyHolder: (holder) => set({ busyHolder: holder }),

  setRallyGroups: (rallyGroups) => set({ rallyGroups }),
  upsertRallyGroup: (group) =>
    set((s) => {
      const idx = s.rallyGroups.findIndex((g) => g.id === group.id);
      if (idx < 0) return { rallyGroups: [...s.rallyGroups, group] };
      const next = s.rallyGroups.slice();
      next[idx] = group;
      return { rallyGroups: next };
    }),
  removeRallyGroup: (groupId) =>
    set((s) => {
      const nextCountdowns = { ...s.rallyCountdowns };
      delete nextCountdowns[groupId];
      return {
        rallyGroups: s.rallyGroups.filter((g) => g.id !== groupId),
        rallyCountdowns: nextCountdowns,
      };
    }),
  setRallyCountdown: (groupId, payload) =>
    set((s) => ({
      rallyCountdowns: { ...s.rallyCountdowns, [groupId]: payload },
    })),
  clearRallyCountdown: (groupId) =>
    set((s) => {
      const next = { ...s.rallyCountdowns };
      delete next[groupId];
      return { rallyCountdowns: next };
    }),
  setTtsVolume: (v) => {
    const n = Number(v);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.3;
    try {
      localStorage.setItem('wos-tts-volume', String(clamped));
    } catch {
      /* 무시 */
    }
    // 유저가 슬라이더로 볼륨 > 0 을 움직이면 음소거 자동 해제 (자연스러운 UX)
    set((s) => ({
      ttsVolume: clamped,
      ttsMuted: clamped > 0 ? false : s.ttsMuted,
    }));
    if (clamped > 0) {
      try {
        localStorage.setItem('wos-tts-muted', '0');
      } catch {
        /* 무시 */
      }
    }
  },
  setTtsMuted: (v) => {
    const muted = !!v;
    try {
      localStorage.setItem('wos-tts-muted', muted ? '1' : '0');
    } catch {
      /* 무시 */
    }
    set({ ttsMuted: muted });
  },
  setTheme: (t) => {
    const theme = THEMES.includes(t) ? t : 'frost';
    try {
      localStorage.setItem('wos-theme', theme);
    } catch {
      /* 무시 */
    }
    set({ theme });
  },
}));
