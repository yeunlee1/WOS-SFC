import { create } from 'zustand';

export const ALLIANCES = ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'];

export const useStore = create((set) => ({
  // 인증 (토큰은 httpOnly 쿠키로 관리 — JS에서 접근 불가)
  user: null,
  timeOffset: 0,

  // 실시간 데이터
  notices: [],
  rallies: [],
  members: [],
  onlineUsers: [],
  boards: Object.fromEntries(ALLIANCES.map((a) => [a, []])),
  allianceNotices: { KOR: [], NSL: [], JKY: [], GPX: [], UFO: [] },
  countdown: { active: false, startedAt: 0, totalSeconds: 0 },

  // Actions
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
  setTimeOffset: (timeOffset) => set({ timeOffset }),
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
}));
