// main.js — Electron 메인 프로세스
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

// ── Claude API ──
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Auth / 실시간 ──
const axios = require('axios');
const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3001';
let authToken = null;
let mainSocket = null; // 단일 소켓 (chat + realtime 통합)

let mainWindow;

// ── 창 생성 ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    title: 'WOS SFC 전투 보조',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.argv.includes('--inspect') || process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─────────────────────────────────────────────
// IPC 핸들러
// ─────────────────────────────────────────────

// ── 번역 (Claude Haiku) ──
const LANG_NAMES = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文(简体)' };

ipcMain.handle('translate-to', async (event, text, targetLang) => {
  const targetName = LANG_NAMES[targetLang] || targetLang;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `Translate the following text to ${targetName}. Output only the translated text, no explanations:\n\n${text}` }],
    });
    return { success: true, result: message.content[0].text };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ── 시간 동기화 (connectAlliance 대체) ──
ipcMain.handle('connect-alliance', async () => {
  try {
    const localBefore = Date.now();
    const res = await axios.get(`${SERVER_URL}/time`);
    const serverTime = res.data.utc;
    const timeOffset = serverTime - Math.round((localBefore + Date.now()) / 2);
    return { success: true, timeOffset };
  } catch (e) {
    return { success: true, timeOffset: 0 };
  }
});

// ── 회원가입 ──
ipcMain.handle('auth-signup', async (event, data) => {
  try {
    const res = await axios.post(`${SERVER_URL}/auth/signup`, data);
    authToken = res.data.token;
    return { success: true, user: res.data.user };
  } catch (e) {
    return { success: false, error: e.response?.data?.message || e.message };
  }
});

// ── 로그인 ──
ipcMain.handle('auth-login', async (event, data) => {
  try {
    const res = await axios.post(`${SERVER_URL}/auth/login`, data);
    authToken = res.data.token;
    return { success: true, user: res.data.user };
  } catch (e) {
    return { success: false, error: e.response?.data?.message || e.message };
  }
});

// ── 로그아웃 ──
ipcMain.handle('auth-logout', async () => {
  if (mainSocket) { mainSocket.disconnect(); mainSocket = null; }
  authToken = null;
  return { success: true };
});

// ── 소켓 연결 (로그인 후 한 번 호출 — chat + realtime 통합) ──
ipcMain.handle('socket-connect', async () => {
  if (!authToken) return { success: false, error: '로그인 필요' };
  if (mainSocket?.connected) return { success: true };

  mainSocket = io(SERVER_URL, { auth: { token: authToken } });

  // ── 채팅 이벤트 ──
  mainSocket.on('chat:history', (msgs) => mainWindow.webContents.send('chat-history', msgs));
  mainSocket.on('chat:message', (msg) => mainWindow.webContents.send('chat-message', msg));
  mainSocket.on('chat:system', (text) => mainWindow.webContents.send('chat-system', text));
  mainSocket.on('chat:online', (users) => mainWindow.webContents.send('chat-online', users));

  // ── 실시간 데이터 이벤트 ──
  mainSocket.on('notices:updated', (data) => mainWindow.webContents.send('notices-updated', data));
  mainSocket.on('rallies:updated', (data) => mainWindow.webContents.send('rallies-updated', data));
  mainSocket.on('members:updated', (data) => mainWindow.webContents.send('members-updated', data));
  mainSocket.on('online:updated', (data) => mainWindow.webContents.send('online-updated', data));
  ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'].forEach((a) => {
    mainSocket.on(`board:updated:${a}`, (data) => mainWindow.webContents.send(`board-updated-${a}`, data));
  });

  return { success: true };
});

// ── 채팅 메시지 전송 ──
ipcMain.handle('chat-send', async (event, content) => {
  if (!mainSocket?.connected) return { success: false, error: '소켓 미연결' };
  mainSocket.emit('chat:message', content);
  return { success: true };
});

// ── 공지 CRUD ──
ipcMain.handle('api-add-notice', async (event, data) => {
  try {
    await axios.post(`${SERVER_URL}/notices`, data, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('api-delete-notice', async (event, id) => {
  try {
    await axios.delete(`${SERVER_URL}/notices/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 집결 타이머 CRUD ──
ipcMain.handle('api-add-rally', async (event, data) => {
  try {
    await axios.post(`${SERVER_URL}/rallies`, data, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('api-delete-rally', async (event, id) => {
  try {
    await axios.delete(`${SERVER_URL}/rallies/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 집결원 CRUD ──
ipcMain.handle('api-add-member', async (event, data) => {
  try {
    const res = await axios.post(`${SERVER_URL}/members`, data, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true, id: res.data.id };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('api-delete-member', async (event, id) => {
  try {
    await axios.delete(`${SERVER_URL}/members/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 번역 캐시 ──
ipcMain.handle('api-get-translation', async (event, cacheKey) => {
  try {
    const res = await axios.get(`${SERVER_URL}/translations/${encodeURIComponent(cacheKey)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return res.data;
  } catch { return null; }
});

ipcMain.handle('api-set-translation', async (event, cacheKey, translated) => {
  try {
    await axios.post(`${SERVER_URL}/translations`, { cacheKey, translated }, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return { success: true };
  } catch { return { success: false }; }
});

// ── 연맹 게시판 CRUD ──
ipcMain.handle('api-add-board-post', async (event, alliance, data) => {
  try {
    await axios.post(`${SERVER_URL}/boards`, { ...data, alliance }, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('api-delete-board-post', async (event, id) => {
  try {
    await axios.delete(`${SERVER_URL}/boards/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 유저 역할 조회 ──
ipcMain.handle('api-get-user-role', async (event, nickname) => {
  try {
    const res = await axios.get(`${SERVER_URL}/users/${nickname}/role`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return { success: true, role: res.data.role };
  } catch { return { success: true, role: 'member' }; }
});

// ── 유저 역할 변경 ──
ipcMain.handle('api-set-user-role', async (event, nickname, role) => {
  try {
    await axios.patch(`${SERVER_URL}/users/${nickname}/role`, { role }, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
