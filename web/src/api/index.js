import { io } from 'socket.io-client';
import { getCachedTranslation, cacheTranslation } from '../i18n';

// Vite 프록시 덕분에 dev/prod 동일하게 relative URL 사용
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('wos-token');
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // 인증
  login:   (data) => apiFetch('/auth/login',  { method: 'POST', body: JSON.stringify(data) }),
  signup:  (data) => apiFetch('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
  getTime: ()     => apiFetch('/time'),

  // 공지
  addNotice:    (data) => apiFetch('/notices',       { method: 'POST',   body: JSON.stringify(data) }),
  deleteNotice: (id)   => apiFetch(`/notices/${id}`, { method: 'DELETE' }),

  // 집결 타이머
  addRally:    (data) => apiFetch('/rallies',       { method: 'POST',   body: JSON.stringify(data) }),
  deleteRally: (id)   => apiFetch(`/rallies/${id}`, { method: 'DELETE' }),

  // 집결원
  addMember:    (data) => apiFetch('/members',       { method: 'POST',   body: JSON.stringify(data) }),
  deleteMember: (id)   => apiFetch(`/members/${id}`, { method: 'DELETE' }),

  // 게시판
  addBoardPost:    (alliance, data) => apiFetch('/boards',       { method: 'POST',   body: JSON.stringify({ ...data, alliance }) }),
  deleteBoardPost: (id)             => apiFetch(`/boards/${id}`, { method: 'DELETE' }),

  // 번역 캐시 (서버)
  getTranslation:  (key)                     => apiFetch(`/translations/${encodeURIComponent(key)}`).catch(() => null),
  setTranslation:  (cacheKey, translated)    => apiFetch('/translations', { method: 'POST', body: JSON.stringify({ cacheKey, translated }) }),

  // 번역 실행 (Claude API → 서버)
  translate: (text, targetLang) => apiFetch('/translate', { method: 'POST', body: JSON.stringify({ text, targetLang }) }),

  // 유저 역할
  setUserRole: (nickname, role) => apiFetch(`/users/${encodeURIComponent(nickname)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
};

// ── Socket 싱글톤 ──
let _socket = null;

export function getSocket() { return _socket; }

export function connectSocket(token) {
  if (_socket?.connected) return _socket;
  _socket = io({ auth: { token }, path: '/socket.io' });
  return _socket;
}

export function disconnectSocket() {
  _socket?.disconnect();
  _socket = null;
}

// ── 채팅 자동번역 ──
export async function translateChatMessage(msg, myLang) {
  if (!myLang || myLang === 'other' || !msg.language || msg.language === myLang) {
    return msg;
  }

  // 1. 로컬 캐시 확인
  const localCached = getCachedTranslation(msg.content, myLang);
  if (localCached) return { ...msg, translatedContent: localCached };

  try {
    // 2. 서버 캐시 확인
    const cacheKey = `chat:${msg.content.slice(0, 80)}:${msg.language}:${myLang}`;
    const serverCached = await api.getTranslation(cacheKey);
    if (serverCached?.translated) {
      cacheTranslation(msg.content, myLang, serverCached.translated);
      return { ...msg, translatedContent: serverCached.translated };
    }

    // 3. 번역 API 호출
    const res = await api.translate(msg.content, myLang);
    if (res?.translated) {
      cacheTranslation(msg.content, myLang, res.translated);
      api.setTranslation(cacheKey, res.translated).catch(() => {});
      return { ...msg, translatedContent: res.translated };
    }
  } catch { /* 실패 시 원문 반환 */ }

  return msg;
}

// ── 공통 유틸 ──
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// AudioContext 비프음 (집결 타이머 종료 시)
export function playBeep(frequency = 880, duration = 200) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration / 1000);
  } catch { /* AudioContext 미지원 시 무시 */ }
}
