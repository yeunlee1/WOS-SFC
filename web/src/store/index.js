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

  // TTS 볼륨 (0~1, 기본 0.3 = 30%)
  ttsVolume: _initTtsVolume(),

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
  setTtsVolume: (v) => {
    const n = Number(v);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.3;
    try { localStorage.setItem('wos-tts-volume', String(clamped)); } catch { /* 무시 */ }
    set({ ttsVolume: clamped });
  },
}));
