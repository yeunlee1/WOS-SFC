// 위로 스크롤해 화면에 들어온 옛 메시지 id를 모아 번역 동기화 모듈에 넘긴다 (설계 3.5 — 히스토리 최신 50건 밖은 스크롤 때 요청).
import { useCallback, useEffect, useRef } from 'react';
import { requestOlderTranslations } from '../../chat/translationSync';

const THROTTLE_MS = 300;

// 컨테이너 안의 [data-msg-id] 요소 중 보이는 것만 고른다. IntersectionObserver 없이도 동작한다.
export function collectVisibleMessageIds(container) {
  if (!container) return [];
  const box = container.getBoundingClientRect();
  const ids = [];
  container.querySelectorAll('[data-msg-id]').forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.bottom < box.top || rect.top > box.bottom) return;
    const id = Number(node.getAttribute('data-msg-id'));
    if (Number.isFinite(id)) ids.push(id);
  });
  return ids;
}

export function useOlderTranslations(containerRef) {
  const timerRef = useRef(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  return useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const ids = collectVisibleMessageIds(containerRef.current);
      if (ids.length > 0) requestOlderTranslations(ids);
    }, THROTTLE_MS);
  }, [containerRef]);
}
