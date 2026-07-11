import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { api } from '../../api';

const SOURCE_ICON = { discord: '💬', kakao: '🟡', game: '🎮' };
const SOURCE_LABEL = {
  discord: '💬 Discord',
  kakao: '🟡 KakaoTalk',
  game: '🎮 In-game',
};

// Noticeboard — 공지 핀보드 (list / write / detail 뷰)
export default function Noticeboard() {
  const { notices, user } = useStore();
  const { t, lang } = useI18n();

  // 뷰 상태
  const [view, setView] = useState('list'); // 'list' | 'write' | 'detail'
  const [detailId, setDetailId] = useState(null);

  // 글쓰기 폼
  const [source, setSource] = useState('discord');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);

  // 번역 상태 Map<noticeId, translatedText>
  const [translations, setTranslations] = useState({});
  const [translating, setTranslating] = useState({});

  // lang 변경 시 번역 캐시 리셋
  useEffect(() => {
    setTranslations({});
  }, [lang]);

  // 쓰기 권한: admin 또는 developer이면서 KOR 연맹
  const canWrite =
    user &&
    (user.role === 'admin' || user.role === 'developer') &&
    user.allianceName === 'KOR';

  // 수동 번역
  async function handleTranslate(noticeId, noticeContent) {
    if (translations[noticeId] || translating[noticeId]) return;
    setTranslating((prev) => ({ ...prev, [noticeId]: true }));
    try {
      const res = await api.translate(noticeContent, lang);
      if (res?.translated) {
        setTranslations((prev) => ({ ...prev, [noticeId]: res.translated }));
      }
    } catch {
      /* 실패 시 원문 유지 */
    } finally {
      setTranslating((prev) => ({ ...prev, [noticeId]: false }));
    }
  }

  // 공지 추가
  async function handlePost() {
    if (!content.trim()) {
      alert('공지 내용을 입력해주세요!');
      return;
    }
    setPosting(true);
    try {
      await api.addNotice({
        source,
        title: title.trim() || '공지',
        content: content.trim(),
        lang,
      });
      setSource('discord');
      setTitle('');
      setContent('');
      setView('list');
    } finally {
      setPosting(false);
    }
  }

  // 공지 삭제
  async function handleDelete(id) {
    await api.deleteNotice(id);
    setView('list');
    setDetailId(null);
  }

  const detailNotice =
    view === 'detail'
      ? notices.find((notice) => String(notice.id) === detailId)
      : null;

  // 다른 클라이언트가 현재 상세 공지를 삭제하면 즉시 목록 상태로 복구한다.
  useEffect(() => {
    if (view === 'detail' && detailId && !detailNotice) {
      setView('list');
      setDetailId(null);
    }
  }, [view, detailId, detailNotice]);

  // ─── 목록 뷰 ─────────────────────────────────
  if (view === 'list' || (view === 'detail' && !detailNotice)) {
    return (
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">{t('noticeboard')}</h2>
          {canWrite && (
            <button
              className="btn btn-primary"
              onClick={() => setView('write')}
            >
              {t('noticePin')}
            </button>
          )}
        </div>
        <p className="section-desc">{t('noticeboardDesc')}</p>

        <div id="notice-board-list">
          {notices.length === 0 ? (
            <p className="empty-message">{t('emptyNotice')}</p>
          ) : (
            notices.map((n) => (
              <div
                key={n.id}
                className="notice-row post-card"
                onClick={() => {
                  setDetailId(String(n.id));
                  setView('detail');
                }}
              >
                <span className="notice-row-icon post-icon">
                  {SOURCE_ICON[n.source] || '📌'}
                </span>
                <span className="notice-row-title post-title">
                  {n.title || '공지'}
                </span>
                <span className="notice-row-date post-meta">
                  {n.createdAt || ''}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  // ─── 글쓰기 뷰 ───────────────────────────────
  if (view === 'write') {
    return (
      <section className="section">
        <div className="section-header">
          <button className="btn btn-ghost" onClick={() => setView('list')}>
            ← {t('backToList')}
          </button>
          <h2 className="section-title">{t('noticeWriteTitle')}</h2>
        </div>

        <div className="input-col compose-card">
          <select
            className="input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="discord">{t('discord')}</option>
            <option value="kakao">{t('kakao')}</option>
            <option value="game">{t('game')}</option>
          </select>
          <input
            className="input"
            placeholder={t('noticeTitlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="input textarea"
            rows={6}
            placeholder={t('noticeContentPlaceholder')}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button
            className="btn btn-primary"
            onClick={handlePost}
            disabled={posting}
          >
            {t('noticePin')}
          </button>
        </div>
      </section>
    );
  }

  // ─── 상세 뷰 ─────────────────────────────────
  const notice = detailNotice;

  const postLang = notice.lang || 'ko';
  const needsTranslation = postLang !== lang;
  const translated = translations[detailId];
  const isTranslating = translating[detailId];
  const isAdmin = user?.role === 'admin' || user?.role === 'developer';

  return (
    <section className="section">
      <div className="section-header">
        <button
          className="btn btn-ghost"
          onClick={() => {
            setView('list');
            setDetailId(null);
          }}
        >
          ← {t('backToList')}
        </button>
        {isAdmin && (
          <button
            className="btn btn-danger"
            onClick={() => handleDelete(notice.id)}
          >
            {t('delete')}
          </button>
        )}
      </div>

      <div id="notice-detail-content">
        <div className="notice-detail-header">
          <span className={`notice-badge ${notice.source}`}>
            {SOURCE_LABEL[notice.source] || '📌'}
          </span>
          <span className="notice-detail-title">{notice.title || '공지'}</span>
        </div>
        <span className="notice-detail-date">{notice.createdAt || ''}</span>

        {/* 본문 */}
        {!needsTranslation ? (
          <div className="notice-detail-text">{notice.content}</div>
        ) : translated ? (
          <>
            <div className="notice-detail-text translated">{translated}</div>
            <details className="notice-original">
              <summary>{t('viewOriginal')}</summary>
              <div className="notice-original-text">{notice.content}</div>
            </details>
          </>
        ) : (
          <>
            <div className="notice-detail-text">{notice.content}</div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => handleTranslate(detailId, notice.content)}
              disabled={isTranslating}
              style={{ marginTop: '8px' }}
            >
              {isTranslating ? '번역 중...' : '🌐 번역'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
