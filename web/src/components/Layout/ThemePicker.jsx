import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';

// 테마 메타: 레이블 + 대표 컬러 (미리보기 점 2개로 표시)
const THEME_META = [
  { id: 'spring',    label: '🌸 Spring',    dot1: '#f9a8d4', dot2: '#d946a8' },
  { id: 'anthropic', label: '🕯️ Anthropic', dot1: '#faf9f5', dot2: '#d97757' },
  { id: 'dark',      label: '🌙 Dark',      dot1: '#1c1d22', dot2: '#818cf8' },
];

export default function ThemePicker() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // 바깥 클릭 시 닫기
  //
  // mousedown 대신 click 사용 이유:
  // - mousedown은 option의 onClick보다 먼저 발생 → 옵션 클릭 시점에 ref가 stale일 수 있음
  // - click은 mouseup 후 버블링되므로 onClick이 먼저 실행되고 setOpen(false) 후 동작
  //
  // wrapRef.current.contains 대신 e.target.closest 사용 이유:
  // - React StrictMode/재렌더로 ref가 일시적으로 stale일 때도 DOM 트리를 올라가며 확실히 체크
  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (!e.target.closest('.theme-picker')) setOpen(false);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  const current = THEME_META.find((m) => m.id === theme) || THEME_META[0];

  return (
    <div className="theme-picker" ref={wrapRef}>
      <button
        type="button"
        className="theme-picker__trigger"
        onClick={(e) => {
          // 트리거 click이 document 리스너까지 버블링되어 방금 연 메뉴를
          // 다시 닫는 것을 막음 (리스너는 onClick과 같은 click 단계에서 동작)
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="테마 변경"
      >
        <span className="theme-picker__dot" style={{ background: current.dot1 }} />
        <span className="theme-picker__dot" style={{ background: current.dot2 }} />
        <span className="theme-picker__label">{current.label}</span>
        <span className="theme-picker__chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <ul className="theme-picker__menu" role="listbox">
          {THEME_META.map((m) => (
            <li
              key={m.id}
              role="option"
              aria-selected={m.id === theme}
              className={`theme-picker__option${m.id === theme ? ' is-active' : ''}`}
              onClick={() => { setTheme(m.id); setOpen(false); }}
            >
              <span className="theme-picker__dot" style={{ background: m.dot1 }} />
              <span className="theme-picker__dot" style={{ background: m.dot2 }} />
              <span className="theme-picker__label">{m.label}</span>
              {m.id === theme && <span className="theme-picker__check">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
