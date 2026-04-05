// community.js — 연맹 게시판 (자동 번역 포함)

const BOARD_ALLIANCES = ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'];

const BOARD_ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#06b6d4',
};

// ── 마지막 수신 포스트 저장 (언어 변경 시 재번역용) ──
const _lastBoardPosts = {};

// ── 게시하기 버튼 이벤트 ──
document.querySelectorAll('.board-post-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const alliance = btn.dataset.alliance;
    const textarea = document.getElementById(`board-input-${alliance}`);
    const content  = textarea ? textarea.value.trim() : '';
    if (!content || !window.currentUser) return;

    btn.disabled = true;
    await window.electronAPI.addBoardPost(alliance, {
      nickname: window.currentUser.nickname,
      alliance: window.currentUser.alliance,
      content,
      lang: getCurrentLang(),
    });
    if (textarea) textarea.value = '';
    btn.disabled = false;
  });
});

// Ctrl+Enter 단축키
BOARD_ALLIANCES.forEach((alliance) => {
  const textarea = document.getElementById(`board-input-${alliance}`);
  if (!textarea) return;
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      document.querySelector(`.board-post-btn[data-alliance="${alliance}"]`)?.click();
    }
  });
});

// ── Firebase 실시간 수신 ──
BOARD_ALLIANCES.forEach((alliance) => {
  window.electronAPI.onBoardUpdated(alliance, (posts) => {
    _lastBoardPosts[alliance] = posts;
    renderBoardPosts(alliance, posts);
  });
});

// 언어 변경 시 전체 재번역 (i18n.js changeLang에서 호출)
function reRenderAllBoards() {
  BOARD_ALLIANCES.forEach((alliance) => {
    if (_lastBoardPosts[alliance]) renderBoardPosts(alliance, _lastBoardPosts[alliance]);
  });
}

// ── 게시물 렌더링 ──
function renderBoardPosts(alliance, posts) {
  const container = document.getElementById(`board-posts-${alliance}`);
  if (!container) return;

  if (!posts || posts.length === 0) {
    container.innerHTML = `<p class="empty-message">${t('emptyBoard')}</p>`;
    return;
  }

  const color    = BOARD_ALLIANCE_COLORS[alliance] || '#6b7280';
  const userLang = getCurrentLang();

  // ── 동기 렌더: 캐시된 번역은 즉시 표시, 없으면 로딩 표시 ──
  container.innerHTML = posts.map((p) => {
    const postLang        = p.lang || 'ko';
    const needsTranslate  = postLang !== userLang;
    const cached          = needsTranslate ? getCachedTranslation(p.content, userLang) : null;

    const isOwn      = window.currentUser?.nickname === p.nickname;
    const isManager  = window.currentUser?.role === 'admin' || window.currentUser?.role === 'developer';
    const canDelete  = isOwn || isManager;

    let contentHtml;
    let originalHtml = '';
    if (!needsTranslate) {
      // 같은 언어 — 원문 그대로
      contentHtml = `<div class="board-post-content" id="bpc-${escBHtml(p.firebaseId)}">${escBHtml(p.content)}</div>`;
    } else if (cached) {
      // 캐시 있음 — 번역 즉시 표시
      contentHtml = `<div class="board-post-content translated" id="bpc-${escBHtml(p.firebaseId)}">${escBHtml(cached)}</div>`;
      originalHtml = `<details class="notice-original"><summary>${t('viewOriginal')}</summary><div class="notice-original-text">${escBHtml(p.content)}</div></details>`;
    } else {
      // 번역 필요 — 로딩 애니메이션 (원문은 번역 완료 후 표시)
      contentHtml = `<div class="board-post-content translating" id="bpc-${escBHtml(p.firebaseId)}"></div>`;
      originalHtml = `<details class="notice-original" id="bpo-${escBHtml(p.firebaseId)}" style="display:none"><summary>${t('viewOriginal')}</summary><div class="notice-original-text">${escBHtml(p.content)}</div></details>`;
    }

    return `
      <div class="board-post-card" data-id="${escBHtml(p.firebaseId)}" data-alliance="${alliance}">
        <div class="board-post-header">
          <span class="board-post-alliance" style="background:${color}">${escBHtml(p.alliance)}</span>
          <span class="board-post-nickname">${escBHtml(p.nickname)}</span>
          <span class="board-post-date">${escBHtml(p.createdAt || '')}</span>
          ${canDelete ? `<button class="btn btn-danger board-delete-btn" style="margin-left:auto">${t('delete')}</button>` : ''}
        </div>
        ${contentHtml}
        ${originalHtml}
      </div>
    `;
  }).join('');

  // 삭제 버튼
  container.querySelectorAll('.board-delete-btn').forEach((btn) => {
    const card = btn.closest('.board-post-card');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await window.electronAPI.deleteBoardPost(card.dataset.alliance, card.dataset.id);
    });
  });

  // ── 비동기: 캐시 없는 포스트 번역 ──
  _translateUncachedPosts(posts, userLang);
}

async function _translateUncachedPosts(posts, userLang) {
  const uncached = posts.filter((p) => {
    const postLang = p.lang || 'ko';
    return postLang !== userLang && !getCachedTranslation(p.content, userLang);
  });
  if (uncached.length === 0) return;

  // 병렬 번역
  await Promise.all(uncached.map(async (p) => {
    const el = document.getElementById(`bpc-${p.firebaseId}`);
    if (!el) return; // 이미 DOM에서 사라진 경우

    // 1. Firebase 공유 캐시 확인
    const cacheKey = `${userLang}_${p.content.length}_${p.content.substring(0, 60)}`;
    const fbCached = await window.electronAPI.getTranslation(cacheKey);
    if (fbCached) {
      cacheTranslation(p.content, userLang, fbCached);
      const elNow = document.getElementById(`bpc-${p.firebaseId}`);
      if (elNow) { elNow.className = 'board-post-content translated'; elNow.textContent = fbCached; }
      const origEl = document.getElementById(`bpo-${p.firebaseId}`);
      if (origEl) origEl.style.display = '';
      return;
    }

    // 2. Claude API 번역
    const result = await window.electronAPI.translateTo(p.content, userLang);
    const elNow = document.getElementById(`bpc-${p.firebaseId}`); // await 후 재조회
    if (!elNow) return;

    if (result.success) {
      cacheTranslation(p.content, userLang, result.result);
      window.electronAPI.setTranslation(cacheKey, result.result); // Firebase 캐시 저장
      elNow.className = 'board-post-content translated';
      elNow.textContent = result.result;
      // 원문 보기 표시
      const origEl = document.getElementById(`bpo-${p.firebaseId}`);
      if (origEl) origEl.style.display = '';
    } else {
      elNow.className = 'board-post-content';
      elNow.textContent = p.content; // 실패 시 원문 복원
    }
  }));
}

// ── 유틸리티 ──
function escBHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}
