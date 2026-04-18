import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

  // 데스크톱 헤더 우측 전용 — 드로어는 별도 구조 (DrawerContent)
  function DesktopUserControls() {
    if (!user) return null;
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
          onChange={(e) => changeLang(e.target.value)}
        >
          {SUPPORTED_LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
          ))}
        </select>
        <button
          className="mobile-online-toggle btn btn-sm"
          onClick={onToggleOnline}
        >
          👥 {onlineUsers.length}
        </button>
        <button className="btn btn-sm" id="logout-btn" onClick={handleLogout}>
          {t('logout')}
        </button>
      </>
    );
  }

  // 모바일 드로어 전용 — 프로필/설정/액션 3섹션 구조
  function DrawerContent({ onClose }) {
    if (!user) return null;
    const initial = (user.nickname?.[0] || '?').toUpperCase();
    return (
      <>
        <header className="drawer-profile">
          <div className="drawer-avatar" style={{ background: allianceColor }}>
            {initial}
          </div>
          <div className="drawer-profile-text">
            <div className="drawer-nickname">{user.nickname}</div>
            <div className="drawer-meta">
              <span className="drawer-alliance-badge" style={{ background: allianceColor }}>
                {user.allianceName}
              </span>
              <span className="drawer-role">{roleLabel}</span>
            </div>
          </div>
          <button className="drawer-close-btn" onClick={onClose} aria-label="close">×</button>
        </header>

        <section className="drawer-section">
          <div className="drawer-section-label">설정</div>
          <label className="drawer-field-label" htmlFor="drawer-lang">언어</label>
          <select
            id="drawer-lang"
            className="drawer-lang-select"
            value={lang}
            onChange={(e) => { changeLang(e.target.value); onClose(); }}
          >
            {SUPPORTED_LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
            ))}
          </select>
        </section>

        <section className="drawer-section">
          <div className="drawer-section-label">액션</div>
          <button
            className="drawer-action-btn"
            onClick={() => { onToggleOnline(); onClose(); }}
          >
            <span className="drawer-action-icon">👥</span>
            <span className="drawer-action-text">온라인</span>
            <span className="drawer-action-count">{onlineUsers.length}</span>
          </button>
          <button
            className="drawer-action-btn drawer-action-logout"
            onClick={() => { handleLogout(); onClose(); }}
          >
            <span className="drawer-action-icon">🚪</span>
            <span className="drawer-action-text">{t('logout')}</span>
          </button>
        </section>
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
          <DesktopUserControls />
        </div>
        <button
          className="mobile-menu-toggle"
          onClick={() => setMenuOpen(true)}
          aria-label="menu"
        >
          ☰
        </button>
      </div>

      {createPortal(
        <>
          <aside className={`header-drawer${isMenuOpen ? ' header-drawer--open' : ''}`}>
            <DrawerContent onClose={() => setMenuOpen(false)} />
          </aside>
          <div
            className={`header-overlay-left${isMenuOpen ? ' header-overlay-left--open' : ''}`}
            onClick={() => setMenuOpen(false)}
          />
        </>,
        document.body
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
