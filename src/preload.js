// preload.js — 보안 브릿지 (메인 ↔ 렌더러)

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── 번역 ──
  translateTo: (text, lang) => ipcRenderer.invoke('translate-to', text, lang),

  // ── Firebase: 동맹 접속 ──
  connectAlliance: (code) => ipcRenderer.invoke('connect-alliance', code),

  // ── 공지 ──
  addNotice:    (data) => ipcRenderer.invoke('fb-add-notice', data),
  deleteNotice: (id)   => ipcRenderer.invoke('fb-delete-notice', id),

  // ── 집결 타이머 ──
  addRally:    (data) => ipcRenderer.invoke('fb-add-rally', data),
  deleteRally: (id)   => ipcRenderer.invoke('fb-delete-rally', id),

  // ── 집결원 ──
  addMember:    (data) => ipcRenderer.invoke('fb-add-member', data),
  deleteMember: (id)   => ipcRenderer.invoke('fb-delete-member', id),

  // ── 번역 캐시 ──
  getTranslation: (key)        => ipcRenderer.invoke('fb-get-translation', key),
  setTranslation: (key, value) => ipcRenderer.invoke('fb-set-translation', key, value),

  // ── 온라인 상태 ──
  setOnline:    (userData) => ipcRenderer.invoke('fb-set-online', userData),
  removeOnline: (nickname) => ipcRenderer.invoke('fb-remove-online', nickname),
  getUserRole:  (nickname, devPassword) => ipcRenderer.invoke('fb-get-user-role', nickname, devPassword),
  setUserRole:  (nickname, role) => ipcRenderer.invoke('fb-set-user-role', nickname, role),

  // ── 연맹 게시판 ──
  addBoardPost:    (alliance, data) => ipcRenderer.invoke('fb-add-board-post', alliance, data),
  deleteBoardPost: (alliance, id)   => ipcRenderer.invoke('fb-delete-board-post', alliance, id),

  // ── 실시간 이벤트 수신 (main → renderer push) ──
  onNoticesUpdated: (cb) => ipcRenderer.on('notices-updated', (_, data) => cb(data)),
  onRalliesUpdated: (cb) => ipcRenderer.on('rallies-updated', (_, data) => cb(data)),
  onMembersUpdated: (cb) => ipcRenderer.on('members-updated', (_, data) => cb(data)),
  onOnlineUpdated:  (cb) => ipcRenderer.on('online-updated',  (_, data) => cb(data)),
  onBoardUpdated:   (alliance, cb) => ipcRenderer.on(`board-updated-${alliance}`, (_, data) => cb(data)),
});
