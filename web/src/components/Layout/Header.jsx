import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useI18n, SUPPORTED_LANGS } from '../../i18n';
import { api, disconnectSocket } from '../../api';

const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#ec4899',
};

const TAB_KEYS = [
  { id: 'battle',    key: 'tabBattle' },
  { id: 'community', key: 'tabCommunity' },
  { id: 'chat',      key: 'tabChat' },
];

export default function Header({ activeTab, onTabChange, onToggleOnline }) {
  const { user, timeOffset, clearUser, onlineUsers } = useStore();
  const { t, lang, changeLang } = useI18n();
  const [utcTime, setUtcTime] = useState('');
  const [isMenuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function tick() {
      const now = new Date(Date.now() + timeOffset);
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      setUtcTime(`UTC ${h}:${m}:${s}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeOffset]);

  async function handleLogout() {
    disconnectSocket();
    await api.logout().catch(() => {});
    clearUser();
  }

  const roleLabel = {
    developer: t('roleDeveloper'),
    admin:     t('roleAdmin'),
    member:    t('roleUser'),
  }[user?.role] || t('roleUser');

  const allianceColor = ALLIANCE_COLORS[user?.allianceName] || '#64748b';

  // 데스크톱 헤더 우측 + 모바일 드로어 내부에서 공용 사용
  function UserControls({ onAfterAction }) {
    if (!user) return null;
    const close = () => onAfterAction?.();
    return (
      <>
        <span className="user-alliance-badge" style={{ background: allianceColor }}>
          {user.allianceName}
        </span>
        <span className="user-nickname">{user.nickname}</span>
        <span className="user-role-badge">{roleLabel}</span>
        <select
          className="lang-select"
          value={lang}
          onChange={(e) => { changeLang(e.target.value); close(); }}
        >
          {SUPPORTED_LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
          ))}
        </select>
        <button
          className="mobile-online-toggle btn btn-sm"
          onClick={() => { onToggleOnline(); close(); }}
        >
          👥 {onlineUsers.length}
        </button>
        <button
          className="btn btn-sm"
          id="logout-btn"
          onClick={() => { handleLogout(); close(); }}
        >
          {t('logout')}
        </button>
      </>
    );
  }

  return (
    <header className="app-header">
      <div className="header-top">
        <div className="header-left">
          <span className="app-title">⚔️ WOS SFC</span>
          <span className="world-clock">{utcTime}</span>
        </div>
        <div className="header-right" id="user-info">
          <UserControls />
        </div>
        <button
          className="mobile-menu-toggle"
          onClick={() => setMenuOpen(true)}
          aria-label="menu"
        >
          ☰
        </button>
      </div>

      <aside className={`header-drawer${isMenuOpen ? ' header-drawer--open' : ''}`}>
        <button
          className="header-drawer-close"
          onClick={() => setMenuOpen(false)}
          aria-label="close"
        >
          ×
        </button>
        <div className="header-drawer-body">
          <UserControls onAfterAction={() => setMenuOpen(false)} />
        </div>
      </aside>
      {isMenuOpen && (
        <div className="header-overlay-left" onClick={() => setMenuOpen(false)} />
      )}

      <nav className="tab-nav">
        {TAB_KEYS.map(({ id, key }) => (
          <button
            key={id}
            className={`tab-btn${activeTab === id ? ' active' : ''}`}
            onClick={() => onTabChange(id)}
          >
            {t(key)}
          </button>
        ))}
        {/* developer 전용 관리자 탭 */}
        {user?.role === 'developer' && (
          <button
            className={`tab-btn${activeTab === 'admin' ? ' active' : ''}`}
            onClick={() => onTabChange('admin')}
          >
            🛡️ 관리자
          </button>
        )}
      </nav>
    </header>
  );
}
