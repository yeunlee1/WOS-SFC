// 동화 버전 상단바 — UTC 시계, 시간 동기화 배지, 음성 제어, 언어, 사용자 칩과 로그아웃.
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useI18n, SUPPORTED_LANGS } from '../i18n';
import { api, disconnectSocket } from '../api';
import { speak, stopAllTts } from '../components/Battle/tts';
import Icon from './icons';
import { storyTabLabel } from './StoryRail';

const ROLE_LABEL = { developer: '개발자', admin: '관리자', member: '일반' };
const ALLIANCE_CHIP = {
  KOR: 'story-chip--sky',
  NSL: 'story-chip--mint',
  JKY: 'story-chip--butter',
  GPX: 'story-chip--lavender',
  UFO: 'story-chip--rose',
};

/** 동기화 배지 — 'synced' 가 아닐 때는 RTT 수치를 보여주지 않는다(Header.jsx 와 같은 규칙). */
export function syncBadge(state, rtt) {
  if (state === 'synced') {
    return { text: `동기화됨 ±${Math.round(rtt)}ms`, cls: 'story-badge--synced', title: `서버 시간 동기화 RTT ${Math.round(rtt)}ms` };
  }
  if (state === 'syncing') {
    return { text: '동기화 중', cls: 'story-badge--syncing', title: '서버 시간 동기화 중' };
  }
  if (state === 'failed') {
    return { text: '동기화 실패', cls: 'story-badge--failed', title: '서버 시간 동기화 실패 — 재시도 중' };
  }
  return { text: '미동기화', cls: '', title: '서버 시간 미동기화 — 기기 시계 기준' };
}

export default function StoryTopbar({ activeTab }) {
  const { user, timeOffset, timeSyncRtt, timeSyncState, ttsVolume, setTtsVolume, ttsMuted, setTtsMuted, clearUser } = useStore();
  const { lang, changeLang } = useI18n();
  const [utcTime, setUtcTime] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

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

  useEffect(() => {
    if (!menuOpen) return undefined;
    function close() {
      setMenuOpen(false);
    }
    const id = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
    };
  }, [menuOpen]);

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      /* 서버가 거부해도 클라이언트 세션은 정리한다 */
    }
    disconnectSocket();
    clearUser();
  }

  const badge = syncBadge(timeSyncState, timeSyncRtt);
  const muted = ttsMuted || ttsVolume === 0;

  return (
    <header className="story-topbar">
      <span className="story-topbar-title">WOS · SFC</span>
      <span className="story-topbar-crumb" aria-hidden="true">›</span>
      <span className="story-topbar-crumb">{storyTabLabel(activeTab)}</span>
      <span className="story-topbar-spacer" />

      <span className="story-chip story-clock" title={badge.title}>
        <Icon name="clock" size={16} />
        {utcTime}
      </span>
      <span className={`story-chip ${badge.cls}`} title={badge.title} aria-label={badge.title}>
        {badge.text}
      </span>

      <div className="story-tts" title="카운트다운 음성">
        <button
          type="button"
          className="story-icon-btn"
          aria-pressed={ttsMuted}
          aria-label={ttsMuted ? '음성 켜기' : '음성 끄기'}
          onClick={() => {
            const next = !ttsMuted;
            setTtsMuted(next);
            if (next) stopAllTts();
          }}
        >
          <Icon name={muted ? 'mute' : 'volume'} size={16} />
          <span>{muted ? '음성 끔' : '음성 켬'}</span>
        </button>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={ttsMuted ? 0 : Math.round(ttsVolume * 100)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setTtsVolume(v);
            if (v <= 0) stopAllTts();
          }}
          aria-label="음성 볼륨"
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => speak('start', lang, { force: true })}
          disabled={muted}
        >
          테스트
        </button>
      </div>

      <select
        className="story-select"
        value={lang}
        onChange={(e) => changeLang(e.target.value)}
        aria-label="언어"
      >
        {SUPPORTED_LANGS.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>

      {user && (
        <div className="story-user">
          <button
            type="button"
            className={`story-chip story-user-chip ${ALLIANCE_CHIP[user.allianceName] || ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {user.nickname} · {user.allianceName}
          </button>
          {menuOpen && (
            <div className="story-user-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <div className="story-user-menu-row"><span>역할</span><span>{ROLE_LABEL[user.role] || user.role}</span></div>
              <div className="story-user-menu-row"><span>연맹</span><span>{user.allianceName}</span></div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
                <Icon name="logout" size={16} />
                로그아웃
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
