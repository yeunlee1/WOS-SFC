// main.js — Electron 메인 프로세스

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

// ── Claude API ──
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Firebase ──
const { initializeApp: initFirebase } = require('firebase/app');
const {
  getFirestore,
  collection, doc,
  onSnapshot, addDoc, deleteDoc, setDoc, getDoc,
  serverTimestamp, query, orderBy,
} = require('firebase/firestore');

const firebaseApp = initFirebase({
  apiKey:             process.env.FIREBASE_API_KEY,
  authDomain:         process.env.FIREBASE_AUTH_DOMAIN,
  projectId:          process.env.FIREBASE_PROJECT_ID,
  storageBucket:      process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId:  process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId:              process.env.FIREBASE_APP_ID,
});
const db = getFirestore(firebaseApp);

let mainWindow;
let allianceCode = null;
let unsubscribers = []; // Firestore 리스너 정리용

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
  // 개발 모드에서 DevTools 자동 오픈
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
      messages: [{
        role: 'user',
        content: `Translate the following text to ${targetName}. Output only the translated text, no explanations:\n\n${text}`,
      }],
    });
    return { success: true, result: message.content[0].text };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ── Firebase: 동맹 접속 + 리스너 시작 ──
ipcMain.handle('connect-alliance', async (event, code) => {
  try {
    // 기존 리스너 모두 해제
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    allianceCode = code;

    const base = `alliances/${code}`;

    // 서버 시간 오프셋 계산 (로컬 시계 보정용)
    const localBefore = Date.now();
    const syncRef = doc(db, `${base}/_meta/timesync`);
    await setDoc(syncRef, { t: serverTimestamp() });
    const snap = await getDoc(syncRef);
    const serverTime = snap.data().t.toMillis();
    const timeOffset = serverTime - Math.round((localBefore + Date.now()) / 2);

    // 공지 리스너
    const unsubNotices = onSnapshot(
      query(collection(db, `${base}/notices`), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const data = snapshot.docs.map((d) => {
          const raw = d.data();
          return {
            firebaseId: d.id,
            source: raw.source,
            title: raw.title,
            content: raw.content,
            authorNick: raw.authorNick || '',
            createdAt: raw.createdAt?.toDate?.()
              ? raw.createdAt.toDate().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
              : '',
          };
        });
        mainWindow.webContents.send('notices-updated', data);
      }
    );

    // 집결 타이머 리스너
    const unsubRallies = onSnapshot(
      collection(db, `${base}/rallies`),
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({
          firebaseId: d.id,
          ...d.data(),
        }));
        mainWindow.webContents.send('rallies-updated', data);
      }
    );

    // 집결원 리스너
    const unsubMembers = onSnapshot(
      collection(db, `${base}/members`),
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({
          firebaseId: d.id,
          ...d.data(),
        }));
        mainWindow.webContents.send('members-updated', data);
      }
    );

    // 접속 중 유저 리스너 (90초 이내 heartbeat = 온라인)
    const unsubOnline = onSnapshot(
      collection(db, `${base}/online`),
      (snapshot) => {
        const now = Date.now();
        const data = snapshot.docs
          .map((d) => ({ ...d.data(), lastSeenMs: d.data().lastSeen?.toMillis?.() || 0 }))
          .filter((u) => now - u.lastSeenMs < 90000)
          .sort((a, b) => a.alliance.localeCompare(b.alliance) || a.nickname.localeCompare(b.nickname));
        mainWindow.webContents.send('online-updated', data);
      }
    );

    // 연맹 게시판 리스너 (KOR, NSL, JKY, GPX, UFO)
    const BOARD_ALLIANCES = ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'];
    const unsubBoards = BOARD_ALLIANCES.map((alliance) =>
      onSnapshot(
        query(
          collection(db, `${base}/boards/${alliance}/posts`),
          orderBy('createdAt', 'desc')
        ),
        (snapshot) => {
          const data = snapshot.docs.map((d) => ({
            firebaseId: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.()
              ? d.data().createdAt.toDate().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
              : '',
          }));
          mainWindow.webContents.send(`board-updated-${alliance}`, data);
        }
      )
    );

    unsubscribers = [unsubNotices, unsubRallies, unsubMembers, unsubOnline, ...unsubBoards];

    return { success: true, timeOffset };
  } catch (error) {
    console.error('Firebase 연결 오류:', error);
    return { success: false, error: error.message };
  }
});

// ── 공지 CRUD ──
ipcMain.handle('fb-add-notice', async (event, data) => {
  try {
    await addDoc(collection(db, `alliances/${allianceCode}/notices`), {
      ...data,
      createdAt: serverTimestamp(),
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fb-delete-notice', async (event, firebaseId) => {
  try {
    await deleteDoc(doc(db, `alliances/${allianceCode}/notices/${firebaseId}`));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 집결 타이머 CRUD ──
ipcMain.handle('fb-add-rally', async (event, data) => {
  try {
    await addDoc(collection(db, `alliances/${allianceCode}/rallies`), data);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fb-delete-rally', async (event, firebaseId) => {
  try {
    await deleteDoc(doc(db, `alliances/${allianceCode}/rallies/${firebaseId}`));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 집결원 CRUD ──
ipcMain.handle('fb-add-member', async (event, data) => {
  try {
    const ref = await addDoc(collection(db, `alliances/${allianceCode}/members`), data);
    return { success: true, firebaseId: ref.id };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fb-delete-member', async (event, firebaseId) => {
  try {
    await deleteDoc(doc(db, `alliances/${allianceCode}/members/${firebaseId}`));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 번역 캐시 (Firebase 공유) ──
ipcMain.handle('fb-get-translation', async (event, cacheKey) => {
  try {
    // cacheKey에 '/'가 포함되면 안 되므로 doc path 처리
    const safeKey = cacheKey.replace(/\//g, '_');
    const ref = doc(db, `alliances/${allianceCode}/translations/${safeKey}`);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data().translated : null;
  } catch { return null; }
});

ipcMain.handle('fb-set-translation', async (event, cacheKey, translated) => {
  try {
    const safeKey = cacheKey.replace(/\//g, '_');
    await setDoc(doc(db, `alliances/${allianceCode}/translations/${safeKey}`), { translated });
    return { success: true };
  } catch (e) { return { success: false }; }
});

// ── 온라인 상태 ──
ipcMain.handle('fb-set-online', async (event, userData) => {
  try {
    const safeNick = userData.nickname.replace(/[\/\.#\$\[\]]/g, '_');
    await setDoc(doc(db, `alliances/${allianceCode}/online/${safeNick}`), {
      nickname: userData.nickname,
      alliance: userData.alliance,
      role:     userData.role,
      lastSeen: serverTimestamp(),
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fb-remove-online', async (event, nickname) => {
  try {
    const safeNick = nickname.replace(/[\/\.#\$\[\]]/g, '_');
    await deleteDoc(doc(db, `alliances/${allianceCode}/online/${safeNick}`));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 연맹 게시판 CRUD ──
ipcMain.handle('fb-add-board-post', async (event, alliance, data) => {
  try {
    await addDoc(
      collection(db, `alliances/${allianceCode}/boards/${alliance}/posts`),
      { ...data, createdAt: serverTimestamp() }
    );
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fb-delete-board-post', async (event, alliance, firebaseId) => {
  try {
    await deleteDoc(
      doc(db, `alliances/${allianceCode}/boards/${alliance}/posts/${firebaseId}`)
    );
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── 유저 역할 조회 ──
ipcMain.handle('fb-get-user-role', async (event, nickname, devPassword) => {
  try {
    // 개발자 코드 체크 → 관리자 계급 부여
    const devPass = (process.env.DEVELOPER_PASSWORD || '').trim();
    if (devPass && devPassword && devPassword === devPass) {
      return { success: true, role: 'admin' };
    }

    // DEVELOPER_NICKS 체크 (레거시 지원)
    const devNicks = (process.env.DEVELOPER_NICKS || '')
      .split(',').map((n) => n.trim()).filter(Boolean);
    if (devNicks.includes(nickname)) return { success: true, role: 'developer' };

    const ref = doc(db, `alliances/${allianceCode}/users/${nickname}`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return { success: true, role: snap.data().role || 'user' };
    }
    // 신규 유저 — 기본 role 생성
    await setDoc(ref, { role: 'user', createdAt: serverTimestamp() });
    return { success: true, role: 'user' };
  } catch (e) { return { success: true, role: 'user' }; }
});

// ── 유저 역할 변경 (관리자/개발자 전용) ──
ipcMain.handle('fb-set-user-role', async (event, targetNickname, newRole) => {
  try {
    if (!['admin', 'user'].includes(newRole)) {
      return { success: false, error: '유효하지 않은 역할입니다' };
    }
    const ref = doc(db, `alliances/${allianceCode}/users/${targetNickname}`);
    await setDoc(ref, { role: newRole }, { merge: true });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
