// 채팅 입력창 공통 로직 — IME 조합 보호와 전송 실패 노출을 ChatTab/ChatDock가 공유한다.
import { useRef, useState } from 'react';
import { getSocket } from '../../api';
import { useI18n } from '../../i18n';

// 서버 ack 대기 상한. 정상 RTT는 50~300ms이므로 이 시간을 넘기면 전송 실패로 본다.
// ack가 영영 오지 않을 때 입력창이 잠기지 않도록 반드시 필요하다
// (clockSync.js의 WS_PING_TIMEOUT_MS와 같은 이유·같은 방식).
export const CHAT_ACK_TIMEOUT_MS = 5_000;

// i18n/index.jsx는 이번 작업 범위 밖(다른 트랙 담당)이라 문구를 여기에 둔다.
// 4개 언어 키가 i18n에 추가되면 이 표를 지우고 t()로 옮긴다.
const SEND_ERROR_TEXT = {
  ko: {
    offline: '서버와 연결이 끊겼습니다. 재연결 후 다시 보내세요.',
    rate_limit: '너무 빠르게 보냈습니다. 잠시 후 다시 시도하세요.',
    invalid: '보낼 수 없는 메시지입니다 (최대 500자).',
    failed: '전송하지 못했습니다. 다시 시도하세요.',
  },
  en: {
    offline: 'Disconnected from the server. Try again once reconnected.',
    rate_limit: 'Sending too fast. Please wait a moment.',
    invalid: 'Message cannot be sent (max 500 characters).',
    failed: 'Failed to send. Please try again.',
  },
  ja: {
    offline: 'サーバーとの接続が切れました。再接続後に送信してください。',
    rate_limit: '送信が速すぎます。少し待ってから再試行してください。',
    invalid: '送信できないメッセージです（最大500文字）。',
    failed: '送信できませんでした。もう一度お試しください。',
  },
  zh: {
    offline: '与服务器的连接已断开，重新连接后再发送。',
    rate_limit: '发送过快，请稍后再试。',
    invalid: '无法发送该消息（最多500字）。',
    failed: '发送失败，请重试。',
  },
};

function sendErrorText(lang, reason) {
  const table = SEND_ERROR_TEXT[lang] || SEND_ERROR_TEXT.ko;
  return table[reason] || table.failed;
}

export function useChatComposer() {
  const { lang } = useI18n();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorReason, setErrorReason] = useState(null);
  // IME 조합 상태. isComposing을 못 채워 주는 브라우저를 대비한 이중 방어다.
  const composingRef = useRef(false);
  // 늦게 도착한 ack가 최신 전송 상태를 덮어쓰지 못하게 하는 순번.
  const sendTokenRef = useRef(0);

  function sendMessage() {
    if (sending) return;
    const raw = input;
    const content = raw.trim();
    if (!content) return;

    const socket = getSocket();
    if (!socket) {
      // 조용히 버리지 않는다 — 사용자가 보냈다고 믿게 두는 것이 가장 나쁘다.
      setErrorReason('offline');
      return;
    }

    const token = (sendTokenRef.current += 1);
    setSending(true);
    setErrorReason(null);

    // ack 계약은 저장소 선례와 같다 — 콜백 인자는 서버 반환값 하나뿐이고
    // 타임아웃은 여기서 직접 잡는다.
    //   clockSync.js:100  sock.emit('time:ping', null, (res) => ...)
    //   Countdown.jsx:239 getSocket()?.emit('countdown:start', s, (ack) => ...)
    let settled = false;
    function finish(reason) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (sendTokenRef.current !== token) return;
      setSending(false);
      if (reason) {
        setErrorReason(reason);
        return;
      }
      setErrorReason(null);
      // 성공했을 때만 입력창을 비운다. 그 사이 사용자가 더 입력했으면 건드리지 않는다.
      setInput((current) => (current === raw ? '' : current));
    }

    const timer = setTimeout(() => finish('failed'), CHAT_ACK_TIMEOUT_MS);
    try {
      socket.emit('chat:message', content, (ack) => {
        finish(ack?.ok ? null : ack?.reason || 'failed');
      });
    } catch {
      finish('failed');
    }
  }

  function handleChange(event) {
    setInput(event.target.value);
    if (errorReason) setErrorReason(null);
  }

  function handleKeyDown(event) {
    // IME 조합 중의 Enter는 후보 확정용이다. 여기서 전송하면 ja/zh/ko 입력이 잘려 나간다.
    if (
      composingRef.current ||
      event.nativeEvent?.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function handleCompositionStart() {
    composingRef.current = true;
  }

  function handleCompositionEnd() {
    composingRef.current = false;
  }

  return {
    input,
    sending,
    errorText: errorReason ? sendErrorText(lang, errorReason) : null,
    sendMessage,
    handleChange,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
  };
}

// 실패 안내 줄 — style.css는 이번 작업 범위 밖이라 최소 인라인 스타일만 쓴다.
export const CHAT_SEND_ERROR_STYLE = {
  color: '#f87171',
  fontSize: '0.8rem',
  lineHeight: 1.4,
  padding: '0.25rem 0.5rem',
};
