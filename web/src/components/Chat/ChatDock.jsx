import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { getSocket, translateChatMessage } from '../../api';

// 5-동맹 pill 색상
const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#ec4899',
};

function getAllianceColor(alliance) {
  return ALLIANCE_COLORS[alliance] || '#64748b';
}

// ChatDock — 우측 슬라이딩 도크 (채팅 탭 외 다른 탭에서 표시)
// Props:
//   onClose: () => void  — 닫기 버튼 핸들러
export default function ChatDock({ onClose }) {
  const { t } = useI18n();
  const user = useStore((s) => s.user);
  const myLang = user?.language;

  // onlineUsers store에서 직접 읽기 (중복 소켓 집계)
  const onlineUsersRaw = useStore((s) => s.onlineUsers);
  const onlineUsers = Array.from(
    new Map(onlineUsersRaw.map((u) => [u.nickname ?? u, u])).values(),
  );

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  // 자동번역 토글 — ChatTab과 동일한 localStorage 키 공유
  const [autoTranslate, setAutoTranslate] = useState(() => {
    try { return localStorage.getItem('wos-chat-auto-translate') !== '0'; }
    catch { return true; }
  });

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const myLangRef = useRef(myLang);

  useEffect(() => {
    myLangRef.current = myLang;
  }, [myLang]);

  // 자동 스크롤 — 하단에 있을 때만
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // autoTranslate localStorage 동기화
  useEffect(() => {
    try { localStorage.setItem('wos-chat-auto-translate', autoTranslate ? '1' : '0'); }
    catch { /* 무시 */ }
  }, [autoTranslate]);

  // 소켓 이벤트 구독 — 마운트 시 1회
  useEffect(() => {
    let cancelled = false;

    const socket = getSocket();
    if (!socket) return;

    async function handleHistory(msgs) {
      const translated = await Promise.all(
        msgs.map((msg) => translateChatMessage(msg, myLangRef.current))
      );
      if (!cancelled) setMessages(translated);
    }

    async function handleMessage(msg) {
      const translated = await translateChatMessage(msg, myLangRef.current);
      if (!cancelled) setMessages((prev) => [...prev, translated]);
    }

    function handleSystem(text) {
      if (!cancelled) setMessages((prev) => [...prev, { _type: 'system', text, _id: Date.now() }]);
    }

    socket.on('chat:history', handleHistory);
    socket.on('chat:message', handleMessage);
    socket.on('chat:system', handleSystem);

    return () => {
      cancelled = true;
      socket.off('chat:history', handleHistory);
      socket.off('chat:message', handleMessage);
      socket.off('chat:system', handleSystem);
    };
  }, []); // deps: [] — myLang 변경 시 재구독 없음

  // 메시지 전송
  function sendMessage() {
    const content = input.trim();
    if (!content) return;
    const socket = getSocket();
    if (!socket) return;
    setInput('');
    socket.emit('chat:message', content);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <aside className="chat-dock">
      {/* 도크 헤더 */}
      <div className="chat-dock-head">
        <span className="chat-dock-title">// {t('chatDockTitle') || 'CHAT'}</span>
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
      <div className="chat-msgs" ref={messagesContainerRef}>
        {messages.map((msg, idx) => {
          if (msg._type === 'system') {
            return (
              <div key={msg._id ?? idx} className="chat-system">
                — {msg.text} —
              </div>
            );
          }
          return (
            <DockMessage
              key={msg._id ?? idx}
              msg={msg}
              autoTranslate={autoTranslate}
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
          {(t('viewTranslation') || 'AUTO-TRANSLATE').toUpperCase()}
        </label>
      </div>

      {/* 입력 영역 */}
      <div className="chat-input-row">
        <input
          className="input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chatPlaceholder')}
        />
        <button className="btn-primary" onClick={sendMessage}>▶</button>
      </div>
    </aside>
  );
}

// ── 도크 개별 메시지 컴포넌트 ──
function DockMessage({ msg, autoTranslate }) {
  const { t } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);

  const time = msg.createdAt
    ? new Date(msg.createdAt).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const hasTranslation =
    msg.translatedContent && msg.translatedContent !== msg.content;

  const displayContent =
    autoTranslate && hasTranslation && !showOriginal
      ? msg.translatedContent
      : msg.content;

  const initials = (msg.nickname || '??').slice(0, 2).toUpperCase();
  const avatarColor = getAllianceColor(msg.allianceName);

  return (
    <div className="chat-msg">
      <div className="chat-msg-avatar" style={{ background: avatarColor }}>
        {initials}
      </div>
      <div className="chat-msg-body">
        <div className="chat-msg-head">
          <span className="chat-msg-nick">{msg.nickname}</span>
          <span className="chat-msg-time">{time}</span>
        </div>
        <p className="chat-msg-text">{displayContent}</p>
        {autoTranslate && hasTranslation && (
          <div
            className="chat-msg-tr"
            style={{ cursor: 'pointer' }}
            onClick={() => setShowOriginal((v) => !v)}
          >
            {showOriginal ? t('viewTranslation') : t('viewOriginal')}
          </div>
        )}
      </div>
    </div>
  );
}
