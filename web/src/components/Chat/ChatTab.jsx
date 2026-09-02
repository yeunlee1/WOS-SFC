import { useState, useEffect, useRef, memo } from 'react';
import { useStore, ALLIANCES } from '../../store';
import { useI18n } from '../../i18n';
import { CHAT_SEND_ERROR_STYLE, useChatComposer } from './useChatComposer';

// 5-동맹 pill 색상 — store ALLIANCES 순서와 일치
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

// ChatTab — 실시간 채팅 탭 (풀페이지 모드)
export default function ChatTab() {
  const { t, lang } = useI18n();
  const user = useStore((s) => s.user);

  // Critical #1: onlineUsers를 store에서 직접 읽음 (로컬 state + chat:online 구독 제거)
  const onlineUsersRaw = useStore((s) => s.onlineUsers);
  // 같은 유저의 다중 탭/소켓은 1개로 집계
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

  // 자동 스크롤 — messages 변경 시 (사용자가 하단에 있을 때만)
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
        <div className="chat-tab-messages" ref={messagesContainerRef}>
          {messages.map((msg, idx) => {
            if (msg._type === 'system') {
              return (
                <div key={msg._id ?? idx} className="chat-tab-system-msg">
                  — {msg.text} —
                </div>
              );
            }
            return (
              <ChatMessage
                key={msg.id ?? msg._id ?? idx}
                msg={msg}
                autoTranslate={autoTranslate}
                translationLanguage={lang}
              />
            );
          })}
          <div ref={messagesEndRef} />
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

// ── 개별 채팅 메시지 컴포넌트 ──
const localeMap = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' };

const ChatMessage = memo(function ChatMessage({
  msg,
  autoTranslate,
  translationLanguage,
}) {
  const { t, lang } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);

  // createdAt 방어 처리 — locale-aware 시간 형식
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

  // autoTranslate 꺼지면 항상 원문 표시
  const displayContent =
    autoTranslate && hasTranslation && !showOriginal
      ? msg.translatedContent
      : msg.content;

  const initials = (msg.nickname || '??').slice(0, 2).toUpperCase();
  const avatarColor = getAllianceColor(msg.allianceName);

  return (
    <div className="chat-tab-msg">
      <div className="chat-tab-msg-avatar" style={{ background: avatarColor }}>
        {initials}
      </div>
      <div className="chat-tab-msg-body">
        <div className="chat-tab-msg-head">
          <span className="chat-tab-msg-nick">{msg.nickname}</span>
          {msg.allianceName && (
            <span
              className="chat-tab-msg-alliance"
              style={{ color: avatarColor }}
            >
              [{msg.allianceName}]
            </span>
          )}
          <span className="chat-tab-msg-time">{time}</span>
        </div>
        <p className="chat-tab-msg-text">{displayContent}</p>
        {autoTranslate && hasTranslation && (
          <span
            className="chat-tab-toggle-original"
            onClick={() => setShowOriginal((v) => !v)}
          >
            {showOriginal ? t('viewTranslation') : t('viewOriginal')}
          </span>
        )}
      </div>
    </div>
  );
});
