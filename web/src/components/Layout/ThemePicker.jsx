import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';

// 테마 메타: 레이블 + 대표 컬러 (미리보기 점 2개로 표시)
const THEME_META = [
  { id: 'spring',    label: '🌸 Spring',    dot1: '#f9a8d4', dot2: '#d946a8' },
  { id: 'anthropic', label: '🕯️ Anthropic', dot1: '#faf9f5', dot2: '#d97757' },
  { id: 'dark',      label: '🌙 Dark',      dot1: '#1c1d22', dot2: '#818cf8' },
];

/**
 * 테마 선택기 (WAI-ARIA listbox 패턴).
 *
 * 접근성:
 *  - trigger: aria-haspopup="listbox", aria-expanded, aria-label에 현재 값
 *  - menu:    role="listbox", aria-hidden(닫힘 시), aria-activedescendant
 *  - option:  role="option", aria-selected, roving tabindex (focused만 0)
 *
 * 키보드:
 *  - trigger: Enter/Space/ArrowDown → open (현재 선택 항목 포커스)
 *  - menu:    ArrowUp/Down wrap, Home/End, Enter/Space 선택, Escape 닫고 trigger로 복귀,
 *             Tab 닫기 + 기본 이동 허용
 *
 * DOM 수명:
 *  - 메뉴는 open/close 모두 항상 마운트 → CSS `.is-open` 전환(fade+scale) 가능.
 *  - 대신 aria-hidden + tabIndex=-1 로 비공개 상태 유지.
 *    (hidden 속성은 display:none을 유도해 transition을 죽이므로 사용 안 함.)
 */
export default function ThemePicker() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);

  const triggerRef = useRef(null);
  const optionRefs = useRef([]);

  const currentIndex = Math.max(0, THEME_META.findIndex((m) => m.id === theme));
  const current = THEME_META[currentIndex];

  // 바깥 클릭 시 닫기.
  // mousedown 대신 click — 옵션의 onClick보다 먼저 발생해 ref가 stale해지는 문제 회피.
  // wrapRef.contains 대신 e.target.closest — StrictMode/재렌더로 ref가 일시 stale인 상황 방어.
  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (!e.target.closest('.theme-picker')) setOpen(false);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  // Open 시: 현재 선택 항목에 포커스 (키보드 사용자용).
  // requestAnimationFrame으로 CSS `.is-open` 전환이 적용된 다음 프레임에 focus — pointer-events:auto 전환 후.
  useEffect(() => {
    if (!open) return;
    setFocusIndex(currentIndex);
    const raf = requestAnimationFrame(() => {
      optionRefs.current[currentIndex]?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, currentIndex]);

  // 키보드로 닫을 때는 trigger로 포커스 복귀 (WAI-ARIA 권장).
  // 마우스 outside-click 닫힘은 포커스 이동 의도가 이미 있었을 것이므로 복귀하지 않는다.
  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const selectAt = useCallback((idx) => {
    const target = THEME_META[idx];
    if (!target) return;
    setTheme(target.id);
    closeAndRestoreFocus();
  }, [setTheme, closeAndRestoreFocus]);

  // 메뉴 내 키보드 네비게이션
  const onMenuKeyDown = useCallback((e) => {
    const last = THEME_META.length - 1;
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = focusIndex >= last ? 0 : focusIndex + 1;
        setFocusIndex(next);
        optionRefs.current[next]?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = focusIndex <= 0 ? last : focusIndex - 1;
        setFocusIndex(prev);
        optionRefs.current[prev]?.focus();
        break;
      }
      case 'Home':
        e.preventDefault();
        setFocusIndex(0);
        optionRefs.current[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        setFocusIndex(last);
        optionRefs.current[last]?.focus();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusIndex >= 0) selectAt(focusIndex);
        break;
      case 'Escape':
        e.preventDefault();
        closeAndRestoreFocus();
        break;
      case 'Tab':
        // Tab 기본 이동은 허용, 메뉴만 닫는다 (사용자가 폼 흐름을 이어갈 수 있게).
        setOpen(false);
        break;
      default:
        break;
    }
  }, [focusIndex, selectAt, closeAndRestoreFocus]);

  // 트리거 키보드: 닫힌 상태에서 Enter/Space/ArrowDown이면 열고, 열린 상태에서 Esc면 닫기.
  // (click은 별도 onClick에서 처리되므로 key-up된 click은 브라우저가 활성화.)
  const onTriggerKeyDown = useCallback((e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
    } else if (open && e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }, [open]);

  return (
    <div className="theme-picker">
      <button
        ref={triggerRef}
        type="button"
        className="theme-picker__trigger"
        onClick={(e) => {
          // 트리거 click이 document 리스너까지 버블링되어 방금 연 메뉴를
          // 다시 닫는 것을 막음 (리스너는 onClick과 같은 click 단계에서 동작).
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`테마 변경 — 현재 ${current.label}`}
        title="테마 변경"
      >
        <span className="theme-picker__dot" style={{ background: current.dot1 }} aria-hidden />
        <span className="theme-picker__dot" style={{ background: current.dot2 }} aria-hidden />
        <span className="theme-picker__label">{current.label}</span>
        <span className="theme-picker__chevron" aria-hidden>▾</span>
      </button>

      <ul
        className={`theme-picker__menu${open ? ' is-open' : ''}`}
        role="listbox"
        aria-label="테마 선택"
        aria-hidden={!open}
        aria-activedescendant={open && focusIndex >= 0 ? `theme-opt-${THEME_META[focusIndex]?.id}` : undefined}
        onKeyDown={onMenuKeyDown}
      >
        {THEME_META.map((m, i) => {
          const active = m.id === theme;
          const focused = i === focusIndex;
          return (
            <li
              key={m.id}
              id={`theme-opt-${m.id}`}
              ref={(el) => (optionRefs.current[i] = el)}
              role="option"
              // roving tabindex: 열려 있을 때 focused 옵션만 tab 타겟.
              // 닫혀 있으면 모두 -1 → 스크린리더/키보드 접근 불가.
              tabIndex={open && focused ? 0 : -1}
              aria-selected={active}
              className={
                'theme-picker__option' +
                (active ? ' is-active' : '') +
                (focused ? ' is-focused' : '')
              }
              onClick={() => selectAt(i)}
              onMouseEnter={() => setFocusIndex(i)}
            >
              <span className="theme-picker__dot" style={{ background: m.dot1 }} aria-hidden />
              <span className="theme-picker__dot" style={{ background: m.dot2 }} aria-hidden />
              <span className="theme-picker__label">{m.label}</span>
              {active && <span className="theme-picker__check" aria-hidden>✓</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
