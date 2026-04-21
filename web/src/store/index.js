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

export const useStore = create((set) => ({
  // 인증 (토큰은 httpOnly 쿠키로 관리 — JS에서 접근 불가)
  user: null,
  timeOffset: 0,
  timeSyncRtt: 0, // 진단용 — 마지막 동기화 RTT(ms)

  // 실시간 데이터
  notices: [],
  rallies: [],
  members: [],
  onlineUsers: [],
  boards: Object.fromEntries(ALLIANCES.map((a) => [a, []])),
  allianceNotices: { KOR: [], NSL: [], JKY: [], GPX: [], UFO: [] },
  countdown: { active: false, startedAt: 0, totalSeconds: 0 },

  // Rally Group Sync
  rallyGroups: [],
  rallyCountdowns: {}, // groupId → { startedAtServerMs, fireOffsets }

  // TTS 볼륨 (0~1, 기본 0.3 = 30%)
  ttsVolume: _initTtsVolume(),
  // TTS 음소거 플래그 (볼륨과 독립 — 스피커 아이콘 토글용)
  ttsMuted: _initTtsMuted(),

  // Actions
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
  setTimeOffset: (timeOffset) => set({ timeOffset }),
  setTimeSyncRtt: (timeSyncRtt) => set({ timeSyncRtt }),
  setNotices:    (notices)    => set({ notices }),
  setRallies:    (rallies)    => set({ rallies }),
  setMembers:    (members)    => set({ members }),
  setOnlineUsers:(onlineUsers)=> set({ onlineUsers }),
  setBoardPosts: (alliance, posts) =>
    set((s) => ({ boards: { ...s.boards, [alliance]: posts } })),
  setAllianceNotices: (alliance, notices) => set((state) => ({
    allianceNotices: { ...state.allianceNotices, [alliance]: notices },
  })),
  setCountdown:  (countdown)  => set({ countdown }),

  setRallyGroups: (rallyGroups) => set({ rallyGroups }),
  upsertRallyGroup: (group) => set((s) => {
    const idx = s.rallyGroups.findIndex((g) => g.id === group.id);
    if (idx < 0) return { rallyGroups: [...s.rallyGroups, group] };
    const next = s.rallyGroups.slice();
    next[idx] = group;
    return { rallyGroups: next };
  }),
  removeRallyGroup: (groupId) => set((s) => {
    const nextCountdowns = { ...s.rallyCountdowns };
    delete nextCountdowns[groupId];
    return {
      rallyGroups: s.rallyGroups.filter((g) => g.id !== groupId),
      rallyCountdowns: nextCountdowns,
    };
  }),
  setRallyCountdown: (groupId, payload) => set((s) => ({
    rallyCountdowns: { ...s.rallyCountdowns, [groupId]: payload },
  })),
  clearRallyCountdown: (groupId) => set((s) => {
    const next = { ...s.rallyCountdowns };
    delete next[groupId];
    return { rallyCountdowns: next };
  }),
  setTtsVolume: (v) => {
    const n = Number(v);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.3;
    try { localStorage.setItem('wos-tts-volume', String(clamped)); } catch { /* 무시 */ }
    // 유저가 슬라이더로 볼륨 > 0 을 움직이면 음소거 자동 해제 (자연스러운 UX)
    set((s) => ({
      ttsVolume: clamped,
      ttsMuted: clamped > 0 ? false : s.ttsMuted,
    }));
    if (clamped > 0) {
      try { localStorage.setItem('wos-tts-muted', '0'); } catch { /* 무시 */ }
    }
  },
  setTtsMuted: (v) => {
    const muted = !!v;
    try { localStorage.setItem('wos-tts-muted', muted ? '1' : '0'); } catch { /* 무시 */ }
    set({ ttsMuted: muted });
  },
}));
