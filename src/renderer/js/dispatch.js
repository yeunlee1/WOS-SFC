// dispatch.js — Firebase 실시간 집결원 + 발송 타이밍 계산기

function escapeHtml(text) {
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const arrivalTimeInput = document.getElementById('arrival-time');
const calcBtn          = document.getElementById('calc-btn');
const memberNameInput  = document.getElementById('member-name');
const memberNormalInput = document.getElementById('member-normal');
const memberPetInput   = document.getElementById('member-pet');
const memberAddBtn     = document.getElementById('member-add-btn');
const dispatchResult   = document.getElementById('dispatch-result');

// Firebase에서 받은 최신 집결원 목록
let members = [];

// ── Firebase 실시간 수신 ──
window.electronAPI.onMembersUpdated((data) => {
  members = data;
  renderMembers();
});

// ── 집결원 추가 ──
memberAddBtn.addEventListener('click', addMember);

async function addMember() {
  const name = memberNameInput.value.trim();
  const normalSeconds = parseInt(memberNormalInput.value);
  const petSeconds    = parseInt(memberPetInput.value);

  if (!name) { alert('이름을 입력해주세요!'); return; }
  if (isNaN(normalSeconds) || normalSeconds < 0) { alert('일반 이동시간을 입력해주세요!'); return; }
  if (isNaN(petSeconds) || petSeconds < 0) { alert('펫버프 이동시간을 입력해주세요!'); return; }

  memberAddBtn.disabled = true;
  await window.electronAPI.addMember({ name, normalSeconds, petSeconds });
  memberAddBtn.disabled = false;

  memberNameInput.value  = '';
  memberNormalInput.value = '';
  memberPetInput.value   = '';
}

// ── 발송 타이밍 계산 ──
calcBtn.addEventListener('click', calculateDispatch);

function calculateDispatch() {
  if (members.length === 0) { alert('집결원을 먼저 추가해주세요!'); return; }

  const arrivalValue = arrivalTimeInput.value;
  if (!arrivalValue) { alert('상대 도착 예정 시각을 입력해주세요!'); return; }

  const [hours, minutes] = arrivalValue.split(':').map(Number);
  const arrivalDate = new Date();
  arrivalDate.setHours(hours, minutes, 0, 0);
  if (arrivalDate < new Date()) arrivalDate.setDate(arrivalDate.getDate() + 1);

  const results = members.map((m) => {
    const normalDispatch = new Date(arrivalDate.getTime() - m.normalSeconds * 1000);
    const petDispatch    = new Date(arrivalDate.getTime() - m.petSeconds * 1000);
    return { ...m, normalDispatch, petDispatch, isPast: normalDispatch < new Date() };
  });

  results.sort((a, b) => a.normalDispatch - b.normalDispatch);
  renderDispatchResults(results);
}

// ── 집결원 목록 렌더링 ──
function renderMembers() {
  if (members.length === 0) {
    dispatchResult.innerHTML = `<p class="empty-message">${t('emptyDispatch')}</p>`;
    return;
  }

  dispatchResult.innerHTML = members.map((m) => `
    <div class="member-card">
      <div class="member-info">
        <span class="member-name">${escapeHtml(m.name)}</span>
        <span class="member-times">일반: ${formatTime(m.normalSeconds)} / 펫: ${formatTime(m.petSeconds)}</span>
      </div>
      <div class="member-dispatch-time">— —</div>
      <button class="btn btn-danger" data-delete-member="${m.firebaseId}">${t('delete')}</button>
    </div>
  `).join('');
}

// ── 계산 결과 렌더링 ──
function renderDispatchResults(results) {
  dispatchResult.innerHTML = results.map((r) => `
    <div class="member-card">
      <div class="member-info">
        <span class="member-name">${r.name}</span>
        <span class="member-times">일반: ${formatTime(r.normalSeconds)} / 펫: ${formatTime(r.petSeconds)}</span>
      </div>
      <div class="member-dispatch-time ${r.isPast ? 'past' : ''}">
        <div style="font-size:11px;color:var(--text-secondary);font-weight:400">발송 시각</div>
        ${formatDateTime(r.normalDispatch)}
        <div style="font-size:11px;color:var(--text-secondary);font-weight:400;margin-top:2px">
          펫: ${formatDateTime(r.petDispatch)}
        </div>
      </div>
      <button class="btn btn-danger" data-delete-member="${r.firebaseId}">${t('delete')}</button>
    </div>
  `).join('');
}

// ── 삭제 버튼: 이벤트 위임 ──
dispatchResult.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-member]');
  if (!btn) return;
  await window.electronAPI.deleteMember(btn.dataset.deleteMember);
});
