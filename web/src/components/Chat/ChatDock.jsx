import { useState, useEffect, useRef, memo } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { CHAT_SEND_ERROR_STYLE, useChatComposer } from './useChatComposer';

// 5-동맹 pill 색상
const ALLIANCE_COLORS = {
  KOR: '#3b82f6',
  NSL: '#22c55e',
  JKY: '#a855f7',
  GPX: '#f97316',
  UFO: '#ec4899',
};

function getAllianceColor(alliance) {
  return ALLIANCE_COLORS[alliance] || '#64748b';
}

// ChatDock — 우측 슬라이딩 도크 (채팅 탭 외 다른 탭에서 표시)
// Props:
//   onClose: () => void  — 닫기 버튼 핸들러
export default function ChatDock({ onClose }) {
  const { t, lang } = useI18n();

  // onlineUsers store에서 직접 읽기 (중복 소켓 집계)
  const onlineUsersRaw = useStore((s) => s.onlineUsers);
  const onlineUsers = Array.from(
    new Map(onlineUsersRaw.map((u) => [u.nickname ?? u, u])).values(),
  );

  const messages = useStore((s) => s.chatMessages);
  const {
    input,
    sending,
    errorText,
    sendMessage,
    handleChange,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
  } = useChatComposer();
  const autoTranslate = useStore((s) => s.chatAutoTranslate);
  const setAutoTranslate = useStore((s) => s.setChatAutoTranslate);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  // 자동 스크롤 — 하단에 있을 때만
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      60;
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <aside className="chat-dock">
      {/* 도크 헤더 */}
      <div className="chat-dock-head">
        <span className="chat-dock-title">
          // {t('chatDockTitle') || 'CHAT'}
        </span>
        <span className="chat-online-pill">{onlineUsers.length}</span>
        <button
          className="chat-dock-close"
          onClick={onClose}
          title={t('chatDockClose') || '닫기'}
          aria-label={t('chatDockClose') || '채팅 닫기'}
        >
          ×
        </button>
      </div>

      {/* 온라인 아바타 스트립 (최대 12명) */}
      <div className="chat-online-strip">
        {onlineUsers.slice(0, 12).map((u) => {
          const color = getAllianceColor(u.alliance);
          const initials = (u.nickname || '??').slice(0, 2).toUpperCase();
          return (
            <div
              key={u.nickname ?? u}
              className="chat-online-avatar"
              style={{ background: color }}
              title={`${u.nickname}${u.alliance ? ' · ' + u.alliance : ''}`}
            >
              {initials}
            </div>
          );
        })}
      </div>

      {/* 메시지 목록 */}
      <div className="chat-dock-msgs" ref={messagesContainerRef}>
        {messages.map((msg, idx) => {
          if (msg._type === 'system') {
            return (
              <div key={msg._id ?? idx} className="chat-dock-system">
                — {msg.text} —
              </div>
            );
          }
          return (
            <DockMessage
              key={msg.id ?? msg._id ?? idx}
              msg={msg}
              autoTranslate={autoTranslate}
              translationLanguage={lang}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* 자동번역 토글 바 */}
      <div className="chat-dock-translate-bar">
        <input
          type="checkbox"
          checked={autoTranslate}
          onChange={(e) => setAutoTranslate(e.target.checked)}
          id="dock-auto-translate"
        />
        <label htmlFor="dock-auto-translate">
          {(t('autoTranslate') || 'AUTO-TRANSLATE').toUpperCase()}
        </label>
      </div>

      {/* 전송 실패 안내 — 실패를 성공처럼 보이게 두지 않는다 */}
      {errorText && (
        <div
          className="chat-send-error"
          data-testid="chat-send-error"
          role="status"
          aria-live="polite"
          style={CHAT_SEND_ERROR_STYLE}
        >
          {errorText}
        </div>
      )}

      {/* 입력 영역 */}
      <div className="chat-dock-input-row">
        <input
          className="input"
          type="text"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={t('chatPlaceholder')}
        />
        <button
          className="btn-primary"
          onClick={sendMessage}
          disabled={sending}
          aria-label={t('chatSend')}
        >
          ▶
        </button>
      </div>
    </aside>
  );
}

// ── 도크 개별 메시지 컴포넌트 ──
const localeMap = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' };

const DockMessage = memo(function DockMessage({
  msg,
  autoTranslate,
  translationLanguage,
}) {
  const { t, lang } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);

  // locale-aware 시간 형식
  const locale = localeMap[lang] || 'ko-KR';
  const time = msg.createdAt
    ? new Date(msg.createdAt).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const hasTranslation =
    msg.translatedContent &&
    msg.translatedLanguage === translationLanguage &&
    msg.translatedContent !== msg.content;

  const displayContent =
    autoTranslate && hasTranslation && !showOriginal
      ? msg.translatedContent
      : msg.content;

  const initials = (msg.nickname || '??').slice(0, 2).toUpperCase();
  const avatarColor = getAllianceColor(msg.allianceName);

  return (
    <div className="chat-dock-msg">
      <div className="chat-dock-msg-avatar" style={{ background: avatarColor }}>
        {initials}
      </div>
      <div className="chat-dock-msg-body">
        <div className="chat-dock-msg-head">
          <span className="chat-dock-msg-nick">{msg.nickname}</span>
          <span className="chat-dock-msg-time">{time}</span>
        </div>
        <p className="chat-dock-msg-text">{displayContent}</p>
        {autoTranslate && hasTranslation && (
          <div
            className="chat-dock-msg-tr"
            style={{ cursor: 'pointer' }}
            onClick={() => setShowOriginal((v) => !v)}
          >
            {showOriginal ? t('viewTranslation') : t('viewOriginal')}
          </div>
        )}
      </div>
    </div>
  );
});
