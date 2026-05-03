/* auth.jsx — login + signup modal with dev quick login */
const { useState } = React;

function AuthModal({ lang, onLogin, onSignup, users, onError }) {
  const t = window.WOS.I18N[lang];
  const [mode, setMode] = useState('login');
  const [nick, setNick] = useState('');
  const [pw, setPw] = useState('');
  const [server, setServer] = useState('1234');
  const [alliance, setAlliance] = useState('KOR');
  const [err, setErr] = useState('');

  function submit() {
    setErr('');
    if (mode === 'login') {
      if (!nick || !pw) return setErr(t.fillAll);
      const u = users.find(x => x.nickname === nick && x.password === pw);
      if (!u) return setErr(t.incorrect);
      onLogin(u);
    } else {
      if (!nick || !pw || !server || !alliance) return setErr(t.fillAll);
      if (users.some(u => u.nickname === nick)) return setErr(lang==='ko'?'이미 사용 중인 닉네임':'Nickname taken');
      onSignup({ nickname: nick, password: pw, server: Number(server), alliance, role: 'member', isLeader: false });
    }
  }

  function quickLogin(u) { onLogin(u); }

  const devUsers = users.filter(u => ['u1','u2','u4','u6','u8','u9'].includes(u.id));

  return (
    <div className="auth-modal-wrap">
      <div className="auth-modal">
        <div className="auth-modal-head">
          <div className="auth-modal-mark">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path d="M12 2 L12 22 M2 12 L22 12 M5 5 L19 19 M19 5 L5 19" stroke="#a8e6ff" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="12" cy="12" r="3" stroke="#a8e6ff" strokeWidth="1.5"/>
            </svg>
          </div>
          <h2>{t.appTitle}</h2>
          <p className="auth-subtitle">FROST PROTOCOL · {lang==='ko'?'얼어붙은 전장':'FROZEN BATTLEFIELD'}</p>
        </div>

        <div className="auth-tabs">
          <button className={'auth-tab' + (mode==='login'?' active':'')} onClick={()=>setMode('login')}>{t.login}</button>
          <button className={'auth-tab' + (mode==='signup'?' active':'')} onClick={()=>setMode('signup')}>{t.signup}</button>
        </div>

        <div className="auth-field">
          <label>{t.nickname}</label>
          <input className="input" value={nick} onChange={e=>setNick(e.target.value)} placeholder="IceQueen"/>
        </div>
        <div className="auth-field">
          <label>{t.password}</label>
          <input className="input" type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="••••"/>
        </div>

        {mode==='signup' && (
          <div className="input-grid-2">
            <div className="auth-field">
              <label>{t.server} #</label>
              <input className="input" value={server} onChange={e=>setServer(e.target.value)} placeholder="1234"/>
            </div>
            <div className="auth-field">
              <label>{t.alliance}</label>
              <select className="input" value={alliance} onChange={e=>setAlliance(e.target.value)}>
                {window.WOS.ALLIANCES.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {err && <div className="auth-error">⚠ {err}</div>}

        <button className="btn btn-primary" onClick={submit}>{mode==='login'?t.login:t.signup}</button>
        <p className="auth-switch">
          {mode==='login' ? t.noAccount : t.haveAccount}{' '}
          <a onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?t.signup:t.login}</a>
        </p>

        <div className="auth-dev">
          <div className="auth-dev-title">⚡ {t.devQuickLogin}</div>
          <div className="dev-grid">
            {devUsers.map(u => (
              <button key={u.id} className="dev-btn" onClick={()=>quickLogin(u)}>
                <div style={{fontWeight:700, color:'var(--ice-0)'}}>{u.nickname}</div>
                <div style={{fontSize:9, color:'var(--text-3)', marginTop:2}}>{u.alliance} · {u.role.slice(0,3).toUpperCase()}{u.isLeader?' ★':''}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.AuthModal = AuthModal;
