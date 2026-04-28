import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useI18n, SUPPORTED_LANGS } from '../../i18n';
import { speak, stopAllTts } from '../Battle/tts';
import ThemePicker from './ThemePicker';

/** RTT 값에 따른 아이콘 반환 */
function _rttIcon(rtt) {
  if (rtt >= 300) return '🔴';
  if (rtt >= 100) return '🟡';
  return '🟢';
}

const TAB_KEYS = [
  { id: 'battle',    key: 'tabBattle' },
  { id: 'community', key: 'tabCommunity' },
  { id: 'chat',      key: 'tabChat' },
  { id: 'admin',     key: 'tabAdmin' },
];

/**
 * Header — Topbar (슬림형). FROST PROTOCOL 디자인의 .topbar 패턴.
 *
 * 좌측: 햄버거(모바일) + 앱 타이틀 + breadcrumb (현재 탭)
 * 우측: 시계 + ⌘K 힌트 + TTS 볼륨 + 언어 + 테마 + RTT + 채팅 도크 토글
 *
 * 사용자 닉네임/역할/연맹/로그아웃은 IconRail 의 사용자 아바타 → UserPopover 로 이동됨.
 * 수평 tab-nav 는 IconRail 로 대체됨 (Phase 2 — Layout Shell).
 */
export default function Header({
  activeTab,
  chatDockOpen,
  onToggleOnline,
  onOpenRail,
  onOpenCmdk,
}) {
  const {
    timeOffset, timeSyncRtt, onlineUsers,
    ttsVolume, setTtsVolume, ttsMuted, setTtsMuted,
  } = useStore();
  const { t, lang, changeLang } = useI18n();
  const [utcTime, setUtcTime] = useState('');

  useEffect(() => {
    function tick() {
      const now = new Date(Date.now() + timeOffset);
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      setUtcTime(`${h}:${m}:${s} UTC`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeOffset]);

  const currentTabLabel = (() => {
    const tb = TAB_KEYS.find((k) => k.id === activeTab);
    return tb ? t(tb.key) : '';
  })();

  // Topbar 의 chat dock 토글 버튼 active 표시 조건:
  //  1) chatDockOpen === true (사용자가 도크를 켰음)
  //  2) activeTab !== 'chat' (chat 탭에서는 풀페이지가 이미 채팅이라 도크 비활성)
  // App.jsx 의 dockActuallyOpen 계산과 동기.
  const dockToggleActive = !!chatDockOpen && activeTab !== 'chat';

  return (
    <header className="topbar">
      <button
        className="mobile-toggle-rail"
        onClick={onOpenRail}
        aria-label="menu"
      >
        ☰
      </button>

      <span className="topbar-title">⚔️ WOS · SFC</span>
      {currentTabLabel && (
        <span className="topbar-breadcrumb">
          <span aria-hidden>{t('breadcrumbSep')}</span>
          <span className="topbar-breadcrumb-current">{currentTabLabel}</span>
        </span>
      )}

      <span className="topbar-spacer" />

      <span
        className="world-clock"
        title={`서버 시간 동기화 ±${Math.round(timeSyncRtt)}ms`}
      >
        {utcTime}
      </span>

      <button
        className="kbd-hint"
        onClick={onOpenCmdk}
        title={t('cmdkTooltip')}
        aria-label={t('cmdkTooltip')}
      >
        <span>{t('cmdkTitle')}</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="tts-volume-control" title="TTS">
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
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm tts-test-btn"
          onClick={() => speak('start', lang, { force: true })}
          aria-label="TTS 테스트"
          disabled={ttsMuted || ttsVolume === 0}
        >테스트</button>
      </div>

      <select
        className="lang-select"
        value={lang}
        onChange={(e) => changeLang(e.target.value)}
        aria-label="language"
      >
        {SUPPORTED_LANGS.map((l) => (
          <option key={l.code} value={l.code}>{l.flag} {l.code.toUpperCase()}</option>
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

      <button
        className={'topbar-icon-btn' + (dockToggleActive ? ' active' : '')}
        onClick={onToggleOnline}
        title={t('chatDockTooltip')}
        aria-label={t('chatDockTooltip')}
        aria-pressed={dockToggleActive}
      >
        <span aria-hidden>👥</span>
        <span style={{ marginLeft: 4, fontSize: 11 }}>{onlineUsers.length}</span>
      </button>
    </header>
  );
}
