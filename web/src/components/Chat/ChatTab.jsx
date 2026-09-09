// ChatTab — 실시간 채팅 탭(풀페이지). 메시지 항목은 ChatMessageItem, 번역은 store의 chatTranslations 맵에서 읽는다.
import { useStore, ALLIANCES, getAllianceColor } from '../../store';
import { useI18n } from '../../i18n';
import { retryTranslation } from '../../chat/translationSync';
import { useChatComposer } from './useChatComposer';
import { useAutoScroll } from './useAutoScroll';
import { useOlderTranslations } from './useOlderTranslations';
import ChatMessageItem from './ChatMessageItem';

export default function ChatTab() {
  const { t, lang } = useI18n();
  const user = useStore((s) => s.user);

  // onlineUsers를 store에서 직접 읽음 — 같은 유저의 다중 탭/소켓은 1개로 집계
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

  // 동맹별 온라인 그룹
  const groups = ALLIANCES.map((alliance) => {
    const users = onlineUsers.filter((u) => u.alliance === alliance);
    return { alliance, users };
  }).filter((g) => g.users.length > 0);

  return (
    <div className="chat-tab-layout">
      {/* 왼쪽: 메인 채팅 패널 */}
      <div className="chat-tab-main">
        {/* 채팅 헤더 — 채널명 + 온라인 pill + 자동번역 토글 */}
        <div className="chat-tab-topbar">
          <span className="chat-tab-channel"># GENERAL</span>
          <span className="chat-online-pill">
            {onlineUsers.length} {t('onlineUsers') || 'online'}
          </span>
          <span className="chat-tab-spacer" />
          <label className="chat-autotranslate-toggle">
            <input
              type="checkbox"
              checked={autoTranslate}
              onChange={(e) => setAutoTranslate(e.target.checked)}
            />
            <span>{t('autoTranslate') || 'Auto-translate'}</span>
          </label>
        </div>

        {/* 메시지 목록 */}
        <div
          className="chat-tab-messages"
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
              variant="tab"
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
        <div className="chat-tab-input-row">
          <input
            className="chat-tab-input"
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
            className="btn btn-primary chat-tab-send-btn"
            onClick={sendMessage}
            disabled={sending}
            aria-label={t('chatSend')}
          >
            ▶
          </button>
        </div>
      </div>

      {/* 오른쪽: 동맹별 온라인 사이드바 */}
      <div className="chat-tab-sidebar">
        <div className="chat-tab-sidebar-header">
          <span className="chat-tab-sidebar-title">
            ONLINE · {onlineUsers.length}
          </span>
        </div>
        <div className="chat-tab-sidebar-body">
          {groups.length === 0 ? (
            <span className="chat-tab-sidebar-empty">{t('noOnlineUsers')}</span>
          ) : (
            groups.map(({ alliance, users }) => (
              <div key={alliance} className="chat-tab-alliance-group">
                <div className="chat-tab-alliance-label">
                  <span
                    className="chat-tab-alliance-dot"
                    style={{ background: getAllianceColor(alliance) }}
                  />
                  <span className="chat-tab-alliance-name">{alliance}</span>
                  <span className="chat-tab-alliance-count">
                    {users.length}
                  </span>
                </div>
                {users.map((u) => (
                  <div key={u.nickname} className="chat-tab-user-row">
                    <span className="chat-tab-user-dot" />
                    <span className="chat-tab-user-nick">{u.nickname}</span>
                    {u.nickname === user?.nickname && (
                      <span className="chat-tab-user-you">YOU</span>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
