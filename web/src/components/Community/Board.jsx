import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { api } from '../../api';
import { getCachedTranslation, cacheTranslation } from '../../i18n';

const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#06b6d4',
};

// Board — 연맹별 게시판 (props: alliance: string)
export default function Board({ alliance }) {
  const { boards, user } = useStore();
  const { t, lang } = useI18n();

  const posts = boards[alliance] || [];
  const color = ALLIANCE_COLORS[alliance] || '#6b7280';

  // Map<postId, translatedText> — 비동기 번역 결과
  const [translations, setTranslations] = useState({});

  // 게시 폼
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);

  // lang 또는 posts 변경 시 캐시 없는 포스트 번역
  useEffect(() => {
    const uncached = posts.filter((p) => {
      const postLang = p.lang || 'ko';
      return postLang !== lang && !getCachedTranslation(p.content, lang);
    });
    if (uncached.length === 0) return;

    // 이미 캐시된 항목을 state에 반영
    const fromCache = {};
    posts.forEach((p) => {
      const postLang = p.lang || 'ko';
      if (postLang === lang) return;
      const cached = getCachedTranslation(p.content, lang);
      if (cached) fromCache[p.id] = cached;
    });
    if (Object.keys(fromCache).length > 0) {
      setTranslations((prev) => ({ ...prev, ...fromCache }));
    }

    // 병렬 번역
    Promise.all(
      uncached.map(async (p) => {
        const postLang = p.lang || 'ko';
        const cacheKey = `board:${p.content.slice(0, 80)}:${postLang}:${lang}`;
        try {
          const server = await api.getTranslation(cacheKey);
          if (server?.translated) {
            cacheTranslation(p.content, lang, server.translated);
            setTranslations((prev) => ({ ...prev, [p.id]: server.translated }));
            return;
          }
          const res = await api.translate(p.content, lang);
          if (res?.translated) {
            cacheTranslation(p.content, lang, res.translated);
            api.setTranslation(cacheKey, res.translated).catch(() => {});
            setTranslations((prev) => ({ ...prev, [p.id]: res.translated }));
          }
        } catch { /* 실패 시 원문 유지 */ }
      })
    );
  }, [posts, lang]);

  // 게시
  async function handlePost() {
    if (!content.trim() || !user) return;
    setPosting(true);
    try {
      await api.addBoardPost(alliance, {
        nickname: user.nickname,
        alliance: user.allianceName,
        content:  content.trim(),
        lang,
      });
      setContent('');
    } finally {
      setPosting(false);
    }
  }

  // 삭제
  async function handleDelete(postId) {
    await api.deleteBoardPost(postId);
  }

  return (
    <section className="section">
      <h2 className="section-title" style={{ color }}>
        [{alliance}] 게시판
      </h2>

      {/* 게시 폼 */}
      <div className="input-row">
        <textarea
          className="input textarea"
          rows={2}
          placeholder={t('boardPost')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePost();
          }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" onClick={handlePost} disabled={posting || !content.trim()}>
          {t('boardPost')}
        </button>
      </div>

      {/* 게시물 목록 */}
      <div id={`board-posts-${alliance}`}>
        {posts.length === 0 ? (
          <p className="empty-message">{t('emptyBoard')}</p>
        ) : (
          posts.map((p) => {
            const postLang   = p.lang || 'ko';
            const needsTrans = postLang !== lang;
            const translated = translations[p.id];

            const isOwn     = user?.nickname === p.nickname;
            const isManager = user?.role === 'admin' || user?.role === 'developer';
            const canDelete = isOwn || isManager;

            return (
              <div key={p.id} className="board-post-card">
                <div className="board-post-header">
                  <span className="board-post-alliance" style={{ background: color }}>
                    {p.alliance}
                  </span>
                  <span className="board-post-nickname">{p.nickname}</span>
                  <span className="board-post-date">{p.createdAt || ''}</span>
                  {canDelete && (
                    <button
                      className="btn btn-danger board-delete-btn"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => handleDelete(p.id)}
                    >
                      {t('delete')}
                    </button>
                  )}
                </div>

                {/* 본문 */}
                {!needsTrans ? (
                  <div className="board-post-content">{p.content}</div>
                ) : translated ? (
                  <>
                    <div className="board-post-content translated">{translated}</div>
                    <details className="notice-original">
                      <summary>{t('viewOriginal')}</summary>
                      <div className="notice-original-text">{p.content}</div>
                    </details>
                  </>
                ) : (
                  <div className="board-post-content translating">
                    {t('translating')}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
