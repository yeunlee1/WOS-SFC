/* battle.jsx — Command-console battle: huge countdown + member timeline + rally strip */
const { useState, useEffect, useRef, useMemo } = React;

function speakNumber(n, vol, lang) {
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(String(n));
    u.lang = lang === 'ko' ? 'ko-KR' : 'en-US';
    u.volume = vol;
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch(e) {}
}

// alliance-color avatar
function Avatar({ name, alliance, size = 32 }) {
  const meta = window.WOS.allianceMeta(alliance || 'KOR');
  const initials = (name || '??').slice(0, 2).toUpperCase();
  return (
    <div className="tl-avatar" style={{ width: size, height: size, background: meta.color, fontSize: size * 0.36 }}>
      {initials}
    </div>
  );
}

function CdDial({ value, total }) {
  // 21 ticks: now-10 .. now .. now+10 (clamped)
  const ticks = [];
  const span = 10;
  for (let i = -span; i <= span; i++) {
    const at = value - i; // upcoming seconds
    if (at < 0 || at > total) {
      ticks.push({ key: i, cls: 'cd-tick passed' });
      continue;
    }
    let cls = 'cd-tick';
    if (i === 0) {
      cls += value <= 5 ? ' now danger' : value <= 10 ? ' now warn' : ' now';
    } else if (at % 5 === 0) {
      cls += ' major';
    }
    if (i < 0) cls += ' passed';
    ticks.push({ key: i, cls });
  }
  return (
    <div className="cd-dial">
      {ticks.map(t => <div key={t.key} className={t.cls} />)}
    </div>
  );
}

function BattleStage({ lang, currentUser, ttsVolume, ttsEnabled }) {
  const t = window.WOS.I18N[lang];
  const [total, setTotal] = useState(20);
  const [value, setValue] = useState(20);
  const [running, setRunning] = useState(false);
  const [members, setMembers] = useState([
    { id: 'm1', name: 'Glacier',   alliance: 'KOR', march: 18, arrival: 25 },
    { id: 'm2', name: 'Tundra',    alliance: 'NSL', march: 15, arrival: 22 },
    { id: 'm3', name: 'IceShard',  alliance: 'JKY', march: 20, arrival: 28 },
    { id: 'm4', name: 'Permafrost',alliance: 'JKY', march: 12, arrival: 19 },
  ]);
  const [newMember, setNewMember] = useState({ name: '', march: '', arrival: '' });
  const [rallies, setRallies] = useState([
    { id: 'r1', name: 'Rally Alpha', total: 30, value: 24 },
    { id: 'r2', name: 'Rally Bravo', total: 45, value: 12 },
    { id: 'r3', name: 'Rally Delta', total: 60, value: 4 },
    { id: 'r4', name: 'Rally Echo',  total: 90, value: 47 },
  ]);
  const lastSpoken = useRef(null);

  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'developer' || currentUser.isLeader);

  // tick countdown
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setValue(v => {
        if (v <= 0) { setRunning(false); return 0; }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  // tts
  useEffect(() => {
    if (!running || !ttsEnabled) return;
    if (value <= 10 && value > 0 && lastSpoken.current !== value) {
      lastSpoken.current = value;
      speakNumber(value, ttsVolume, lang);
    }
  }, [value, running, ttsEnabled, ttsVolume, lang]);

  // tick rallies
  useEffect(() => {
    const id = setInterval(() => {
      setRallies(rs => rs.map(r => ({ ...r, value: r.value > 0 ? r.value - 1 : r.total })));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // keyboard shortcuts: space toggle, R reset
  useEffect(() => {
    function handler(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (!isAdmin) return;
      if (e.key === ' ') {
        e.preventDefault();
        setRunning(r => !r);
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setRunning(false);
        setValue(total);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isAdmin, total]);

  function start() { setRunning(true); }
  function stop() { setRunning(false); }
  function reset() { setRunning(false); setValue(total); }
  function applyTotal(n) { setTotal(n); setValue(n); setRunning(false); }

  function addMember() {
    if (!newMember.name || !newMember.march || !newMember.arrival) return;
    setMembers([...members, {
      id: 'm' + Date.now(),
      name: newMember.name,
      alliance: currentUser ? currentUser.alliance : 'KOR',
      march: Number(newMember.march),
      arrival: Number(newMember.arrival),
    }]);
    setNewMember({ name: '', march: '', arrival: '' });
  }
  function delMember(id) { setMembers(members.filter(m => m.id !== id)); }

  // dispatch time: when do they need to march? difference (arrival - march) before T-0.
  // dispatchAt = value - (arrival - march) → seconds remaining until they should march.
  const sortedMembers = useMemo(() => {
    return [...members].map(m => {
      const lead = m.arrival - m.march; // how many seconds before T-0 they should march
      const dispatchAt = value - lead;
      return { ...m, dispatchAt, lead };
    }).sort((a,b) => a.dispatchAt - b.dispatchAt);
  }, [members, value]);

  // status label / color for the giant number
  let cdCls = 'cd-mega';
  if (value > 0 && value <= 5) cdCls += ' danger';
  else if (value > 0 && value <= 10) cdCls += ' warn';

  const statusText = !running && value === total ? t.waiting : value === 0 ? t.finished : t.active;
  const statusActive = running && value > 0;
  const statusDanger = value > 0 && value <= 5 && running;

  // arc background
  const arcSize = 600;
  const arcR = 240;
  const arcC = 2 * Math.PI * arcR;
  const arcPct = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const arcOffset = arcC * (1 - arcPct);

  return (
    <div className="battle-stage">
      {/* HUGE COUNTDOWN PANEL */}
      <div className="bs-panel">
        <div className="cd-hero">
          <div className="cd-hero-head">
            <span className={'cd-hero-tag' + (statusActive ? ' active' : '') + (statusDanger ? ' danger' : '')}>
              {statusText.toUpperCase()}
            </span>
            <span>T · {total}{t.sec}</span>
          </div>

          <div className="cd-arc-bg">
            <svg viewBox={`0 0 ${arcSize} ${arcSize}`}>
              <defs>
                <linearGradient id="arcGrad" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="#a8e6ff" stopOpacity="0.4"/>
                  <stop offset="100%" stopColor="#3a78ff" stopOpacity="0.05"/>
                </linearGradient>
              </defs>
              <circle cx={arcSize/2} cy={arcSize/2} r={arcR}
                fill="none" stroke="rgba(124,220,255,0.06)" strokeWidth="2"/>
              <circle cx={arcSize/2} cy={arcSize/2} r={arcR}
                fill="none"
                stroke={value <= 5 ? '#f87171' : value <= 10 ? '#fbbf24' : 'url(#arcGrad)'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={arcC}
                strokeDashoffset={arcOffset}
                transform={`rotate(-90 ${arcSize/2} ${arcSize/2})`}
                style={{ transition: 'stroke-dashoffset 0.3s linear', filter: 'drop-shadow(0 0 12px currentColor)' }}/>
            </svg>
          </div>

          <div className={cdCls}>{value}</div>
          <CdDial value={value} total={total}/>

          <div className="cd-controls">
            <div className="cd-presets">
              {[10,20,30,60,120].map(n => (
                <button key={n} className={'cd-preset-btn' + (total===n?' selected':'')} onClick={()=>applyTotal(n)} disabled={!isAdmin}>{n}{t.sec}</button>
              ))}
            </div>
            <div className="cd-input-row">
              <input className="input" type="number" min="1" max="600" value={total} onChange={e=>applyTotal(Number(e.target.value)||1)} disabled={!isAdmin}/>
              {!running ? (
                <button className="btn btn-primary" onClick={start} disabled={!isAdmin || value===0}>▶ {t.start}</button>
              ) : (
                <button className="btn btn-danger" onClick={stop}>■ {t.stop}</button>
              )}
              <button className="btn btn-ghost" onClick={reset} disabled={!isAdmin}>↺</button>
            </div>
            {!isAdmin && <p className="cd-disabled-msg">{t.onlyAdmin}</p>}
          </div>

          <div className="cd-key-hint">
            <span><kbd>SPACE</kbd> {lang==='ko'?'시작/정지':'play/pause'}</span>
            <span><kbd>R</kbd> {lang==='ko'?'초기화':'reset'}</span>
          </div>
        </div>
      </div>

      {/* MEMBER TIMELINE PANEL */}
      <div className="bs-panel bs-panel-pad">
        <div className="member-section">
          <div className="section-head">
            <h3 className="section-title">⚔ {t.personal}</h3>
            <span className="section-count">{members.length} {lang==='ko'?'명':'units'}</span>
          </div>

          <div className="member-add">
            <input className="input" placeholder={t.nickname} value={newMember.name} onChange={e=>setNewMember({...newMember, name: e.target.value})}/>
            <input className="input" type="number" placeholder={t.march} value={newMember.march} onChange={e=>setNewMember({...newMember, march: e.target.value})}/>
            <input className="input" type="number" placeholder={t.arrival} value={newMember.arrival} onChange={e=>setNewMember({...newMember, arrival: e.target.value})}/>
            <button className="btn-ghost" onClick={addMember}>+ {t.add}</button>
          </div>

          <div className="timeline">
            {sortedMembers.length === 0 ? (
              <div className="timeline-empty">{t.noMembers}</div>
            ) : sortedMembers.map(m => {
              // bar represents lead time relative to total (longer lead = wider bar, marching from right)
              const maxLead = Math.max(20, ...sortedMembers.map(x => x.lead));
              const widthPct = (m.lead / maxLead) * 100;
              const isImminent = m.dispatchAt > 0 && m.dispatchAt <= 3;
              const isDispatched = m.dispatchAt <= 0;
              let barCls = 'tl-bar';
              if (isDispatched) barCls += ' dispatched';
              else if (isImminent) barCls += ' imminent';

              // marker now position (within bar)
              const nowPosPct = m.dispatchAt > 0 && m.dispatchAt < m.lead ? ((m.lead - m.dispatchAt) / m.lead) * 100 : null;

              let dispCls = 'tl-disp';
              if (isDispatched) dispCls += ' past';
              else if (m.dispatchAt <= 3) dispCls += ' danger';
              else if (m.dispatchAt <= 8) dispCls += ' warn';

              let rowCls = 'timeline-row';
              if (isImminent) rowCls += ' is-now';
              if (isDispatched) rowCls += ' is-past';

              return (
                <div key={m.id} className={rowCls}>
                  <Avatar name={m.name} alliance={m.alliance} size={32}/>
                  <div className="tl-bar-wrap">
                    <div className={barCls} style={{ width: widthPct + '%' }}>
                      {m.lead}{t.sec}
                    </div>
                    {nowPosPct !== null && (
                      <div className="tl-marker-now" style={{ left: nowPosPct + '%' }}/>
                    )}
                  </div>
                  <div className={dispCls}>
                    {isDispatched ? (lang==='ko'?'출정':'GO') : `T-${m.dispatchAt}${t.sec}`}
                  </div>
                  <button className="tl-del" onClick={()=>delMember(m.id)}>×</button>
                </div>
              );
            })}
          </div>

          <div style={{paddingTop: 12, marginTop: 'auto', borderTop: '1px solid var(--line)'}}>
            <div className="tl-name" style={{flexDirection:'row', gap: 8, fontSize: 11, color: 'var(--text-3)'}}>
              <span><strong style={{color:'var(--ice-1)'}}>{t.march}</strong> {lang==='ko'?'= 행군 시간(초)':'= march duration (s)'}</span>
              <span><strong style={{color:'var(--ice-1)'}}>{t.arrival}</strong> {lang==='ko'?'= 도착 목표(초)':'= arrival target (s)'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* RALLY STRIP */}
      <div className="rally-strip">
        <div className="rally-strip-head">
          <div>
            <h3 className="section-title">🛡 {t.rally}</h3>
          </div>
          <span className="section-count">{rallies.length} {lang==='ko'?'개 진행중':'active'}</span>
        </div>
        <div className="rally-chips">
          {rallies.length === 0 ? <div className="empty-message" style={{padding:12}}>{t.noRallies}</div> : rallies.map(r => {
            const danger = r.value > 0 && r.value <= 5;
            const warn = r.value > 5 && r.value <= 10;
            const cls = danger ? 'danger' : warn ? 'warn' : '';
            const numCls = danger ? 'danger' : warn ? 'warn' : '';
            const pct = (r.value / r.total) * 100;
            return (
              <div key={r.id} className={'rally-chip ' + cls}>
                <span className={'rally-chip-num ' + numCls}>{r.value}</span>
                <span className="rally-chip-name">{r.name}</span>
                <div className="rally-chip-bar"><div style={{ width: pct + '%' }}/></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

window.BattleStage = BattleStage;
window.BattleTab = BattleStage; // back-compat
