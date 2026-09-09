// ChatDock — 우측 슬라이딩 도크(채팅 탭 외 다른 탭·작전판 패널에서 표시). 메시지 항목은 ChatMessageItem을 공유한다.
import { useId } from 'react';
import { useStore, getAllianceColor } from '../../store';
import { useI18n } from '../../i18n';
import { retryTranslation } from '../../chat/translationSync';
import { useChatComposer } from './useChatComposer';
import { useAutoScroll } from './useAutoScroll';
import { useOlderTranslations } from './useOlderTranslations';
import ChatMessageItem from './ChatMessageItem';
import { initialsOf } from './chatFormat';

// Props:
//   onClose: () => void  — 닫기 버튼 핸들러
export default function ChatDock({ onClose }) {
  const { t, lang } = useI18n();
  // 작전판 탭에서 앱 도크와 작전판 패널이 동시에 열리면 도크가 둘이다 — id 충돌 방지 (B-12).
  const toggleId = useId();

  // onlineUsers store에서 직접 읽기 (중복 소켓 집계)
  const onlineUsersRaw = useStore((s) => s.onlineUsers);
  const onlineUsers = Array.from(
    new Map(onlineUsersRaw.map((u) => [u.nickname ?? u, u])).values(),
  );

  const messages = useStore((s) => s.chatMessages);
  const translations = useStore((s) => s.chatTranslations);
  const pendingMap = useStore((s) => s.chatTranslationPending);
  const failedMap = useStore((s) => s.chatTranslationFailed);
  const {
    input,
    sending,
    errorText,
    charCount,
    charLimit,
    showCount,
    overLimit,
    sendMessage,
    handleChange,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
  } = useChatComposer();
  const autoTranslate = useStore((s) => s.chatAutoTranslate);
  const setAutoTranslate = useStore((s) => s.setChatAutoTranslate);

  const { containerRef, onScroll, newCount, scrollToBottom } = useAutoScroll(
    messages,
    translations,
  );
  const onScrollOlder = useOlderTranslations(containerRef);

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
        {onlineUsers.slice(0, 12).map((u) => (
          <div
            key={u.nickname ?? u}
            className="chat-online-avatar"
            style={{ background: getAllianceColor(u.alliance) }}
            title={`${u.nickname}${u.alliance ? ' · ' + u.alliance : ''}`}
          >
            {initialsOf(u.nickname)}
          </div>
        ))}
      </div>

      {/* 메시지 목록 */}
      <div
        className="chat-dock-msgs"
        ref={containerRef}
        onScroll={() => {
          onScroll();
          onScrollOlder();
        }}
      >
        {messages.map((msg, idx) => (
          <ChatMessageItem
            key={msg.id ?? msg._id ?? idx}
            msg={msg}
            translations={msg.id != null ? translations[msg.id] : undefined}
            myLang={lang}
            autoTranslate={autoTranslate}
            pending={msg.id != null && !!pendingMap[msg.id]}
            failed={msg.id != null && !!failedMap[msg.id]}
            onRetry={retryTranslation}
            variant="dock"
          />
        ))}
        {newCount > 0 && (
          <button
            type="button"
            className="chat-new-badge"
            onClick={() => scrollToBottom('smooth')}
          >
            {String(t('chatNewMessages')).replace('{count}', String(newCount))}
          </button>
        )}
      </div>

      {/* 자동번역 토글 바 */}
      <div className="chat-dock-translate-bar">
        <input
          type="checkbox"
          checked={autoTranslate}
          onChange={(e) => setAutoTranslate(e.target.checked)}
          id={toggleId}
        />
        <label htmlFor={toggleId}>
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
        {showCount && (
          <span
            className={'chat-char-count' + (overLimit ? ' is-over' : '')}
            data-testid="chat-char-count"
          >
            {charCount}/{charLimit}
          </span>
        )}
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
