import { useState, useEffect, useRef } from 'react';
import { useStore, THEMES } from '../../store';
import { useI18n, SUPPORTED_LANGS } from '../../i18n';
import { api, disconnectSocket } from '../../api';
import { stopAllTts } from '../Battle/tts';

const TAB_DEFS = [
  { id: 'battle',    icon: '⚔', i18nKey: 'tabBattle' },
  { id: 'community', icon: '◫', i18nKey: 'tabCommunity' },
  { id: 'chat',      icon: '✉', i18nKey: 'tabChat' },
];

const THEME_ICON = {
  frost: '🧊', spring: '🌸',
};
const THEME_LABEL = {
  frost: 'Frost', spring: 'Spring',
};

/**
 * CommandPalette — ⌘K / Ctrl+K 로 호출되는 전역 명령 팔레트.
 *
 * 명령 카탈로그:
 *  - 이동: 탭 전환 (battle/community/chat/admin)
 *  - 액션: 채팅 도크 토글, TTS 토글
 *  - 언어: ko/en/ja/zh 전환
 *  - 테마: frost/spring/anthropic/dark 전환
 *  - 세션: 로그아웃
 *
 * 키보드:
 *  - Esc: 닫기
 *  - ArrowUp/Down: 항목 이동
 *  - Enter: 실행 후 자동 닫기
 *
 * 부모(App.jsx)가 ⌘K 글로벌 핸들러로 open 토글을 관리한다.
 */
export default function CommandPalette({
  open,
  onClose,
  onTabChange,
  onToggleChatDock,
}) {
  const { t, changeLang } = useI18n();
  const user = useStore((s) => s.user);
  const setTheme = useStore((s) => s.setTheme);
  const ttsMuted = useStore((s) => s.ttsMuted);
  const setTtsMuted = useStore((s) => s.setTtsMuted);
  const clearUser = useStore((s) => s.clearUser);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  // ─── Build command catalog ───
  const tabs = [...TAB_DEFS];
  if (user?.role === 'developer') {
    tabs.push({ id: 'admin', icon: '★', i18nKey: 'tabAdmin' });
  }

  const tabCommands = tabs.map((tb) => ({
    id: 'goto-' + tb.id,
    section: t('cmdkSectionNavigate'),
    icon: tb.icon,
    label: t('cmdkGoToPrefix') + t(tb.i18nKey),
    run: () => onTabChange(tb.id),
  }));

  const actionCommands = [
    {
      id: 'toggle-chat',
      section: t('cmdkSectionActions'),
      icon: '✉',
      label: t('cmdkToggleChat'),
      shortcut: 'C',
      run: () => onToggleChatDock(),
    },
    {
      id: 'toggle-tts',
      section: t('cmdkSectionActions'),
      icon: ttsMuted ? '🔇' : '🔊',
      label: t('cmdkToggleTTS'),
      run: () => {
        const next = !ttsMuted;
        setTtsMuted(next);
        if (next) stopAllTts();
      },
    },
  ];

  const langCommands = SUPPORTED_LANGS.map((l) => ({
    id: 'lang-' + l.code,
    section: t('cmdkSectionLanguage'),
    icon: l.flag,
    label: l.label,
    run: () => changeLang(l.code),
  }));

  const themeCommands = THEMES.map((th) => ({
    id: 'theme-' + th,
    section: t('cmdkSectionTheme'),
    icon: THEME_ICON[th] || '·',
    label: THEME_LABEL[th] || th,
    run: () => setTheme(th),
  }));

  const sessionCommands = [
    {
      id: 'logout',
      section: t('cmdkSectionSession'),
      icon: '↪',
      label: t('logout'),
      run: async () => {
        disconnectSocket();
        await api.logout().catch(() => { /* 무시 */ });
        clearUser();
      },
    },
  ];

  const allCommands = [
    ...tabCommands,
    ...actionCommands,
    ...langCommands,
    ...themeCommands,
    ...sessionCommands,
  ];

  // ─── Filter + group ───
  const filtered = allCommands.filter((c) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return c.label.toLowerCase().includes(q)
      || (c.section || '').toLowerCase().includes(q);
  });

  const grouped = {};
  filtered.forEach((c) => {
    const s = c.section || '·';
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(c);
  });
  const flat = Object.values(grouped).flat();

  function handleKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[active]) {
        flat[active].run();
        onClose();
      }
    }
  }

  if (!open) return null;
  return (
    <div
      className="cmdk-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="cmdk"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('cmdkTitle')}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder={t('cmdkPlaceholder')}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={handleKey}
          aria-label={t('cmdkTitle')}
        />
        <div className="cmdk-list" role="listbox">
          {flat.length === 0 ? (
            <div className="cmdk-empty">{t('cmdkNoResults')}</div>
          ) : Object.entries(grouped).map(([section, items]) => (
            <div key={section}>
              <div className="cmdk-section">{section}</div>
              {items.map((c) => {
                const idx = flat.indexOf(c);
                const isActive = idx === active;
                return (
                  <div
                    key={c.id}
                    role="option"
                    aria-selected={isActive}
                    className={'cmdk-item' + (isActive ? ' active' : '')}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => { c.run(); onClose(); }}
                  >
                    <div className="cmdk-item-icon" aria-hidden>{c.icon}</div>
                    <div className="cmdk-item-label">{c.label}</div>
                    {c.shortcut && (
                      <div className="cmdk-item-shortcut">
                        <kbd>{c.shortcut}</kbd>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
