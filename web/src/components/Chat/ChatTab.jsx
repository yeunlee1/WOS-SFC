import { useState, useEffect, useRef } from 'react';
import { useStore, ALLIANCES } from '../../store';
import { useI18n } from '../../i18n';
import { getSocket, translateChatMessage } from '../../api';

// 5-동맹 pill 색상 — store ALLIANCES 순서와 일치
const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#ec4899',
};

function getAllianceColor(alliance) {
  return ALLIANCE_COLORS[alliance] || '#64748b';
}

// ChatTab — 실시간 채팅 탭 (풀페이지 모드)
export default function ChatTab() {
  const { t } = useI18n();
  const user = useStore((s) => s.user);
  const myLang = user?.language;

  // Critical #1: onlineUsers를 store에서 직접 읽음 (로컬 state + chat:online 구독 제거)
  const onlineUsersRaw = useStore((s) => s.onlineUsers);
  // 같은 유저의 다중 탭/소켓은 1개로 집계
  const onlineUsers = Array.from(
    new Map(onlineUsersRaw.map((u) => [u.nickname ?? u, u])).values(),
  );

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  // 자동번역 토글 — localStorage 지속
  const [autoTranslate, setAutoTranslate] = useState(() => {
    try { return localStorage.getItem('wos-chat-auto-translate') !== '0'; }
    catch { return true; }
  });

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  // Important #2: myLang 변경이 소켓 재구독을 유발하지 않도록 ref로 관리
  const myLangRef = useRef(myLang);
  useEffect(() => {
    myLangRef.current = myLang;
  }, [myLang]);

  // 자동 스크롤 — messages 변경 시 (사용자가 하단에 있을 때만)
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
          <span className="chat-online-pill">{onlineUsers.length} {t('onlineUsers') || 'online'}</span>
          <span className="chat-tab-spacer" />
          <label className="chat-autotranslate-toggle">
            <input
              type="checkbox"
              checked={autoTranslate}
              onChange={(e) => setAutoTranslate(e.target.checked)}
            />
            <span>{t('viewTranslation') || 'Auto-translate'}</span>
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
                key={msg._id ?? idx}
                msg={msg}
                autoTranslate={autoTranslate}
              />
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* 입력 영역 */}
        <div className="chat-tab-input-row">
          <input
            className="chat-tab-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chatPlaceholder')}
          />
          <button className="btn btn-primary chat-tab-send-btn" onClick={sendMessage}>
            ▶
          </button>
        </div>
      </div>

      {/* 오른쪽: 동맹별 온라인 사이드바 */}
      <div className="chat-tab-sidebar">
        <div className="chat-tab-sidebar-header">
          <span className="chat-tab-sidebar-title">ONLINE · {onlineUsers.length}</span>
        </div>
        <div className="chat-tab-sidebar-body">
          {groups.length === 0 ? (
            <span className="chat-tab-sidebar-empty">접속자 없음</span>
          ) : (
            groups.map(({ alliance, users }) => (
              <div key={alliance} className="chat-tab-alliance-group">
                <div className="chat-tab-alliance-label">
                  <span
                    className="chat-tab-alliance-dot"
                    style={{ background: getAllianceColor(alliance) }}
                  />
                  <span className="chat-tab-alliance-name">{alliance}</span>
                  <span className="chat-tab-alliance-count">{users.length}</span>
                </div>
                {users.map((u) => (
                  <div key={u.nickname} className="chat-tab-user-row">
                    <span
                      className="chat-tab-user-dot"
                    />
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
function ChatMessage({ msg, autoTranslate }) {
  const { t } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);

  // createdAt 방어 처리
  const time = msg.createdAt
    ? new Date(msg.createdAt).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const hasTranslation =
    msg.translatedContent && msg.translatedContent !== msg.content;

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
}
