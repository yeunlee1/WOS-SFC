import { create } from 'zustand';

export const ALLIANCES = ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'];

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
    byKey.set(key, previous ? { ...message, ...previous } : message);
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
// frost가 메인, spring은 후속 리뉴얼 예정 (Phase 8). anthropic/dark 테마는 폐기됨.
// 기존 사용자 localStorage에 'anthropic'/'dark' 저장돼있으면 frost로 마이그레이션.
export const THEMES = ['frost', 'spring'];
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
  clearUser: () => set({ user: null, chatMessages: [], onlineUsers: [] }),
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
    set((state) => ({
      chatMessages: mergeChatMessages(
        state.chatMessages,
        Array.isArray(messages) ? messages : [],
      ),
    })),
  appendChatMessage: (message) =>
    set((state) => ({
      chatMessages: mergeChatMessages(state.chatMessages, [message]),
    })),
  setChatMessageTranslation: (
    messageKey,
    translatedContent,
    translatedLanguage,
  ) =>
    set((state) => ({
      chatMessages: state.chatMessages.map((message) =>
        getChatMessageKey(message) === messageKey
          ? { ...message, translatedContent, translatedLanguage }
          : message,
      ),
    })),
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
