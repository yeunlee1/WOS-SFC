// 채팅 입력창 공통 로직 — IME 조합 보호, 코드 포인트 글자 수 제한, 전송 실패 노출을 ChatTab/ChatDock가 공유한다.
import { useRef, useState } from 'react';
import { getSocket } from '../../api';
import { useI18n } from '../../i18n';

// 서버 ack 대기 상한. 정상 RTT는 50~300ms이므로 이 시간을 넘기면 전송 실패로 본다.
// ack가 영영 오지 않을 때 입력창이 잠기지 않도록 반드시 필요하다
// (clockSync.js의 WS_PING_TIMEOUT_MS와 같은 이유·같은 방식).
export const CHAT_ACK_TIMEOUT_MS = 5_000;

// 서버(chat.gateway)와 같은 상한·같은 계수 — UTF-16 길이가 아니라 코드 포인트 수 (감사 A-A2).
export const CHAT_MAX_CHARS = 500;
// 글자 수 표시를 시작하는 지점.
export const CHAT_COUNT_SHOW_FROM = 450;

export function countChars(text) {
  return Array.from(text ?? '').length;
}

const SEND_ERROR_KEYS = {
  offline: 'chatSendOffline',
  rate_limit: 'chatSendRateLimit',
  invalid: 'chatSendInvalid',
  failed: 'chatSendFailed',
};

export function useChatComposer() {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorReason, setErrorReason] = useState(null);
  // IME 조합 상태. isComposing을 못 채워 주는 브라우저를 대비한 이중 방어다.
  const composingRef = useRef(false);
  // 늦게 도착한 ack가 최신 전송 상태를 덮어쓰지 못하게 하는 순번.
  const sendTokenRef = useRef(0);

  const charCount = countChars(input);
  const overLimit = charCount > CHAT_MAX_CHARS;

  function sendMessage() {
    if (sending) return;
    const raw = input;
    const content = raw.trim();
    if (!content) return;
    // 서버가 invalid로 거절할 것을 알면서 보내지 않는다.
    if (countChars(content) > CHAT_MAX_CHARS) {
      setErrorReason('invalid');
      return;
    }

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
    errorText: errorReason
      ? t(SEND_ERROR_KEYS[errorReason] || SEND_ERROR_KEYS.failed)
      : null,
    charCount,
    charLimit: CHAT_MAX_CHARS,
    showCount: charCount >= CHAT_COUNT_SHOW_FROM,
    overLimit,
    sendMessage,
    handleChange,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
  };
}
