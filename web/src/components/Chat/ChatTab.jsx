import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { getSocket, translateChatMessage } from '../../api';

// ChatTab — 실시간 채팅 탭
export default function ChatTab() {
  const { t } = useI18n();
  const user = useStore((s) => s.user);
  const myLang = user?.language;

  // Critical #1: onlineUsers를 store에서 직접 읽음 (로컬 state + chat:online 구독 제거)
  const onlineUsers = useStore((s) => s.onlineUsers);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  const messagesEndRef = useRef(null);

  // Important #2: myLang 변경이 소켓 재구독을 유발하지 않도록 ref로 관리
  const myLangRef = useRef(myLang);
  useEffect(() => {
    myLangRef.current = myLang;
  }, [myLang]);

  // 자동 스크롤 — messages 변경 시
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 소켓 이벤트 구독 — 마운트 시 1회만 실행 (deps: [])
  useEffect(() => {
    let cancelled = false; // Important #3: unmount 후 setMessages 방지

    const socket = getSocket();
    if (!socket) return;

    // 채팅 기록 수신 — 번역 일괄 적용
    async function handleHistory(msgs) {
      const translated = await Promise.all(
        msgs.map((msg) => translateChatMessage(msg, myLangRef.current))
      );
      if (!cancelled) setMessages(translated);
    }

    // 새 메시지 수신 — 번역 후 append
    async function handleMessage(msg) {
      const translated = await translateChatMessage(msg, myLangRef.current);
      if (!cancelled) setMessages((prev) => [...prev, translated]);
    }

    // 시스템 메시지 수신
    function handleSystem(text) {
      if (!cancelled) setMessages((prev) => [...prev, { _type: 'system', text, _id: Date.now() }]);
    }

    socket.on('chat:history', handleHistory);
    socket.on('chat:message', handleMessage);
    socket.on('chat:system', handleSystem);

    // 언마운트 시 리스너 정리
    return () => {
      cancelled = true;
      socket.off('chat:history', handleHistory);
      socket.off('chat:message', handleMessage);
      socket.off('chat:system', handleSystem);
    };
  }, []); // deps: [] — myLang 변경 시 재구독 없음

  // 메시지 전송 — 소켓으로 직접 emit
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
    <div className="chat-layout">
      {/* 온라인 유저 바 */}
      <div className="chat-header">
        <span className="chat-online-badge">{onlineUsers.length} online</span>
        <div className="chat-online-list">
          {onlineUsers.map((u) => (
            <span key={u.nickname ?? u} className="chat-online-user">
              {u.nickname ?? u}
            </span>
          ))}
        </div>
      </div>

      {/* 메시지 목록 */}
      <div className="chat-messages">
        {messages.map((msg, idx) => {
          if (msg._type === 'system') {
            return (
              <p key={msg._id ?? idx} className="chat-system-msg">
                {msg.text}
              </p>
            );
          }
          return (
            <ChatMessage
              key={msg._id ?? idx}
              msg={msg}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <div className="chat-input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chatPlaceholder')}
        />
        <button className="btn btn-primary" onClick={sendMessage}>
          {t('chatSend')}
        </button>
      </div>
    </div>
  );
}

// ── 개별 채팅 메시지 컴포넌트 ──
// Minor #4: t를 prop으로 받는 대신 useI18n() 직접 호출 (코드베이스 패턴 준수)
function ChatMessage({ msg }) {
  const { t } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);

  // Minor #5: createdAt 방어 처리
  const time = msg.createdAt
    ? new Date(msg.createdAt).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const hasTranslation =
    msg.translatedContent && msg.translatedContent !== msg.content;

  // 원문/번역 토글
  const displayContent = hasTranslation && !showOriginal
    ? msg.translatedContent
    : msg.content;

  return (
    <div className="chat-message">
      <span className="chat-alliance">[{msg.allianceName}]</span>
      <span className="chat-nickname">{msg.nickname}</span>
      <span className="chat-time">{time}</span>
      <p className="chat-content">{displayContent}</p>
      {hasTranslation && (
        <span
          className="chat-toggle-original"
          onClick={() => setShowOriginal((v) => !v)}
        >
          {showOriginal ? t('viewTranslation') : t('viewOriginal')}
        </span>
      )}
    </div>
  );
}
