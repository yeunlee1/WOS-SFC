import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 드래그로 패널 크기를 조절하는 훅.
 * @param {string} storageKey  localStorage 저장 키
 * @param {number} defaultSize 기본 크기(px)
 * @param {{ min, max, direction }} opts
 *   direction: 'horizontal' (좌우 핸들) | 'vertical' (상하 핸들)
 *   horizontal 방향에서 핸들이 오른쪽 패널 왼쪽에 붙어 있을 경우, 왼쪽으로 드래그할수록 패널이 커짐
 */
export function useResizable(storageKey, defaultSize, { min = 100, max = 600, direction = 'horizontal' } = {}) {
  const [size, setSize] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? parseInt(saved, 10) : defaultSize;
  });

  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const handleMouseDown = useCallback((e) => {
    dragging.current = true;
    startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startSize.current = size;
    e.preventDefault();
  }, [size, direction]);

  useEffect(() => {
    function onMove(e) {
      if (!dragging.current) return;
      const clientPos = direction === 'horizontal' ? e.clientX : e.clientY;
      // 수평: 핸들이 사이드바 왼쪽 → 왼쪽으로 당길수록(clientX 감소) 사이드바 커짐
      const delta = direction === 'horizontal'
        ? startPos.current - clientPos
        : clientPos - startPos.current;
      const next = Math.min(max, Math.max(min, startSize.current + delta));
      setSize(next);
    }

    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setSize((prev) => {
        localStorage.setItem(storageKey, String(prev));
        return prev;
      });
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [storageKey, min, max, direction]);

  return { size, handleMouseDown };
}
