// online.js — 접속 중 유저 목록 (실시간)

const onlineListEl  = document.getElementById('online-list');
const onlineCountEl = document.getElementById('online-count');


const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#06b6d4',
};

const ROLE_ICON = {
  developer: '👑',
  admin:     '⚡',
  user:      '',
};

// 마지막으로 받은 유저 목록 (역할 변경 후 재렌더에 사용)
let _lastOnlineUsers = [];

// ── Firebase 실시간 수신 ──
window.electronAPI.onOnlineUpdated((data) => {
  _lastOnlineUsers = data;
  renderOnlineList(data);
});

function renderOnlineList(users) {
  onlineCountEl.textContent = users.length;

  if (users.length === 0) {
    onlineListEl.innerHTML = '<p class="empty-message">—</p>';
    return;
  }

  onlineListEl.innerHTML = users.map((u) => {
    const color = ALLIANCE_COLORS[u.alliance] || '#6b7280';
    const icon  = ROLE_ICON[u.role] || '';
    return `
      <div class="online-user-chip">
        <span class="online-alliance-badge" style="background:${color}">${escapeHtml(u.alliance)}</span>
        <span class="online-nickname">${escapeHtml(u.nickname)}</span>
        ${icon ? `<span class="online-role-icon">${icon}</span>` : ''}
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
