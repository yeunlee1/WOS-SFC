import { useStore } from '../../store';
import { useI18n } from '../../i18n';

// ─── 연맹 컬러 (Header.jsx와 동일 — 추후 공통 모듈로 추출 검토) ───
const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#ec4899',
};

// ─── 로고 SVG (FROST PROTOCOL 마크) ───
function RailLogo() {
  return (
    <div className="rail-logo" aria-hidden>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2 L12 22 M2 12 L22 12 M5 5 L19 19 M19 5 L5 19"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/**
 * IconRail — 좌측 Discord-style 세로 아이콘 레일.
 *
 * 데스크톱: 항상 표시. 모바일(<760px): 햄버거로 슬라이드 토글.
 * frost 테마뿐 아니라 모든 테마에서 동일한 골격 사용 — 색은 CSS 변수 cascade로 변함.
 */
export default function IconRail({
  activeTab,
  onTabChange,
  chatDockOpen,
  onToggleChatDock,
  onOpenCmdk,
  onToggleUserPopover,
  railOpen,
  onCloseRail,
}) {
  const { t } = useI18n();
  const user = useStore((s) => s.user);
  if (!user) return null;

  const am = ALLIANCE_COLORS[user.allianceName] || '#64748b';
  const isLeader = !!user.isLeader;

  const tabs = [
    { id: 'battle',    icon: '⚔', tooltip: t('tabBattle') },
    { id: 'community', icon: '◫', tooltip: t('tabCommunity') },
    { id: 'chat',      icon: '✉', tooltip: t('tabChat') },
  ];
  if (user.role === 'developer') {
    tabs.push({ id: 'admin', icon: '★', tooltip: t('tabAdmin') });
  }

  return (
    <nav className={'rail' + (railOpen ? ' is-open' : '')} aria-label="primary">
      <RailLogo />
      <div className="rail-divider" />
      {tabs.map((tb) => (
        <button
          key={tb.id}
          className={'rail-btn' + (activeTab === tb.id ? ' active' : '')}
          onClick={() => { onTabChange(tb.id); onCloseRail?.(); }}
          title={tb.tooltip}
          aria-label={tb.tooltip}
          aria-current={activeTab === tb.id ? 'page' : undefined}
        >
          <span aria-hidden>{tb.icon}</span>
          <span className="rail-btn-tooltip">{tb.tooltip}</span>
        </button>
      ))}

      <div className="rail-divider" />
      <button
        className={'rail-btn' + (chatDockOpen && activeTab !== 'chat' ? ' active' : '')}
        onClick={onToggleChatDock}
        title={t('chatDockTooltip')}
        aria-label={t('chatDockTooltip')}
        aria-pressed={chatDockOpen}
      >
        <span aria-hidden>💬</span>
        <span className="rail-btn-tooltip">{t('chatDockTooltip')}</span>
      </button>
      <button
        className="rail-btn"
        onClick={onOpenCmdk}
        title={t('cmdkTooltip')}
        aria-label={t('cmdkTooltip')}
      >
        <span aria-hidden>⌘</span>
        <span className="rail-btn-tooltip">{t('cmdkTooltip')}</span>
      </button>

      <div className="rail-spacer" />

      <button
        className={'rail-user' + (isLeader ? ' rail-user-leader' : '')}
        style={{ background: am }}
        onClick={(e) => { e.stopPropagation(); onToggleUserPopover(); }}
        title={user.nickname}
        aria-label={user.nickname}
      >
        {(user.nickname || '??').slice(0, 2).toUpperCase()}
      </button>
    </nav>
  );
}
