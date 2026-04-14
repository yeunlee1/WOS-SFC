// preload.js — 보안 브릿지 (메인 ↔ 렌더러)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── 번역 ──
  translateTo: (text, lang) => ipcRenderer.invoke('translate-to', text, lang),

  // ── 시간 동기화 (auth.js에서 로그인 후 호출) ──
  connectAlliance: () => ipcRenderer.invoke('connect-alliance'),

  // ── 공지 ──
  addNotice:    (data) => ipcRenderer.invoke('api-add-notice', data),
  deleteNotice: (id)   => ipcRenderer.invoke('api-delete-notice', id),

  // ── 집결 타이머 ──
  addRally:    (data) => ipcRenderer.invoke('api-add-rally', data),
  deleteRally: (id)   => ipcRenderer.invoke('api-delete-rally', id),

  // ── 집결원 ──
  addMember:    (data) => ipcRenderer.invoke('api-add-member', data),
  deleteMember: (id)   => ipcRenderer.invoke('api-delete-member', id),

  // ── 번역 캐시 ──
  getTranslation: (key)        => ipcRenderer.invoke('api-get-translation', key),
  setTranslation: (key, value) => ipcRenderer.invoke('api-set-translation', key, value),

  // ── 유저 역할 (온라인은 서버 자동 추적) ──
  getUserRole: (nickname) => ipcRenderer.invoke('api-get-user-role', nickname),
  setUserRole: (nickname, role) => ipcRenderer.invoke('api-set-user-role', nickname, role),

  // ── 연맹 게시판 ──
  addBoardPost:    (alliance, data) => ipcRenderer.invoke('api-add-board-post', alliance, data),
  deleteBoardPost: (id)             => ipcRenderer.invoke('api-delete-board-post', id),

  // ── 소켓 연결 ──
  socketConnect: () => ipcRenderer.invoke('socket-connect'),

  // ── 실시간 이벤트 수신 ──
  onNoticesUpdated: (cb) => ipcRenderer.on('notices-updated', (_, data) => cb(data)),
  onRalliesUpdated: (cb) => ipcRenderer.on('rallies-updated', (_, data) => cb(data)),
  onMembersUpdated: (cb) => ipcRenderer.on('members-updated', (_, data) => cb(data)),
  onOnlineUpdated:  (cb) => ipcRenderer.on('online-updated',  (_, data) => cb(data)),
  onBoardUpdated:   (alliance, cb) => ipcRenderer.on(`board-updated-${alliance}`, (_, data) => cb(data)),

  // ── Auth ──
  signup:  (data) => ipcRenderer.invoke('auth-signup', data),
  login:   (data) => ipcRenderer.invoke('auth-login', data),
  logout:  ()     => ipcRenderer.invoke('auth-logout'),

  // ── Chat ──
  chatConnect: ()        => ipcRenderer.invoke('socket-connect'), // 동일 소켓 재사용
  chatSend:    (content) => ipcRenderer.invoke('chat-send', content),
  onChatHistory: (cb) => ipcRenderer.on('chat-history', (_, data) => cb(data)),
  onChatMessage: (cb) => ipcRenderer.on('chat-message', (_, data) => cb(data)),
  onChatSystem:  (cb) => ipcRenderer.on('chat-system',  (_, text) => cb(text)),
  onChatOnline:  (cb) => ipcRenderer.on('chat-online',  (_, data) => cb(data)),
});
