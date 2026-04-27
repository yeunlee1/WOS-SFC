import { useState } from 'react';
import { api } from '../../api';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { warmupRallyAudio } from '../Battle/rallyGroupPlayer';

const LANGUAGES = [
  { value: 'ko', label: '🇰🇷 한국어' },
  { value: 'en', label: '🇺🇸 English' },
  { value: 'ja', label: '🇯🇵 日本語' },
  { value: 'zh', label: '🇨🇳 中文' },
  { value: 'ru', label: '🇷🇺 Русский' },
  { value: 'other', label: '기타' },
];

const DEV_ACCOUNTS = [
  { label: '🛡️ 개발자 (한국)', nickname: 'devDevKo',    password: 'devpass123', role: 'developer', language: 'ko', allianceName: 'KOR' },
  { label: '👑 관리자 (한국)', nickname: 'devAdminKo',  password: 'devpass123', role: 'admin',  language: 'ko', allianceName: 'KOR' },
  { label: '🇨🇳 관리자 (중국)', nickname: 'devAdminZh',  password: 'devpass123', role: 'admin',  language: 'zh', allianceName: 'KOR' },
  { label: '🇺🇸 관리자 (영어)', nickname: 'devAdminEn',  password: 'devpass123', role: 'admin',  language: 'en', allianceName: 'KOR' },
  { label: '🇯🇵 관리자 (일본)', nickname: 'devAdminJa',  password: 'devpass123', role: 'admin',  language: 'ja', allianceName: 'KOR' },
  { label: '🙋 멤버 (한국)',   nickname: 'devMemberKo', password: 'devpass123', role: 'member', language: 'ko', allianceName: 'KOR' },
  { label: '🙋 멤버 (중국)',   nickname: 'devMemberZh', password: 'devpass123', role: 'member', language: 'zh', allianceName: 'KOR' },
  { label: '🙋 멤버 (영어)',   nickname: 'devMemberEn', password: 'devpass123', role: 'member', language: 'en', allianceName: 'KOR' },
  { label: '🙋 멤버 (일본)',   nickname: 'devMemberJa', password: 'devpass123', role: 'member', language: 'ja', allianceName: 'KOR' },
];

// 닉네임 정책: 한글/영문/숫자만, 2~20자. 특수문자·공백 금지.
// 닉네임 정규식 — server/web 양쪽이 동일해야 함. 한쪽만 바꾸면 silent divergence 발생.
const NICKNAME_REGEX = /^[A-Za-z0-9가-힣]{2,20}$/;

export default function AuthModal() {
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [signupNickname, setSignupNickname] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [allianceName, setAllianceName] = useState('');
  const [language, setLanguage] = useState('ko');
  const [serverCode, setServerCode] = useState('');

  const { setUser, setTimeOffset } = useStore();
  const { changeLang } = useI18n();

  async function initUser(user) {
    setUser(user);
    changeLang(user.language || 'ko');
    // 로그인 직후 사용자 제스처가 살아있는 동안 AudioContext 언락 + 모든 그룹 음성 사전 디코드.
    // fire-and-forget — 로그인 응답 + 화면 전환은 차단하지 않음. 첫 카운트다운 시작 시점에
    // bufferCache에 모든 captain/rally_start/prep/numeric이 디코드되어 있어 첫 시작 누락 방지.
    warmupRallyAudio({ lang: user.language || 'ko' }).catch(() => { /* noop */ });
    try {
      const localBefore = Date.now();
      const res = await api.getTime();
      setTimeOffset(res.utc - Math.round((localBefore + Date.now()) / 2));
    } catch { /* offset 0 유지 */ }
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!nickname || !password) { setError('닉네임과 비밀번호를 입력하세요'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.login({ nickname, password });
      await initUser(res.user);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleSignup(e) {
    e.preventDefault();
    if (!signupNickname || !signupPassword || !allianceName || !serverCode) { setError('모든 항목을 입력하세요'); return; }
    if (!NICKNAME_REGEX.test(signupNickname)) {
      setError('닉네임은 한글 또는 영문/숫자만 사용할 수 있습니다 (2~20자, 특수문자·공백 불가)');
      return;
    }
    if (signupPassword.length < 6) { setError('비밀번호는 6자 이상이어야 합니다'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.signup({ nickname: signupNickname, password: signupPassword, allianceName, language, serverCode });
      await initUser(res.user);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function devLogin(account) {
    setLoading(true); setError('');
    try {
      let res;
      try { res = await api.login({ nickname: account.nickname, password: account.password }); }
      catch {
        await api.signup({ nickname: account.nickname, password: account.password, allianceName: account.allianceName, language: account.language, serverCode: '2677' }).catch(() => {});
        res = await api.login({ nickname: account.nickname, password: account.password });
      }
      await api.setUserRole(account.nickname, account.role).catch(() => {});
      await initUser({ ...res.user, role: account.role, language: account.language });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="alliance-modal">
      <div className="alliance-modal-box">
        <h2>🌸 WOS SFC</h2>
        <p className="auth-subtitle">{mode === 'login' ? '동맹 지휘 보조 시스템' : '새 계정 만들기'}</p>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} style={{ width:'100%', display:'flex', flexDirection:'column' }}>
            <div className="auth-field">
              <label htmlFor="login-nick">닉네임</label>
              <input id="login-nick" className="modal-nick-input" type="text" placeholder="게임 닉네임" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={50} autoComplete="username" />
            </div>
            <div className="auth-field">
              <label htmlFor="login-pw">비밀번호</label>
              <input id="login-pw" className="modal-nick-input" type="password" placeholder="비밀번호 입력" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={100} autoComplete="current-password" />
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop:'8px', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {loading && <span className="btn-spinner" aria-hidden="true" />}
              {loading ? '잠시만요…' : '로그인'}
            </button>
            <p className="auth-switch">계정이 없으신가요? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); setError(''); }}>회원가입</a></p>
          </form>
        ) : (
          <form onSubmit={handleSignup} style={{ width:'100%', display:'flex', flexDirection:'column' }}>
            <div className="auth-field">
              <label>게임 닉네임 (= 로그인 ID)</label>
              <input className="modal-nick-input" type="text" placeholder="한글 또는 영문/숫자, 2~20자" value={signupNickname} onChange={(e) => setSignupNickname(e.target.value)} maxLength={20} autoComplete="username" />
              <p className="auth-help">한글 또는 영문·숫자만 가능. 특수문자와 공백은 사용할 수 없습니다.</p>
            </div>
            <div className="auth-field"><label>비밀번호</label><input className="modal-nick-input" type="password" placeholder="6자 이상" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} maxLength={100} autoComplete="new-password" /></div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 12px' }}>
              <div className="auth-field"><label>동맹명</label><input className="modal-nick-input" type="text" placeholder="예: KOR" value={allianceName} onChange={(e) => setAllianceName(e.target.value)} maxLength={100} /></div>
              <div className="auth-field"><label>언어</label><select className="modal-nick-input" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select></div>
            </div>
            <div className="auth-field"><label className="auth-server-question">🗺 서버 번호가 어디입니까?</label><input className="modal-nick-input" type="text" placeholder="숫자 입력" value={serverCode} onChange={(e) => setServerCode(e.target.value)} maxLength={10} inputMode="numeric" autoComplete="off" /></div>
            <p className="auth-help" style={{ margin:'0 0 8px' }}>계급은 관리자가 가입 후 별도로 부여합니다.</p>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop:'8px', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {loading && <span className="btn-spinner" aria-hidden="true" />}
              {loading ? '잠시만요…' : '가입하기'}
            </button>
            <p className="auth-switch">이미 계정이 있으신가요? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setError(''); }}>로그인</a></p>
          </form>
        )}

        {import.meta.env.DEV && (
          <details className="modal-dev-section">
            <summary className="modal-dev-summary">🔧 DEV 빠른 로그인</summary>
            <div style={{ display:'flex', flexDirection:'column', gap:'6px', marginTop:'10px' }}>
              {DEV_ACCOUNTS.map((acc) => (
                <button key={acc.nickname} className="dev-login-btn" onClick={() => devLogin(acc)} disabled={loading} style={{ display:'flex', alignItems:'center' }}>
                  {loading && <span className="btn-spinner" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border)' }} aria-hidden="true" />}
                  {acc.label}
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
