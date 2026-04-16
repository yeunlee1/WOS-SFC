import { useState } from 'react';
import { api } from '../../api';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';

const LANGUAGES = [
  { value: 'ko', label: '🇰🇷 한국어' },
  { value: 'en', label: '🇺🇸 English' },
  { value: 'ja', label: '🇯🇵 日本語' },
  { value: 'zh', label: '🇨🇳 中文' },
  { value: 'ru', label: '🇷🇺 Русский' },
  { value: 'other', label: '기타' },
];

const DEV_ACCOUNTS = [
  { label: '👑 관리자 (한국)', nickname: 'dev_admin_ko',  password: 'devpass123', role: 'admin', language: 'ko', allianceName: 'KOR', name: '관리자',    birthDate: '1990-01-01' },
  { label: '🇨🇳 관리자 (중국)', nickname: 'dev_member_zh', password: 'devpass123', role: 'admin', language: 'zh', allianceName: 'KOR', name: '중국관리자', birthDate: '1990-01-01' },
  { label: '🇺🇸 관리자 (영어)', nickname: 'dev_member_en', password: 'devpass123', role: 'admin', language: 'en', allianceName: 'KOR', name: 'EnAdmin',   birthDate: '1990-01-01' },
  { label: '🇯🇵 관리자 (일본)', nickname: 'dev_member_ja', password: 'devpass123', role: 'admin', language: 'ja', allianceName: 'KOR', name: '日本管理者', birthDate: '1990-01-01' },
];

export default function AuthModal() {
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // login form
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');

  // signup form
  const [name, setName] = useState('');
  const [signupNickname, setSignupNickname] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [allianceName, setAllianceName] = useState('');
  const [role, setRole] = useState('member');
  const [birthDate, setBirthDate] = useState('');
  const [language, setLanguage] = useState('ko');
  const [serverCode, setServerCode] = useState('');

  const { setUser, setTimeOffset } = useStore();
  const { changeLang } = useI18n();

  async function initUser(user, token) {
    setUser(user, token);
    changeLang(user.language || 'ko');
    // 시간 동기화
    try {
      const localBefore = Date.now();
      const res = await api.getTime();
      const offset = res.utc - Math.round((localBefore + Date.now()) / 2);
      setTimeOffset(offset);
    } catch { /* 실패 시 0 유지 */ }
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!nickname || !password) { setError('닉네임과 비밀번호를 입력하세요'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.login({ nickname, password });
      await initUser(res.user, res.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    if (!name || !signupNickname || !signupPassword || !allianceName || !birthDate) {
      setError('모든 항목을 입력하세요'); return;
    }
    if (signupPassword.length < 6) { setError('비밀번호는 6자 이상이어야 합니다'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.signup({ name, nickname: signupNickname, password: signupPassword, allianceName, role, birthDate, language, serverCode });
      await initUser(res.user, res.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function devLogin(account) {
    setLoading(true); setError('');
    try {
      let res;
      try {
        res = await api.login({ nickname: account.nickname, password: account.password });
      } catch {
        await api.signup({ nickname: account.nickname, password: account.password, name: account.name, allianceName: account.allianceName, role: account.role, birthDate: account.birthDate, language: account.language, serverCode: '2677' }).catch(() => {});
        res = await api.login({ nickname: account.nickname, password: account.password });
      }
      await api.setUserRole(account.nickname, account.role).catch(() => {});
      await initUser({ ...res.user, role: account.role, language: account.language }, res.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="alliance-modal" style={{ display: 'flex' }}>
      <div className="alliance-modal-box">
        <h2>⚔️ WOS SFC</h2>
        <p className="auth-subtitle">{mode === 'login' ? '로그인' : '회원가입'}</p>

        {mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <input className="modal-nick-input" type="text" placeholder="닉네임" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={50} autoComplete="username" />
            <input className="modal-nick-input" type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={100} autoComplete="current-password" />
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? '처리 중...' : '로그인'}</button>
            <p className="auth-switch">계정이 없으신가요? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); setError(''); }}>회원가입</a></p>
          </form>
        ) : (
          <form onSubmit={handleSignup}>
            <input className="modal-nick-input" type="text" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            <input className="modal-nick-input" type="text" placeholder="닉네임" value={signupNickname} onChange={(e) => setSignupNickname(e.target.value)} maxLength={50} autoComplete="username" />
            <input className="modal-nick-input" type="password" placeholder="비밀번호 (6자 이상)" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} maxLength={100} autoComplete="new-password" />
            <input className="modal-nick-input" type="text" placeholder="동맹명 (예: KOR)" value={allianceName} onChange={(e) => setAllianceName(e.target.value)} maxLength={100} />
            <select className="modal-nick-input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">일반 인원</option>
              <option value="admin">관리자</option>
            </select>
            <input className="modal-nick-input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            <select className="modal-nick-input" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <p className="auth-server-question">서버가 어디입니까?</p>
            <input className="modal-nick-input" type="text" placeholder="답변 입력" value={serverCode} onChange={(e) => setServerCode(e.target.value)} maxLength={10} />
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? '처리 중...' : '가입하기'}</button>
            <p className="auth-switch">이미 계정이 있으신가요? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setError(''); }}>로그인</a></p>
          </form>
        )}

        {/* 개발용 빠른 로그인 */}
        <details className="modal-dev-section" style={{ marginTop: '1rem' }}>
          <summary className="modal-dev-summary">🔧 DEV 빠른 로그인</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.5rem' }}>
            {DEV_ACCOUNTS.map((acc) => (
              <button key={acc.nickname} className="btn dev-login-btn" onClick={() => devLogin(acc)} disabled={loading}>
                {acc.label}
              </button>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
