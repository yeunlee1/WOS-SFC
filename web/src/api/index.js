import { io } from 'socket.io-client';
import { getCachedTranslation, cacheTranslation } from '../i18n';

// access token 만료 시 자동 refresh 후 재시도 — 실패 시 auth:expired 이벤트 발행
let refreshPromise = null;

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: 'include', // httpOnly 쿠키 자동 전송
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 401 && path !== '/auth/refresh' && path !== '/auth/login' && path !== '/auth/logout') {
    if (!refreshPromise) {
      refreshPromise = fetch('/auth/refresh', { method: 'POST', credentials: 'include' })
        .finally(() => { refreshPromise = null; });
    }
    const refreshRes = await refreshPromise;
    if (refreshRes.ok) {
      return apiFetch(path, options);
    }
    window.dispatchEvent(new Event('auth:expired'));
    throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export const api = {
  // 인증
  login:   (data) => apiFetch('/auth/login',  { method: 'POST', body: JSON.stringify(data) }),
  signup:  (data) => apiFetch('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
  logout:  ()     => apiFetch('/auth/logout', { method: 'POST' }),
  getMe:   ()     => apiFetch('/auth/me'),
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

  // TTS (Google Cloud TTS → 서버 프록시, /tts-audio/:lang/:key 로 mp3 직접 서빙됨)
  tts: (text, language = 'ko') => apiFetch('/tts', { method: 'POST', body: JSON.stringify({ text, language }) }),

  // 유저 역할
  setUserRole: (nickname, role) => apiFetch(`/users/${encodeURIComponent(nickname)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),

  // 개인 전투 설정
  getBattleSettings:  ()     => apiFetch('/me/battle-settings'),
  saveBattleSettings: (data) => apiFetch('/me/battle-settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  }),

  // Admin Panel (developer 전용)
  adminGetUsers: () => apiFetch('/admin/users'),
  adminSetRole: (id, role) => apiFetch(`/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  adminSetLeader: (id, isLeader) => apiFetch(`/admin/users/${id}/leader`, { method: 'PATCH', body: JSON.stringify({ isLeader }) }),
  adminBanUser: (id) => apiFetch(`/admin/users/${id}`, { method: 'DELETE' }),

  // 연맹 공지
  addAllianceNotice:    (data) => apiFetch('/alliance-notices', { method: 'POST', body: JSON.stringify(data) }),
  deleteAllianceNotice: (id)   => apiFetch(`/alliance-notices/${id}`, { method: 'DELETE' }),

  // 집결 그룹 (Rally Group Sync)
  listRallyGroups:           ()                                     => apiFetch('/rally-groups'),
  listAssignableUsers:       ()                                     => apiFetch('/rally-groups/assignable-users'),
  createRallyGroup:          (data)                                 => apiFetch('/rally-groups', { method: 'POST', body: JSON.stringify(data) }),
  deleteRallyGroup:          (id)                                   => apiFetch(`/rally-groups/${id}`, { method: 'DELETE' }),
  addRallyGroupMember:       (id, userId)                           => apiFetch(`/rally-groups/${id}/members`, { method: 'POST', body: JSON.stringify({ userId }) }),
  removeRallyGroupMember:    (id, memberId)                         => apiFetch(`/rally-groups/${id}/members/${memberId}`, { method: 'DELETE' }),
  updateRallyMarchOverride:  (id, memberId, marchSecondsOverride)   => apiFetch(`/rally-groups/${id}/members/${memberId}/march-override`, { method: 'PATCH', body: JSON.stringify({ marchSecondsOverride }) }),
  startRallyGroup:           (id)                                   => apiFetch(`/rally-groups/${id}/start`, { method: 'POST' }),
  stopRallyGroup:            (id)                                   => apiFetch(`/rally-groups/${id}/stop`, { method: 'POST' }),

  // 이미지 업로드 (FormData — Content-Type 헤더 제거 필요, 401 refresh 포함)
  uploadBoardImage: async (file) => {
    // apiFetch는 Content-Type: application/json을 강제하므로 직접 fetch 사용하되
    // 401 시 refresh 후 재시도 로직은 동일하게 구현
    // FormData는 스트림이라 재사용 시 비어버릴 수 있으므로 호출마다 새로 생성
    async function doUpload() {
      const form = new FormData();
      form.append('file', file);
      return fetch('/boards/upload', {
        method: 'POST',
        credentials: 'include',
        body: form,
        // Content-Type 헤더 없음 (브라우저가 multipart boundary 자동 설정)
      });
    }

    let res = await doUpload();

    // 401이면 refresh 후 재시도
    if (res.status === 401) {
      const refreshRes = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
      if (refreshRes.ok) {
        res = await doUpload();
      } else {
        window.dispatchEvent(new Event('auth:expired'));
        throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = `HTTP ${res.status}`;
      try { errMsg = JSON.parse(errText).message || errMsg; } catch { /* 무시 */ }
      throw new Error(errMsg);
    }
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  },
};

// ── Socket 싱글톤 ──
let _socket = null;

export function getSocket() { return _socket; }

export function connectSocket() {
  if (_socket?.connected) return _socket;
  const url = import.meta.env.VITE_API_URL || '/';
  // httpOnly 쿠키가 자동으로 포함됨 (withCredentials: true)
  _socket = io(url, { withCredentials: true, path: '/socket.io' });
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

  const localCached = getCachedTranslation(msg.content, myLang);
  if (localCached) return { ...msg, translatedContent: localCached };

  try {
    const cacheKey = `chat:${msg.content.slice(0, 80)}:${msg.language}:${myLang}`;
    const serverCached = await api.getTranslation(cacheKey);
    if (serverCached?.translated) {
      cacheTranslation(msg.content, myLang, serverCached.translated);
      return { ...msg, translatedContent: serverCached.translated };
    }

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
