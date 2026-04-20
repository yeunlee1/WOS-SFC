import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { api } from '../../api';

const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#06b6d4',
};

const EMOJIS = [
  '😀','😂','😍','🥰','😭','😡','🤔','💀','👍','👎',
  '🙏','❤️','🔥','💯','⚔️','🛡️','🏰','🗺️','💪','🎯',
  '🌟','✨','🎉','🎊','💥','🔔','📢','🚀','💎','👑',
  '🌈','🌙','⭐','🍀','🎮','🏆','🤝','🌏','🐉','⚡',
];

// Board — 연맹별 게시판 (props: alliance: string)
export default function Board({ alliance }) {
  const { boards, user } = useStore();
  const { t, lang } = useI18n();

  const posts = boards[alliance] || [];
  const color = ALLIANCE_COLORS[alliance] || '#6b7280';

  // 번역 상태
  const [translations, setTranslations] = useState({});
  const [translating,  setTranslating]  = useState({});

  // 이미지 모달
  const [modalImg, setModalImg] = useState(null);

  // 글쓰기 폼
  const [content,      setContent]      = useState('');
  const [imageUrls,    setImageUrls]     = useState([]);
  const [uploadingImg, setUploadingImg]  = useState(false);
  const [showEmoji,    setShowEmoji]     = useState(false);
  const [posting,      setPosting]       = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // lang 변경 시 번역 캐시 리셋
  useEffect(() => { setTranslations({}); }, [lang]);

  // 수동 번역
  async function handleTranslate(postId, postContent) {
    if (translations[postId] || translating[postId]) return;
    setTranslating((prev) => ({ ...prev, [postId]: true }));
    try {
      const res = await api.translate(postContent, lang);
      if (res?.translated) {
        setTranslations((prev) => ({ ...prev, [postId]: res.translated }));
      }
    } catch { /* 실패 시 무시 */ }
    finally {
      setTranslating((prev) => ({ ...prev, [postId]: false }));
    }
  }

  // 이모지 삽입
  function insertEmoji(emoji) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const newVal = content.slice(0, start) + emoji + content.slice(end);
    setContent(newVal);
    // 커서 위치 복원
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
    setShowEmoji(false);
  }

  // 이미지 업로드
  async function handleImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imageUrls.length >= 3) { alert('이미지는 최대 3장까지 첨부 가능합니다'); return; }
    setUploadingImg(true);
    try {
      const res = await api.uploadBoardImage(file);
      setImageUrls((prev) => [...prev, res.url]);
    } catch (err) {
      alert(err.message || '이미지 업로드에 실패했습니다');
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeImage(url) {
    setImageUrls((prev) => prev.filter((u) => u !== url));
  }

  // 게시
  async function handlePost() {
    if (!content.trim() || !user) return;
    setPosting(true);
    try {
      await api.addBoardPost(alliance, {
        nickname:  user.nickname,
        alliance:  user.allianceName,
        content:   content.trim(),
        lang,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      });
      setContent('');
      setImageUrls([]);
    } catch (err) {
      alert(err.message || '게시에 실패했습니다');
    } finally {
      setPosting(false);
    }
  }

  // 삭제
  async function handleDelete(postId) {
    try {
      await api.deleteBoardPost(postId);
    } catch (err) {
      alert(err.message || '삭제에 실패했습니다');
    }
  }

  return (
    <section className="section">
      <h2 className="section-title" style={{ color }}>
        [{alliance}] 게시판
      </h2>

      {/* ── 글쓰기 폼 ── */}
      <div className="board-write-form">
        <div style={{ position: 'relative' }}>
          <textarea
            ref={textareaRef}
            className="input textarea"
            rows={3}
            placeholder="게시물을 작성하세요 (Ctrl+Enter로 게시)"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePost(); }}
          />

          {/* 이모지 팔레트 */}
          {showEmoji && (
            <div className="emoji-palette">
              {EMOJIS.map((em) => (
                <button key={em} className="emoji-btn" onClick={() => insertEmoji(em)}>
                  {em}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 이미지 미리보기 */}
        {imageUrls.length > 0 && (
          <div className="image-preview-row">
            {imageUrls.map((url) => (
              <div key={url} className="image-preview-item">
                <img src={url} alt="첨부 이미지" className="image-preview-thumb" />
                <button className="image-remove-btn" onClick={() => removeImage(url)}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="board-form-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowEmoji((v) => !v)}
            type="button"
          >
            😊 이모지
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingImg || imageUrls.length >= 3}
            type="button"
          >
            {uploadingImg ? '업로드 중...' : '🖼️ 이미지'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageSelect}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={handlePost}
            disabled={posting || !content.trim()}
            style={{ marginLeft: 'auto' }}
          >
            {posting ? '게시 중...' : '게시'}
          </button>
        </div>
      </div>

      {/* ── 게시물 목록 ── */}
      <div className="board-posts">
        {posts.length === 0 ? (
          <p className="empty-message">{t('emptyBoard')}</p>
        ) : (
          posts.map((p) => {
            const postLang      = p.lang || 'ko';
            const needsTrans    = postLang !== lang;
            const translated    = translations[p.id];
            const isTranslating = translating[p.id];

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
                <div className="board-post-content">
                  {translated ? (
                    <>
                      <div className="translated">{translated}</div>
                      <details className="notice-original">
                        <summary>{t('viewOriginal')}</summary>
                        <div className="notice-original-text">{p.content}</div>
                      </details>
                    </>
                  ) : (
                    <div>{p.content}</div>
                  )}
                </div>

                {/* 번역 버튼 — 언어가 다를 때만, 아직 번역 안 됐을 때만 */}
                {needsTrans && !translated && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleTranslate(p.id, p.content)}
                    disabled={isTranslating}
                    style={{ marginTop: '6px' }}
                  >
                    {isTranslating ? '번역 중...' : '🌐 번역'}
                  </button>
                )}

                {/* 이미지 */}
                {p.imageUrls?.length > 0 && (
                  <div className="board-post-images">
                    {p.imageUrls.map((url) => (
                      <img
                        key={url}
                        src={url}
                        alt="게시물 이미지"
                        className="board-post-img"
                        onClick={() => setModalImg(url)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 이미지 모달 */}
      {modalImg && (
        <div className="image-modal-overlay" onClick={() => setModalImg(null)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setModalImg(null)}>✕</button>
            <img src={modalImg} alt="원본 이미지" className="image-modal-img" />
          </div>
        </div>
      )}
    </section>
  );
}
