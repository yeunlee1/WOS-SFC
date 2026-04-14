// app.js — 앱 초기화, 탭 전환, 세계 시계
// (로그인/로그아웃은 auth.js가 담당)

// ── i18n 초기화 ──
applyI18n();

// ── 서버 시간 오프셋 (로컬 시계 보정값, ms) ──
window.timeOffset = 0;

// ── 현재 로그인 유저 (auth.js에서 설정) ──
// { nickname, alliance, role, allianceCode }
window.currentUser = null;

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

// 페이지 로드 즉시 시작 (로그인과 무관하게)
startWorldClock();

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
