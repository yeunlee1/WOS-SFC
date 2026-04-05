// noticeboard.js — 공지 게시판 (목록 / 상세 / 글쓰기 뷰)

const noticeSourceSelect    = document.getElementById('notice-source');
const noticeTitleInput      = document.getElementById('notice-title');
const noticeContentTextarea = document.getElementById('notice-content');
const noticeAddBtn          = document.getElementById('notice-add-btn');

// 뷰 요소
const noticeListView      = document.getElementById('notice-list-view');
const noticeWriteView     = document.getElementById('notice-write-view');
const noticeDetailView    = document.getElementById('notice-detail-view');
const noticeBoardList     = document.getElementById('notice-board-list');
const noticeDetailContent = document.getElementById('notice-detail-content');

let notices = [];
let _detailNoticeId = null;

// ── 뷰 전환 ──
function showNoticeView(view) {
  noticeListView.style.display   = view === 'list'   ? '' : 'none';
  noticeWriteView.style.display  = view === 'write'  ? '' : 'none';
  noticeDetailView.style.display = view === 'detail' ? '' : 'none';
}

document.getElementById('notice-write-btn').addEventListener('click', () => showNoticeView('write'));

document.getElementById('notice-back-from-write').addEventListener('click', () => showNoticeView('list'));

document.getElementById('notice-back-from-detail').addEventListener('click', () => {
  _detailNoticeId = null;
  showNoticeView('list');
});

document.getElementById('notice-detail-delete').addEventListener('click', async () => {
  if (!_detailNoticeId) return;
  await window.electronAPI.deleteNotice(_detailNoticeId);
  _detailNoticeId = null;
  showNoticeView('list');
});

// ── Firebase 실시간 수신 ──
window.electronAPI.onNoticesUpdated((data) => {
  notices = data;
  renderNoticeList();
  if (_detailNoticeId) renderNoticeDetail(_detailNoticeId);
});

// ── 공지 추가 ──
noticeAddBtn.addEventListener('click', addNotice);

async function addNotice() {
  const content = noticeContentTextarea.value.trim();
  if (!content) { alert('공지 내용을 입력해주세요!'); return; }

  noticeAddBtn.disabled = true;
  await window.electronAPI.addNotice({
    source:  noticeSourceSelect.value,
    title:   noticeTitleInput.value.trim() || '공지',
    content,
    lang: getCurrentLang(),
  });
  noticeAddBtn.disabled = false;
  noticeTitleInput.value      = '';
  noticeContentTextarea.value = '';
  showNoticeView('list');
}

// ── 목록 렌더링 ──
function renderNoticeList() {
  if (notices.length === 0) {
    noticeBoardList.innerHTML = `<p class="empty-message">${t('emptyNotice')}</p>`;
    return;
  }

  const SOURCE_ICON = { discord: '💬', kakao: '🟡', game: '🎮' };

  noticeBoardList.innerHTML = notices.map((n) => `
    <div class="notice-row" data-id="${escapeHtml(n.firebaseId)}">
      <span class="notice-row-icon">${SOURCE_ICON[n.source] || '📌'}</span>
      <span class="notice-row-title">${escapeHtml(n.title || '공지')}</span>
      <span class="notice-row-date">${escapeHtml(n.createdAt || '')}</span>
    </div>
  `).join('');

  noticeBoardList.querySelectorAll('.notice-row').forEach((row) => {
    row.addEventListener('click', () => {
      _detailNoticeId = row.dataset.id;
      renderNoticeDetail(_detailNoticeId);
      showNoticeView('detail');
    });
  });
}

// ── 상세 렌더링 ──
function renderNoticeDetail(noticeId) {
  const notice = notices.find((n) => n.firebaseId === noticeId);
  if (!notice) { showNoticeView('list'); return; }

  const lang = getCurrentLang();
  const postLang = notice.lang || 'ko';
  const needsTranslation = postLang !== lang;
  const cached = needsTranslation ? getCachedTranslation(notice.content, lang) : null;

  const SOURCE_LABEL = { discord: '💬 Discord', kakao: '🟡 KakaoTalk', game: '🎮 In-game' };

  let contentHtml;
  if (!needsTranslation) {
    contentHtml = `<div class="notice-detail-text" id="nd-text">${escapeHtml(notice.content)}</div>`;
  } else if (cached) {
    contentHtml = `
      <div class="notice-detail-text translated" id="nd-text">${escapeHtml(cached)}</div>
      <details class="notice-original">
        <summary>${t('viewOriginal')}</summary>
        <div class="notice-original-text">${escapeHtml(notice.content)}</div>
      </details>`;
  } else {
    contentHtml = `
      <div class="notice-detail-text translating" id="nd-text"></div>
      <details class="notice-original" id="nd-orig" style="display:none">
        <summary>${t('viewOriginal')}</summary>
        <div class="notice-original-text">${escapeHtml(notice.content)}</div>
      </details>`;
  }

  noticeDetailContent.innerHTML = `
    <div class="notice-detail-header">
      <span class="notice-badge ${notice.source}">${SOURCE_LABEL[notice.source] || '📌'}</span>
      <span class="notice-detail-title">${escapeHtml(notice.title || '공지')}</span>
    </div>
    <span class="notice-detail-date">${escapeHtml(notice.createdAt || '')}</span>
    ${contentHtml}
  `;

  if (needsTranslation && !cached) {
    _translateDetailNotice(notice, lang);
  }
}

async function _translateDetailNotice(notice, lang) {
  const cacheKey = `${lang}_${notice.content.length}_${notice.content.substring(0, 60)}`;
  const fbCached = await window.electronAPI.getTranslation(cacheKey);

  const el = document.getElementById('nd-text');
  if (!el) return;

  if (fbCached) {
    cacheTranslation(notice.content, lang, fbCached);
    el.textContent = fbCached;
    el.className = 'notice-detail-text translated';
    const origEl = document.getElementById('nd-orig');
    if (origEl) origEl.style.display = '';
    return;
  }

  const result = await window.electronAPI.translateTo(notice.content, lang);
  const elNow = document.getElementById('nd-text');
  if (!elNow) return;

  if (result.success) {
    cacheTranslation(notice.content, lang, result.result);
    window.electronAPI.setTranslation(cacheKey, result.result);
    elNow.textContent = result.result;
    elNow.className = 'notice-detail-text translated';
    const origEl = document.getElementById('nd-orig');
    if (origEl) origEl.style.display = '';
  } else {
    elNow.textContent = notice.content;
    elNow.className = 'notice-detail-text';
  }
}

// i18n.js changeLang에서 호출
function renderNotices() {
  renderNoticeList();
  if (_detailNoticeId) renderNoticeDetail(_detailNoticeId);
}

// ── XSS 방지 ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
