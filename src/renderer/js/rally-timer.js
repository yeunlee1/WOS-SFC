// rally-timer.js — Firebase 실시간 집결 타이머
// endTimeUTC 방식: 모든 접속자가 동일한 카운트다운 표시

function escapeHtml(text) {
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const rallyNameInput    = document.getElementById('rally-name');
const rallyMinutesInput = document.getElementById('rally-minutes');
const rallySecondsInput = document.getElementById('rally-seconds');
const rallyAddBtn       = document.getElementById('rally-add-btn');
const rallyListContainer = document.getElementById('rally-list');

// 활성 타이머 (id → intervalId)
let rallyTimers = {};
// 현재 렌더링된 집결 목록
let currentRallies = [];

// ── Firebase 실시간 수신 ──
window.electronAPI.onRalliesUpdated((rallies) => {
  currentRallies = rallies;

  // 기존 타이머 전부 정리
  Object.values(rallyTimers).forEach(clearInterval);
  rallyTimers = {};

  // 끝난 집결 제외
  const now = Date.now() + window.timeOffset;
  const active = rallies.filter((r) => r.endTimeUTC > now - 3000); // 3초 여유

  renderRallyCards(active);

  // 각 집결 카운트다운 시작
  active.forEach((rally) => startCountdown(rally));
});

// ── 집결 추가 ──
rallyAddBtn.addEventListener('click', addRally);
rallyNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addRally(); });

async function addRally() {
  if (currentRallies.length >= 6) {
    alert('최대 6개까지만 추적할 수 있어요!');
    return;
  }

  const name = rallyNameInput.value.trim() || '집결';
  const minutes = parseInt(rallyMinutesInput.value) || 0;
  const seconds = parseInt(rallySecondsInput.value) || 0;
  const totalSeconds = minutes * 60 + seconds;

  if (totalSeconds <= 0) { alert('시간을 입력해주세요!'); return; }

  // endTimeUTC = 지금(보정된 시각) + 남은 시간
  const endTimeUTC = Date.now() + window.timeOffset + totalSeconds * 1000;

  rallyAddBtn.disabled = true;
  await window.electronAPI.addRally({ name, endTimeUTC, totalSeconds });
  rallyAddBtn.disabled = false;

  rallyNameInput.value = '';
  rallyMinutesInput.value = '';
  rallySecondsInput.value = '';
}

// ── 카드 렌더링 ──
function renderRallyCards(rallies) {
  if (rallies.length === 0) {
    rallyListContainer.innerHTML = `<p class="empty-message">${t('emptyRally')}</p>`;
    return;
  }

  rallyListContainer.innerHTML = rallies.map((r) => {
    const remaining = Math.max(0, r.endTimeUTC - (Date.now() + window.timeOffset));
    const remainSec = Math.floor(remaining / 1000);
    return `
      <div class="rally-card" data-id="${r.id}">
        <div class="rally-card-header">
          <span class="rally-name">${escapeHtml(r.name)}</span>
          <button class="btn btn-danger" data-delete-rally="${r.id}">${t('delete')}</button>
        </div>
        <div class="rally-countdown" id="countdown-${r.id}">
          ${remainSec > 0 ? `${remainSec}${t('secUnit')}` : t('arrived')}
        </div>
        <div class="rally-progress">
          <div class="rally-progress-bar" id="progress-${r.id}"
            style="width:${Math.min(100, (remaining / (r.totalSeconds * 1000)) * 100)}%">
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ── 카운트다운 ──
function startCountdown(rally) {
  let alerted = false;

  rallyTimers[rally.id] = setInterval(() => {
    const remaining = rally.endTimeUTC - (Date.now() + window.timeOffset);
    const remainSec = Math.floor(remaining / 1000);
    const ratio = remaining / (rally.totalSeconds * 1000);

    const card        = rallyListContainer.querySelector(`[data-id="${rally.id}"]`);
    const countdownEl = document.getElementById(`countdown-${rally.id}`);
    const progressBar = document.getElementById(`progress-${rally.id}`);
    if (!card || !countdownEl) return;

    if (remaining <= 0) {
      clearInterval(rallyTimers[rally.id]);
      countdownEl.textContent = t('arrived');
      countdownEl.className   = 'rally-countdown finished';
      if (progressBar) progressBar.style.width = '0%';
      card.className = 'rally-card danger';

      if (!alerted) {
        alerted = true;
        playBeep(1000, 300);
        setTimeout(() => playBeep(1000, 300), 400);
        setTimeout(() => playBeep(1200, 500), 800);
      }
    } else {
      countdownEl.textContent = `${remainSec}${t('secUnit')}`;
      if (progressBar) progressBar.style.width = `${Math.min(100, ratio * 100)}%`;

      if (ratio < 0.2) {
        countdownEl.className = 'rally-countdown danger';
        if (progressBar) progressBar.className = 'rally-progress-bar danger';
        card.className = 'rally-card danger';
      } else if (ratio < 0.5) {
        countdownEl.className = 'rally-countdown warning';
        if (progressBar) progressBar.className = 'rally-progress-bar warning';
        card.className = 'rally-card warning';
      } else {
        countdownEl.className = 'rally-countdown';
        if (progressBar) progressBar.className = 'rally-progress-bar';
        card.className = 'rally-card';
      }
    }
  }, 200); // 200ms마다 갱신 (부드러운 표시)
}

// ── 삭제 버튼: 이벤트 위임 ──
rallyListContainer.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-rally]');
  if (!btn) return;
  const id = btn.dataset.deleteRally;
  clearInterval(rallyTimers[id]);
  delete rallyTimers[id];
  await window.electronAPI.deleteRally(id);
});
