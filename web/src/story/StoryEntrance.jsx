// 동화 버전 입구 — 펼쳐진 책 위의 로그인·가입. 인증 계약은 AuthModal 과 같다(api → setUser → changeLang).
import { useState } from 'react';
import { api } from '../api';
import { useStore, ALLIANCES } from '../store';
import { useI18n, SUPPORTED_LANGS } from '../i18n';
import { warmupRallyAudio } from '../components/Battle/rallyGroupPlayer';
import Icon from './icons';

// 닉네임 정책: 한글/영문/숫자만, 2~20자. server 의 SignupDto 와 같은 정규식.
const NICKNAME_REGEX = /^[A-Za-z0-9가-힣]{2,20}$/;

const ALLIANCE_CHIP = {
  KOR: 'story-chip--sky',
  NSL: 'story-chip--mint',
  JKY: 'story-chip--butter',
  GPX: 'story-chip--lavender',
  UFO: 'story-chip--rose',
};

function EntranceSky() {
  return (
    <div className="story-entrance-sky" aria-hidden="true">
      <div className="story-wash" style={{ left: '-8%', top: '-18%', width: 760, height: 520, background: '#cfe3f5', opacity: 0.9 }} />
      <div className="story-wash" style={{ right: '-6%', top: '-14%', width: 720, height: 460, background: '#e2d8f3', opacity: 0.85 }} />
      <div className="story-wash" style={{ left: '30%', top: '14%', width: 620, height: 380, background: '#f7ecc4', opacity: 0.6 }} />
      <div className="story-wash" style={{ right: '-4%', bottom: '-6%', width: 640, height: 420, background: '#f5d6dd', opacity: 0.7 }} />
      <div className="story-wash" style={{ left: '-6%', bottom: '-4%', width: 700, height: 420, background: '#d3ede0', opacity: 0.85 }} />
      <svg className="story-entrance-moon" width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="44" fill="#f7ecc4" stroke="#3f3a4a" strokeWidth="2" />
        <circle cx="44" cy="52" r="6" fill="#efdca6" />
        <circle cx="70" cy="72" r="9" fill="#efdca6" />
      </svg>
      <svg className="story-entrance-flakes" viewBox="0 0 1440 560" preserveAspectRatio="none" fill="none" stroke="#3f3a4a" strokeWidth="1.5" strokeLinecap="round">
        <g opacity="0.55">
          <path d="M340 140v18M331 149h18M334 143l12 12M346 143l-12 12" />
          <path d="M1210 90v18M1201 99h18M1204 93l12 12M1216 93l-12 12" />
          <path d="M980 250v14M973 257h14M975 252l10 10M985 252l-10 10" />
          <path d="M520 60v14M513 67h14M515 62l10 10M525 62l-10 10" />
          <path d="M1330 300v14M1323 307h14M1325 302l10 10M1335 302l-10 10" />
          <path d="M120 420v14M113 427h14M115 422l10 10M125 422l-10 10" />
        </g>
      </svg>
      <svg className="story-entrance-hills" viewBox="0 0 1440 360" preserveAspectRatio="none" fill="none">
        <path d="M0 250C180 190 320 260 520 210C700 170 860 240 1040 200C1220 160 1340 220 1440 190L1440 360L0 360Z" fill="#dcd0ef" opacity="0.7" />
        <path d="M0 300C200 250 380 310 600 270C820 230 1000 300 1200 260C1320 235 1400 260 1440 250L1440 360L0 360Z" fill="#cfe9dc" opacity="0.9" />
        <path d="M0 330C240 300 460 340 720 315C980 290 1180 335 1440 310L1440 360L0 360Z" fill="#bfe0cf" />
        <g transform="translate(1040 130)" stroke="#3f3a4a" strokeWidth="2" fill="#fbf6ee" strokeLinejoin="round">
          <rect x="0" y="40" width="150" height="70" rx="6" />
          <rect x="18" y="8" width="26" height="102" rx="4" />
          <rect x="106" y="8" width="26" height="102" rx="4" />
          <path d="M18 8L31-14L44 8Z" />
          <path d="M106 8L119-14L132 8Z" />
          <path d="M62 110L62 78Q75 62 88 78L88 110Z" fill="#f7c9b3" />
          <path d="M31-14L31-30L47-24L31-18" fill="#f7c9b3" />
        </g>
        <g stroke="#3f3a4a" strokeWidth="2" fill="#d3ede0" strokeLinejoin="round">
          <path d="M180 300L210 230L240 300Z" />
          <path d="M225 300L262 210L299 300Z" />
          <path d="M1260 300L1290 235L1320 300Z" />
        </g>
      </svg>
    </div>
  );
}

function PageArt() {
  return (
    <svg className="story-page-art" viewBox="0 0 300 150" fill="none" aria-hidden="true">
      <path d="M0 120C60 90 110 130 170 100C230 70 270 110 300 95L300 150L0 150Z" fill="#d3ede0" />
      <path d="M0 135C80 115 150 145 300 120L300 150L0 150Z" fill="#bfe0cf" />
      <g stroke="#3f3a4a" strokeWidth="2" fill="#fbf6ee" strokeLinejoin="round" strokeLinecap="round">
        <path d="M120 110L150 52L180 110Z" />
        <path d="M150 52L150 36L166 42L150 48" fill="#f7c9b3" />
        <circle cx="60" cy="40" r="16" fill="#f7ecc4" />
      </g>
      <g fill="#fff" stroke="#3f3a4a" strokeWidth="1">
        <circle cx="220" cy="30" r="3" />
        <circle cx="250" cy="60" r="2.5" />
        <circle cx="30" cy="80" r="2.5" />
        <circle cx="200" cy="80" r="2" />
      </g>
    </svg>
  );
}

export default function StoryEntrance() {
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [allianceName, setAllianceName] = useState('');
  const [language, setLanguage] = useState('ko');
  const [serverCode, setServerCode] = useState('');

  const setUser = useStore((state) => state.setUser);
  const { changeLang } = useI18n();

  async function initUser(user) {
    setUser(user);
    changeLang(user.language || 'ko');
    // 로그인 직후 사용자 제스처가 살아있는 동안 AudioContext 언락 + 그룹 음성 사전 디코드 (AuthModal 과 동일).
    warmupRallyAudio({ lang: user.language || 'ko' }).catch(() => {
      /* noop */
    });
  }

  function switchMode(next) {
    setMode(next);
    setError('');
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!nickname || !password) {
      setError('닉네임과 비밀번호를 입력하세요');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.login({ nickname, password });
      await initUser(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    if (!nickname || !password || !allianceName || !serverCode) {
      setError('모든 항목을 입력하세요');
      return;
    }
    if (!NICKNAME_REGEX.test(nickname)) {
      setError('닉네임은 한글 또는 영문/숫자만 사용할 수 있습니다 (2~20자, 특수문자·공백 불가)');
      return;
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.signup({ nickname, password, allianceName, language, serverCode });
      await initUser(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === 'login';

  return (
    <div className="story-entrance">
      <EntranceSky />
      <div className="story-entrance-top">
        <span className="story-chip">
          <Icon name="globe" size={16} />
          한국어
        </span>
        <span className="story-entrance-note">오늘도 눈이 내려요</span>
      </div>

      <div className="story-book">
        <div className="story-page story-page--left">
          <span className="story-page-kicker">제 1장</span>
          <h1 className="story-brand">WOS · SFC</h1>
          <p className="story-brand-sub">눈 내리는 왕국의 작전 일지</p>
          <p className="story-brand-copy">
            집결과 출발, 공지와 이야기가 한 권에 모여요. 참모총장이 페이지를 넘기면 연맹 전체가 같은 순간을 듣습니다.
          </p>
          <PageArt />
          <span className="story-page-number">1</span>
        </div>

        <div className="story-page story-page--right">
          <span className="story-ribbon" aria-hidden="true" />
          <div className="story-mobile-brand">
            <span className="story-brand serif" style={{ fontSize: 30 }}>WOS · SFC</span>
            <span className="story-muted">눈 내리는 왕국의 작전 일지</span>
          </div>
          <span className="story-page-kicker">{isLogin ? '입장하기' : '이야기에 합류하기'}</span>

          {isLogin ? (
            <form onSubmit={handleLogin} className="story-form" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="story-field">
                <label className="story-label" htmlFor="story-login-nickname">닉네임</label>
                <input
                  id="story-login-nickname"
                  className="input"
                  type="text"
                  autoComplete="username"
                  placeholder="게임 닉네임"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </div>
              <div className="story-field">
                <label className="story-label" htmlFor="story-login-password">비밀번호</label>
                <input
                  id="story-login-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="비밀번호 입력"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="story-error" role="alert">{error}</p>}
              <div className="story-form-row">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  <Icon name="book" size={18} />
                  {loading ? '연결 중...' : '입장'}
                </button>
                <span className="story-muted">Enter 로도 넘어가요</span>
              </div>
              <div className="story-divider" />
              <button type="button" className="story-link-btn" onClick={() => switchMode('signup')}>
                처음 오셨나요? 가입 코드로 이야기에 합류하기
              </button>
              <div className="story-alliance-chips" aria-hidden="true">
                {ALLIANCES.map((a) => (
                  <span key={a} className={`story-chip ${ALLIANCE_CHIP[a]}`}>{a}</span>
                ))}
              </div>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="story-form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="story-field">
                <label className="story-label" htmlFor="story-signup-nickname">닉네임</label>
                <input
                  id="story-signup-nickname"
                  className="input"
                  type="text"
                  autoComplete="username"
                  placeholder="한글 또는 영문/숫자, 2~20자"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </div>
              <div className="story-field">
                <label className="story-label" htmlFor="story-signup-password">비밀번호</label>
                <input
                  id="story-signup-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="6자 이상"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="story-field">
                <span className="story-label">연맹 선택</span>
                <div className="story-alliance-chips" role="group" aria-label="연맹 선택">
                  {ALLIANCES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={`story-chip ${ALLIANCE_CHIP[a]}`}
                      aria-pressed={allianceName === a}
                      onClick={() => setAllianceName(a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <div className="story-form-row">
                <div className="story-field" style={{ flex: '1 1 140px' }}>
                  <label className="story-label" htmlFor="story-signup-language">내 언어</label>
                  <select
                    id="story-signup-language"
                    className="input"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    {SUPPORTED_LANGS.map((l) => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                </div>
                <div className="story-field" style={{ flex: '1 1 140px' }}>
                  <label className="story-label" htmlFor="story-signup-code">가입 코드</label>
                  <input
                    id="story-signup-code"
                    className="input"
                    type="text"
                    placeholder="연맹에서 받은 코드"
                    value={serverCode}
                    onChange={(e) => setServerCode(e.target.value)}
                  />
                </div>
              </div>
              {error && <p className="story-error" role="alert">{error}</p>}
              <div className="story-form-row">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  <Icon name="bookmark" size={18} />
                  {loading ? '연결 중...' : '합류하기'}
                </button>
              </div>
              <div className="story-divider" />
              <button type="button" className="story-link-btn" onClick={() => switchMode('login')}>
                이미 계정이 있어요. 입장으로 돌아가기
              </button>
            </form>
          )}
          <span className="story-page-number">2</span>
        </div>
      </div>

      <p className="story-entrance-foot">책장을 넘기면 오늘의 작전이 시작됩니다</p>
    </div>
  );
}
