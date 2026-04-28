import { useState } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { api } from '../../api';

const SOURCE_ICON  = { discord: '💬', kakao: '🟡', game: '🎮' };
const SOURCE_LABEL = { discord: '💬 Discord', kakao: '🟡 KakaoTalk', game: '🎮 In-game' };

const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#06b6d4',
};

// AllianceNoticeboard — 연맹별 공지사항 컴포넌트
// 목록 / 글쓰기 / 상세 세 가지 뷰 전환
export default function AllianceNoticeboard({ alliance }) {
  const { allianceNotices, user } = useStore();
  const { t, lang } = useI18n();

  const notices = allianceNotices[alliance] || [];
  const color = ALLIANCE_COLORS[alliance] || '#6b7280';

  // 쓰기 권한: 해당 연맹의 admin/developer
  const canWrite = user &&
    (user.role === 'admin' || user.role === 'developer') &&
    user.allianceName === alliance;

  const [view, setView] = useState('list');
  const [detailId, setDetailId] = useState(null);

  // 글쓰기 폼
  const [source,  setSource]  = useState('discord');
  const [title,   setTitle]   = useState('');
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);

  // 번역 상태 Map<noticeId, translatedText>
  const [translations, setTranslations] = useState({});
  const [translating, setTranslating] = useState({});

  async function handleTranslate(notice) {
    if (translations[notice.id] || translating[notice.id]) return;
    setTranslating((prev) => ({ ...prev, [notice.id]: true }));
    try {
      const res = await api.translate(notice.content, lang);
      if (res?.translated) {
        setTranslations((prev) => ({ ...prev, [notice.id]: res.translated }));
      }
    } catch { /* 실패 시 무시 */ }
    finally {
      setTranslating((prev) => ({ ...prev, [notice.id]: false }));
    }
  }

  async function handlePost() {
    if (!content.trim()) { alert('공지 내용을 입력해주세요!'); return; }
    setPosting(true);
    try {
      await api.addAllianceNotice({ alliance, source, title: title.trim() || '공지', content: content.trim(), lang });
      setSource('discord'); setTitle(''); setContent('');
      setView('list');
    } catch (err) {
      alert(err.message || '공지 등록에 실패했습니다');
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteAllianceNotice(id);
      if (view === 'detail') { setView('list'); setDetailId(null); }
    } catch (err) {
      alert(err.message || '삭제에 실패했습니다');
    }
  }

  // ─── 목록 뷰 ───
  if (view === 'list') {
    return (
      <section className="section">
        <div className="section-header">
          <h2 className="section-title" style={{ color }}>
            [{alliance}] 공지사항
          </h2>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => setView('write')}>
              공지 작성
            </button>
          )}
        </div>

        <div className="notice-board-list">
          {notices.length === 0 ? (
            <p className="empty-message">등록된 공지가 없습니다</p>
          ) : (
            notices.map((n) => (
              <div
                key={n.id}
                className="notice-row post-card"
                onClick={() => { setDetailId(String(n.id)); setView('detail'); }}
              >
                <span className="notice-row-icon post-icon">{SOURCE_ICON[n.source] || '📌'}</span>
                <span className="notice-row-title post-title">{n.title || '공지'}</span>
                <span className="notice-row-date post-meta">{n.createdAt || ''}</span>
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  // ─── 글쓰기 뷰 ───
  if (view === 'write') {
    return (
      <section className="section">
        <div className="section-header">
          <button className="btn btn-ghost" onClick={() => setView('list')}>← 목록</button>
          <h2 className="section-title">[{alliance}] 공지 작성</h2>
        </div>
        <div className="input-col compose-card">
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="discord">💬 Discord</option>
            <option value="kakao">🟡 KakaoTalk</option>
            <option value="game">🎮 In-game</option>
          </select>
          <input
            className="input"
            placeholder="제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="input textarea"
            rows={6}
            placeholder="공지 내용을 입력하세요"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handlePost} disabled={posting}>
            {posting ? '등록 중...' : '공지 등록'}
          </button>
        </div>
      </section>
    );
  }

  // ─── 상세 뷰 ───
  const notice = notices.find((n) => String(n.id) === detailId);
  if (!notice) {
    setView('list');
    return null;
  }

  const postLang = notice.lang || 'ko';
  const needsTrans = postLang !== lang;
  const translated = translations[notice.id];
  const isTranslating = translating[notice.id];
  const isAdmin = user?.role === 'admin' || user?.role === 'developer';

  return (
    <section className="section">
      <div className="section-header">
        <button className="btn btn-ghost" onClick={() => { setView('list'); setDetailId(null); }}>
          ← 목록
        </button>
        {isAdmin && (
          <button className="btn btn-danger" onClick={() => handleDelete(notice.id)}>
            삭제
          </button>
        )}
      </div>

      <div className="notice-detail-content">
        <div className="notice-detail-header">
          <span className={`notice-badge ${notice.source}`}>
            {SOURCE_LABEL[notice.source] || '📌'}
          </span>
          <span className="notice-detail-title">{notice.title || '공지'}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
          <span className="notice-detail-date">{notice.createdAt || ''}</span>
          <span className="notice-detail-author" style={{ fontSize: '12px', color: 'var(--text-3)' }}>
            작성: {notice.authorNick}
          </span>
        </div>

        {/* 번역 버튼 */}
        {needsTrans && !translated && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => handleTranslate(notice)}
            disabled={isTranslating}
            style={{ marginBottom: '8px' }}
          >
            {isTranslating ? '번역 중...' : '🌐 번역'}
          </button>
        )}

        {/* 본문 */}
        {translated ? (
          <>
            <div className="notice-detail-text translated">{translated}</div>
            <details className="notice-original">
              <summary>원문 보기</summary>
              <div className="notice-original-text">{notice.content}</div>
            </details>
          </>
        ) : (
          <div className="notice-detail-text">{notice.content}</div>
        )}
      </div>
    </section>
  );
}
