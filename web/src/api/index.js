import { io } from 'socket.io-client';
import { getCachedTranslation, cacheTranslation } from '../i18n';

// access token 만료 시 자동 refresh 후 재시도 — 실패 시 auth:expired 이벤트 발행
let refreshPromise = null;
const API_TIMEOUT_MS = 35_000;

async function fetchWithTimeout(path, options = {}) {
  const controller = new AbortController();
  const callerSignal = options.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error('API timeout')),
    API_TIMEOUT_MS,
  );

  try {
    return await fetch(path, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

function refreshSession() {
  if (refreshPromise) return refreshPromise;

  let pending;
  pending = fetchWithTimeout('/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  })
    .then((response) => {
      if (!response.ok) throw new Error('Session refresh failed');
      return response;
    })
    .catch((error) => {
      window.dispatchEvent(new Event('auth:expired'));
      throw error;
    })
    .finally(() => {
      if (refreshPromise === pending) refreshPromise = null;
    });
  refreshPromise = pending;
  return pending;
}

async function apiFetch(path, options = {}, allowRefresh = true) {
  const res = await fetchWithTimeout(path, {
    ...options,
    credentials: 'include', // httpOnly 쿠키 자동 전송
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (
    res.status === 401 &&
    path !== '/auth/refresh' &&
    path !== '/auth/login' &&
    path !== '/auth/logout'
  ) {
    if (!allowRefresh) {
      window.dispatchEvent(new Event('auth:expired'));
      throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
    }

    try {
      await refreshSession();
    } catch {
      throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
    }
    return apiFetch(path, options, false);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error = new Error(err.message || `HTTP ${res.status}`);
    error.status = res.status;
    const retryAfterSeconds = Number(res.headers?.get?.('retry-after'));
    const retryAfterMs = Number(err.retryAfterMs);
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      error.retryAfterMs = retryAfterMs;
    } else if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      error.retryAfterMs = retryAfterSeconds * 1000;
    }
    throw error;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  // 인증
  login: (data) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  signup: (data) =>
    apiFetch('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),
  getMe: () => apiFetch('/auth/me'),
  getTime: () => apiFetch('/time'),

  // 공지
  addNotice: (data) =>
    apiFetch('/notices', { method: 'POST', body: JSON.stringify(data) }),
  deleteNotice: (id) => apiFetch(`/notices/${id}`, { method: 'DELETE' }),

  // 집결 타이머
  addRally: (data) =>
    apiFetch('/rallies', { method: 'POST', body: JSON.stringify(data) }),
  deleteRally: (id) => apiFetch(`/rallies/${id}`, { method: 'DELETE' }),

  // 집결원
  addMember: (data) =>
    apiFetch('/members', { method: 'POST', body: JSON.stringify(data) }),
  deleteMember: (id) => apiFetch(`/members/${id}`, { method: 'DELETE' }),

  // 게시판
  addBoardPost: (alliance, data) =>
    apiFetch('/boards', {
      method: 'POST',
      body: JSON.stringify({
        alliance,
        content: data.content,
        lang: data.lang,
        ...(data.imageUrls ? { imageUrls: data.imageUrls } : {}),
      }),
    }),
  deleteBoardPost: (id) => apiFetch(`/boards/${id}`, { method: 'DELETE' }),

  // 번역 실행 (Claude API → 서버)
  translate: (text, targetLang, options = {}) =>
    apiFetch('/translate', {
      method: 'POST',
      body: JSON.stringify({ text, targetLang }),
      signal: options.signal,
    }),

  // TTS (Google Cloud TTS → 서버 프록시, /tts-audio/:lang/:key 로 mp3 직접 서빙됨)
  tts: (text, language = 'ko') =>
    apiFetch('/tts', {
      method: 'POST',
      body: JSON.stringify({ text, language }),
    }),

  // 유저 역할
  setUserRole: (nickname, role) =>
    apiFetch(`/users/${encodeURIComponent(nickname)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  // 개인 전투 설정
  getBattleSettings: () => apiFetch('/me/battle-settings'),
  saveBattleSettings: (data) =>
    apiFetch('/me/battle-settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Admin Panel (developer 전용)
  adminGetUsers: () => apiFetch('/admin/users'),
  adminSetRole: (id, role) =>
    apiFetch(`/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  adminSetLeader: (id, isLeader) =>
    apiFetch(`/admin/users/${id}/leader`, {
      method: 'PATCH',
      body: JSON.stringify({ isLeader }),
    }),
  adminBanUser: (id) => apiFetch(`/admin/users/${id}`, { method: 'DELETE' }),

  // 연맹 공지
  addAllianceNotice: (data) =>
    apiFetch('/alliance-notices', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteAllianceNotice: (id) =>
    apiFetch(`/alliance-notices/${id}`, { method: 'DELETE' }),

  // 집결 그룹 (Rally Group Sync)
  listRallyGroups: () => apiFetch('/rally-groups'),
  listAssignableUsers: () => apiFetch('/rally-groups/assignable-users'),
  createRallyGroup: (data) =>
    apiFetch('/rally-groups', { method: 'POST', body: JSON.stringify(data) }),
  deleteRallyGroup: (id) =>
    apiFetch(`/rally-groups/${id}`, { method: 'DELETE' }),
  addRallyGroupMember: (id, userId) =>
    apiFetch(`/rally-groups/${id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  removeRallyGroupMember: (id, memberId) =>
    apiFetch(`/rally-groups/${id}/members/${memberId}`, { method: 'DELETE' }),
  updateRallyMarchOverride: (id, memberId, marchSecondsOverride) =>
    apiFetch(`/rally-groups/${id}/members/${memberId}/march-override`, {
      method: 'PATCH',
      body: JSON.stringify({ marchSecondsOverride }),
    }),
  startRallyGroup: (id) =>
    apiFetch(`/rally-groups/${id}/start`, { method: 'POST' }),
  stopRallyGroup: (id) =>
    apiFetch(`/rally-groups/${id}/stop`, { method: 'POST' }),

  // 작전판 저장본
  listOperationBoards: () => apiFetch('/operation-boards'),
  getOperationBoard: (id) => apiFetch(`/operation-boards/${id}`),
  saveOperationBoard: (data) =>
    apiFetch('/operation-boards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  renameOperationBoard: (id, data) =>
    apiFetch(`/operation-boards/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteOperationBoard: (id) =>
    apiFetch(`/operation-boards/${id}`, {
      method: 'DELETE',
    }),

  // 이미지 업로드 (FormData — Content-Type 헤더 제거 필요, 401 refresh 포함)
  uploadOperationBoardBackground: async (file) => {
    async function doUpload() {
      const form = new FormData();
      form.append('file', file);
      return fetchWithTimeout('/operation-boards/background', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
    }

    let res = await doUpload();

    if (res.status === 401) {
      try {
        await refreshSession();
      } catch {
        throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
      }
      res = await doUpload();
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = `HTTP ${res.status}`;
      try {
        errMsg = JSON.parse(errText).message || errMsg;
      } catch {
        /* 무시 */
      }
      throw new Error(errMsg);
    }
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },

  uploadBoardImage: async (file) => {
    // apiFetch는 Content-Type: application/json을 강제하므로 직접 fetch 사용하되
    // 401 시 refresh 후 재시도 로직은 동일하게 구현
    // FormData는 스트림이라 재사용 시 비어버릴 수 있으므로 호출마다 새로 생성
    async function doUpload() {
      const form = new FormData();
      form.append('file', file);
      return fetchWithTimeout('/boards/upload', {
        method: 'POST',
        credentials: 'include',
        body: form,
        // Content-Type 헤더 없음 (브라우저가 multipart boundary 자동 설정)
      });
    }

    let res = await doUpload();

    // 401이면 refresh 후 재시도
    if (res.status === 401) {
      try {
        await refreshSession();
      } catch {
        throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
      }
      res = await doUpload();
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = `HTTP ${res.status}`;
      try {
        errMsg = JSON.parse(errText).message || errMsg;
      } catch {
        /* 무시 */
      }
      throw new Error(errMsg);
    }
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
};

// ── Socket 싱글톤 ──
let _socket = null;
// 서버가 인증 실패로 소켓을 끊었을 때 refresh를 몇 번 시도했는지 추적한다.
// 액세스 토큰 수명이 1시간이라 작전 중 재접속이 그대로 로그아웃이 되면 안 된다.
let _socketAuthRetried = false;
let _socketStableTimer = null;
// 이 시간 이상 유지된 연결은 정상 인증으로 보고 갱신 재시도 기회를 되돌려준다.
// 밴/권한 회수처럼 붙자마자 끊기는 경우는 이 시간을 못 채워 재시도가 1회로 제한된다.
const SOCKET_STABLE_MS = 10_000;

function clearSocketStableTimer() {
  if (_socketStableTimer) clearTimeout(_socketStableTimer);
  _socketStableTimer = null;
}

export function getSocket() {
  return _socket;
}

export function connectSocket() {
  // 연결 중이거나 재연결 중인 인스턴스도 같은 singleton을 재사용한다.
  // connected만 검사하면 같은 render commit의 여러 hook이 각각 새 연결을 만든다.
  if (_socket) return _socket;
  const url = import.meta.env.VITE_API_URL || '/';
  // httpOnly 쿠키가 자동으로 포함됨 (withCredentials: true)
  const socket = io(url, {
    withCredentials: true,
    path: '/socket.io',
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });
  _socket = socket;

  socket.on('connect', () => {
    if (_socket !== socket) return;
    clearSocketStableTimer();
    _socketStableTimer = setTimeout(() => {
      _socketStableTimer = null;
      _socketAuthRetried = false;
    }, SOCKET_STABLE_MS);
  });

  socket.on('disconnect', (reason) => {
    // 서버가 권한 변경 등으로 연결을 끊으면 Socket.IO는 자동 재연결하지 않는다.
    // 수동 로그아웃과 일시적인 네트워크 단절은 각각 기존 흐름을 유지한다.
    if (reason !== 'io server disconnect' || _socket !== socket) return;
    clearSocketStableTimer();

    // 만료된 액세스 토큰으로 재접속하면 서버가 인증 실패로 끊는다.
    // 곧바로 로그아웃하면 작전 중 카운트다운까지 죽으므로 갱신을 한 번 시도한다.
    if (_socketAuthRetried) {
      _socket = null;
      window.dispatchEvent(new Event('auth:expired'));
      return;
    }
    _socketAuthRetried = true;
    refreshSession()
      .then(() => {
        if (_socket !== socket) return;
        socket.connect();
      })
      .catch(() => {
        // refreshSession이 실패 시 이미 auth:expired를 발행한다.
        if (_socket === socket) _socket = null;
      });
  });

  if (import.meta.env.DEV) {
    socket.on('connect_error', (err) => {
      console.warn('[socket] connect_error:', err.message);
    });
  }
  return socket;
}

export function disconnectSocket() {
  clearSocketStableTimer();
  _socketAuthRetried = false;
  _socket?.disconnect();
  _socket = null;
}

// ── 채팅 자동번역 ──
export async function translateChatMessage(msg, myLang, options = {}) {
  if (
    !myLang ||
    myLang === 'other' ||
    !msg.language ||
    msg.language === myLang
  ) {
    return msg;
  }

  const localCached = getCachedTranslation(msg.content, myLang);
  if (localCached) {
    return {
      ...msg,
      translatedContent: localCached,
      translatedLanguage: myLang,
    };
  }

  const res = await api.translate(msg.content, myLang, options);
  if (res?.translated) {
    cacheTranslation(msg.content, myLang, res.translated);
    return {
      ...msg,
      translatedContent: res.translated,
      translatedLanguage: myLang,
    };
  }

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
    gainNode.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + duration / 1000,
    );
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration / 1000);
  } catch {
    /* AudioContext 미지원 시 무시 */
  }
}
