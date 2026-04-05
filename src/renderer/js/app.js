// app.js — 앱 초기화, 탭 전환, 동맹 접속, 세계 시계

// ── i18n 초기화 ──
applyI18n();

// ── 서버 시간 오프셋 (로컬 시계 보정값, ms) ──
window.timeOffset = 0;

// ── 현재 로그인 유저 ──
window.currentUser = null; // { nickname, alliance, role, allianceCode }
let _heartbeatTimer = null;

// ─────────────────────────────────────────────
// 동맹 코드 접속
// ─────────────────────────────────────────────
const allianceModal   = document.getElementById('alliance-modal');
const allianceInput   = document.getElementById('alliance-code-input');
const nicknameInput   = document.getElementById('nickname-input');
const allianceJoinBtn = document.getElementById('alliance-join-btn');
const allianceError   = document.getElementById('alliance-error');
const appContainer    = document.getElementById('app');

// ── 선택된 연맹 ──
let _selectedAlliance = localStorage.getItem('wos-alliance') || '';

// ── 모달 언어 버튼 ──
function selectModalLang(code) {
  setCurrentLang(code);
  applyI18n();
  document.querySelectorAll('.modal-lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === code);
  });
}

document.querySelectorAll('.modal-lang-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectModalLang(btn.dataset.lang));
});

selectModalLang(getCurrentLang());

// ── 모달 연맹 버튼 ──
function selectModalAlliance(alliance) {
  _selectedAlliance = alliance;
  document.querySelectorAll('.modal-alliance-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.alliance === alliance);
  });
}

document.querySelectorAll('.modal-alliance-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectModalAlliance(btn.dataset.alliance));
});

// 저장된 연맹 복원
if (_selectedAlliance) selectModalAlliance(_selectedAlliance);

// 로그아웃 버튼
document.getElementById('logout-btn').addEventListener('click', logout);

async function connectAlliance(code, alliance, nickname) {
  allianceJoinBtn.disabled = true;
  allianceJoinBtn.textContent = t('modalConnecting');
  allianceError.textContent = '';

  const result = await window.electronAPI.connectAlliance(code);

  if (result.success) {
    window.timeOffset = result.timeOffset || 0;

    // 역할 조회 (개발자 코드 포함)
    const devPassword = document.getElementById('dev-password-input')?.value?.trim() || '';
    const roleResult = await window.electronAPI.getUserRole(nickname, devPassword);
    const role = roleResult.role || 'user';

    // 현재 유저 세팅
    window.currentUser = { nickname, alliance, role, allianceCode: code };
    localStorage.setItem('wos-alliance-code', code);
    localStorage.setItem('wos-alliance', alliance);
    localStorage.setItem('wos-nickname', nickname);

    // 온라인 상태 등록 + 하트비트
    await window.electronAPI.setOnline({ nickname, alliance, role });
    _startHeartbeat(nickname, alliance, role);

    // UI 전환
    renderUserInfo();
    allianceModal.style.display = 'none';
    appContainer.style.display = 'flex';
    startWorldClock();
  } else {
    allianceError.textContent = '연결 실패: ' + result.error;
    allianceJoinBtn.disabled = false;
    allianceJoinBtn.textContent = t('modalJoin');
  }
}

allianceJoinBtn.addEventListener('click', () => {
  const code     = allianceInput.value.trim();
  const alliance = _selectedAlliance;
  const nickname = nicknameInput.value.trim();

  if (!code)        { allianceError.textContent = '서버 코드를 입력해주세요'; return; }
  if (code !== '2677') { allianceError.textContent = '서버 코드가 틀렸습니다'; return; }
  if (!alliance)    { allianceError.textContent = '연맹을 선택해주세요'; return; }
  if (!nickname)    { allianceError.textContent = '닉네임을 입력해주세요'; return; }

  connectAlliance(code, alliance, nickname);
});

allianceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') allianceJoinBtn.click();
});
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') allianceJoinBtn.click();
});

// 저장된 값 복원 (자동 접속은 하지 않음)
const savedCode = localStorage.getItem('wos-alliance-code');
const savedNick = localStorage.getItem('wos-nickname');
if (savedCode) allianceInput.value = savedCode;
if (savedNick) nicknameInput.value = savedNick;

// ── 헤더 유저 정보 렌더링 ──
const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#06b6d4',
};

function renderUserInfo() {
  const u = window.currentUser;
  if (!u) return;

  document.getElementById('user-info').style.display = 'flex';
  const badge = document.getElementById('user-alliance-badge');
  badge.textContent = u.alliance;
  badge.style.background = ALLIANCE_COLORS[u.alliance] || '#6b7280';

  document.getElementById('user-nickname').textContent = u.nickname;

  const roleBadge = document.getElementById('user-role-badge');
  const roleText = t('role' + u.role.charAt(0).toUpperCase() + u.role.slice(1));
  roleBadge.textContent = roleText;
  roleBadge.className = `user-role-badge role-${u.role}`;
}

// ── 하트비트 (30초마다 온라인 갱신) ──
function _startHeartbeat(nickname, alliance, role) {
  clearInterval(_heartbeatTimer);
  _heartbeatTimer = setInterval(() => {
    window.electronAPI.setOnline({ nickname, alliance, role });
  }, 30000);
}

// ── 로그아웃 ──
async function logout() {
  clearInterval(_heartbeatTimer);
  if (window.currentUser) {
    await window.electronAPI.removeOnline(window.currentUser.nickname);
  }
  window.currentUser = null;
  localStorage.removeItem('wos-alliance-code');
  document.getElementById('user-info').style.display = 'none';
  appContainer.style.display = 'none';
  allianceModal.style.display = 'flex';
  allianceError.textContent = '';
  allianceJoinBtn.disabled = false;
  allianceJoinBtn.textContent = t('modalJoin');
}

// ─────────────────────────────────────────────
// 세계 시계 (UTC, 초 단위)
// ─────────────────────────────────────────────
const worldClockEl = document.getElementById('world-clock');

function startWorldClock() {
  function tick() {
    const now = new Date(Date.now() + window.timeOffset);
    const h = String(now.getUTCHours()).padStart(2, '0');
    const m = String(now.getUTCMinutes()).padStart(2, '0');
    const s = String(now.getUTCSeconds()).padStart(2, '0');
    worldClockEl.textContent = `UTC ${h}:${m}:${s}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ─────────────────────────────────────────────
// 탭 전환
// ─────────────────────────────────────────────
const tabBtns   = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    tabBtns.forEach((b) => b.classList.remove('active'));
    tabPanels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(target).classList.add('active');
  });
});

// ─────────────────────────────────────────────
// 서브 탭 전환 (커뮤니티)
// ─────────────────────────────────────────────
document.querySelectorAll('.sub-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.subtab;
    document.querySelectorAll('.sub-tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.sub-tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(target)?.classList.add('active');
  });
});

// ─────────────────────────────────────────────
// 공통 유틸리티
// ─────────────────────────────────────────────

// 초 → "MM:SS"
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Date → "HH:MM:SS"
function formatDateTime(date) {
  return date.toTimeString().slice(0, 8);
}

// 현재 로컬 날짜/시각 문자열
function getNowString() {
  const now = new Date();
  return `${now.toLocaleDateString('ko-KR')} ${now.toTimeString().slice(0, 5)}`;
}

// 비프음
function playBeep(frequency = 880, duration = 500) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration / 1000);
  } catch (e) {
    console.warn('비프음 재생 실패:', e);
  }
}
