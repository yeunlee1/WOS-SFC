import { create } from 'zustand';

export const ALLIANCES = ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'];

export const useStore = create((set) => ({
  // 인증
  user: null,  // { id, nickname, role, allianceName, language }
  token: localStorage.getItem('wos-token'),
  timeOffset: 0,

  // 실시간 데이터
  notices: [],
  rallies: [],
  members: [],
  onlineUsers: [],
  boards: Object.fromEntries(ALLIANCES.map((a) => [a, []])),
  countdown: { active: false, startedAt: 0, totalSeconds: 0 },

  // Actions
  setUser: (user, token) => {
    localStorage.setItem('wos-token', token);
    set({ user, token });
  },
  clearUser: () => {
    localStorage.removeItem('wos-token');
    set({ user: null, token: null });
  },
  setTimeOffset: (timeOffset) => set({ timeOffset }),
  setNotices:    (notices)    => set({ notices }),
  setRallies:    (rallies)    => set({ rallies }),
  setMembers:    (members)    => set({ members }),
  setOnlineUsers:(onlineUsers)=> set({ onlineUsers }),
  setBoardPosts: (alliance, posts) =>
    set((s) => ({ boards: { ...s.boards, [alliance]: posts } })),
  setCountdown:  (countdown)  => set({ countdown }),
}));
