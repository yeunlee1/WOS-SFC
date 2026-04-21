import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, THEMES } from '../../store';
import { useI18n, SUPPORTED_LANGS } from '../../i18n';
import { api, disconnectSocket } from '../../api';
import { speak, stopAllTts } from '../Battle/tts';
import ThemePicker from './ThemePicker';

const THEME_DRAWER_META = {
  spring:    { label: '🌸 Spring',    dot1: '#f9a8d4', dot2: '#d946a8' },
  anthropic: { label: '🕯️ Anthropic', dot1: '#faf9f5', dot2: '#d97757' },
  dark:      { label: '🌙 Dark',      dot1: '#1c1d22', dot2: '#818cf8' },
};

const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#ec4899',
};

const TAB_KEYS = [
  { id: 'battle',    key: 'tabBattle' },
  { id: 'community', key: 'tabCommunity' },
  { id: 'chat',      key: 'tabChat' },
];

/** RTT 값에 따른 아이콘 반환 */
function _rttIcon(rtt) {
  if (rtt >= 300) return '🔴';
  if (rtt >= 100) return '🟡';
  return '🟢';
}

export default function Header({ activeTab, onTabChange, onToggleOnline }) {
  const {
    user, timeOffset, timeSyncRtt, clearUser, onlineUsers,
    ttsVolume, setTtsVolume, ttsMuted, setTtsMuted,
    theme, setTheme,
  } = useStore();
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

  return (
    <header className="app-header">
      <div className="header-top">
        <div className="header-left">
          <span className="app-title">⚔️ WOS SFC</span>
          <span className="world-clock">{utcTime}</span>
        </div>

        {/* 데스크톱 헤더 우측 — 인라인 JSX 필수:
         *  - 내부 함수 컴포넌트로 정의하면 Header 리렌더(매초 utcTime 변경)마다
         *    새 함수 참조가 생성돼 React가 자식(ThemePicker, 슬라이더)을 재마운트함.
         *    → 슬라이더 드래그 끊김, ThemePicker 드롭다운이 매초 닫힘 버그. */}
        <div className="header-right" id="user-info">
          {user && (
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
              <ThemePicker />
              <span
                className="time-sync-badge"
                title={`시간 동기화 RTT: ${Math.round(timeSyncRtt)}ms`}
                aria-label={`시간 동기화 RTT ${Math.round(timeSyncRtt)}밀리초`}
              >
                {_rttIcon(timeSyncRtt)} ±{Math.round(timeSyncRtt)}ms
              </span>
              <div className="tts-volume-control">
                <button
                  type="button"
                  className="tts-mute-btn"
                  onClick={() => {
                    const next = !ttsMuted;
                    setTtsMuted(next);
                    if (next) stopAllTts();
                  }}
                  aria-label={ttsMuted ? 'TTS 음소거 해제' : 'TTS 음소거'}
                  aria-pressed={ttsMuted}
                  title={ttsMuted ? '음소거 해제' : '음소거'}
                >
                  {ttsMuted || ttsVolume === 0 ? '🔇' : '🔊'}
                </button>
                <input
                  type="range" min="0" max="100" step="1"
                  value={ttsMuted ? 0 : Math.round(ttsVolume * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    setTtsVolume(v);
                    if (v <= 0) stopAllTts();
                  }}
                  aria-label="TTS 볼륨"
                  aria-valuenow={ttsMuted ? 0 : Math.round(ttsVolume * 100)}
                  aria-valuetext={ttsMuted ? `음소거 (기억된 볼륨 ${Math.round(ttsVolume * 100)}%)` : `${Math.round(ttsVolume * 100)}%`}
                />
                <span className="tts-volume-label">
                  {ttsMuted ? '음소거' : `${Math.round(ttsVolume * 100)}%`}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => speak('start', lang, { force: true })}
                  aria-label="TTS 테스트"
                  disabled={ttsMuted || ttsVolume === 0}
                >테스트</button>
              </div>
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
          )}
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
            {user && (
              <>
                <header className="drawer-profile">
                  <div className="drawer-avatar" style={{ background: allianceColor }}>
                    {(user.nickname?.[0] || '?').toUpperCase()}
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
                  <button className="drawer-close-btn" onClick={() => setMenuOpen(false)} aria-label="close">×</button>
                </header>

                <section className="drawer-section">
                  <div className="drawer-section-label">설정</div>
                  <label className="drawer-field-label" htmlFor="drawer-lang">언어</label>
                  <select
                    id="drawer-lang"
                    className="drawer-lang-select"
                    value={lang}
                    onChange={(e) => { changeLang(e.target.value); setMenuOpen(false); }}
                  >
                    {SUPPORTED_LANGS.map((l) => (
                      <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
                    ))}
                  </select>

                  <label className="drawer-field-label" style={{ marginTop: 12 }}>테마</label>
                  <ul className="drawer-theme-list" role="listbox">
                    {THEMES.map((id) => {
                      const m = THEME_DRAWER_META[id];
                      const active = id === theme;
                      return (
                        <li
                          key={id}
                          role="option"
                          aria-selected={active}
                          className={`theme-picker__option${active ? ' is-active' : ''}`}
                          onClick={() => { setTheme(id); }}
                        >
                          <span className="theme-picker__dot" style={{ background: m.dot1 }} />
                          <span className="theme-picker__dot" style={{ background: m.dot2 }} />
                          <span className="theme-picker__label">{m.label}</span>
                          {active && <span className="theme-picker__check">✓</span>}
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <section className="drawer-section">
                  <div className="drawer-section-label">액션</div>
                  <button
                    className="drawer-action-btn"
                    onClick={() => { onToggleOnline(); setMenuOpen(false); }}
                  >
                    <span className="drawer-action-icon">👥</span>
                    <span className="drawer-action-text">온라인</span>
                    <span className="drawer-action-count">{onlineUsers.length}</span>
                  </button>
                  <button
                    className="drawer-action-btn drawer-action-logout"
                    onClick={() => { handleLogout(); setMenuOpen(false); }}
                  >
                    <span className="drawer-action-icon">🚪</span>
                    <span className="drawer-action-text">{t('logout')}</span>
                  </button>
                </section>
              </>
            )}
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
