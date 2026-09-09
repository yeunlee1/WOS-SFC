// 채팅 목록 자동 스크롤 — 바닥 여부는 마지막 스크롤 이벤트 시점에 ref로 기록해 두고(B-7), 바닥이 아니면 새 메시지 배지를 센다.
import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 60;

// messages가 늘거나 contentKey(번역 맵 등 높이를 바꾸는 값)가 바뀌면 바닥에 있던 사용자만 따라간다.
export function useAutoScroll(messages, contentKey) {
  const containerRef = useRef(null);
  const atBottomRef = useRef(true);
  const seenCountRef = useRef(Array.isArray(messages) ? messages.length : 0);
  const [newCount, setNewCount] = useState(0);

  // 새 메시지 추종은 즉시(auto) 이동한다 — smooth면 애니메이션 중 스크롤 이벤트가
  // "바닥 아님"으로 잰 값을 남겨 다음 메시지를 놓친다. 배지 클릭만 smooth.
  const scrollToBottom = useCallback((behavior = 'auto') => {
    const el = containerRef.current;
    if (el) {
      const top = el.scrollHeight;
      if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior });
      else el.scrollTop = top;
    }
    atBottomRef.current = true;
    setNewCount(0);
  }, []);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
    atBottomRef.current = atBottom;
    if (atBottom) setNewCount(0);
  }, []);

  useEffect(() => {
    const count = Array.isArray(messages) ? messages.length : 0;
    const added = Math.max(0, count - seenCountRef.current);
    seenCountRef.current = count;
    if (atBottomRef.current) scrollToBottom();
    else if (added > 0) setNewCount((n) => n + added);
  }, [messages, contentKey, scrollToBottom]);

  return { containerRef, onScroll, newCount, scrollToBottom };
}
