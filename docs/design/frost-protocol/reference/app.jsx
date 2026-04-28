/* app.jsx — Command Console shell with icon rail, command palette (⌘K), chat dock */
const { useState, useEffect, useRef } = React;

// ─── ALLIANCE BADGE LOGO (rail) ───
function RailLogo() {
  return (
    <div className="rail-logo">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M12 2 L12 22 M2 12 L22 12 M5 5 L19 19 M19 5 L5 19" stroke="#a8e6ff" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="12" cy="12" r="3" stroke="#a8e6ff" strokeWidth="1.5"/>
      </svg>
    </div>
  );
}

// ─── COMMAND PALETTE ───
function CommandPalette({ open, onClose, lang, currentUser, allCommands, onRun }) {
  const t = window.WOS.I18N[lang];
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    }
  }, [open]);

  const filtered = allCommands.filter(c => {
    if (!query) return true;
    return c.label.toLowerCase().includes(query.toLowerCase()) ||
           (c.section || '').toLowerCase().includes(query.toLowerCase());
  });

  // group by section
  const grouped = {};
  filtered.forEach(c => {
    const s = c.section || 'OTHER';
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(c);
  });
  const flat = Object.entries(grouped).flatMap(([s, items]) => items);

  function handleKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[active]) { flat[active].run(); onClose(); }
    }
  }

  if (!open) return null;
  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk" onClick={e=>e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder={lang==='ko' ? '명령 검색... (Esc 닫기)' : 'Type a command... (Esc to close)'}
          value={query}
          onChange={e => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={handleKey}
        />
        <div className="cmdk-list">
          {flat.length === 0 ? (
            <div style={{padding: '24px 16px', textAlign:'center', color:'var(--text-3)', fontSize: 13}}>
              {lang==='ko' ? '결과 없음' : 'No results'}
            </div>
          ) : Object.entries(grouped).map(([section, items]) => (
            <div key={section}>
              <div className="cmdk-section">{section}</div>
              {items.map(c => {
                const idx = flat.indexOf(c);
                return (
                  <div
                    key={c.id}
                    className={'cmdk-item' + (idx === active ? ' active' : '')}
                    onMouseEnter={()=>setActive(idx)}
                    onClick={() => { c.run(); onClose(); }}
                  >
                    <div className="cmdk-item-icon">{c.icon}</div>
                    <div className="cmdk-item-label">{c.label}</div>
                    {c.shortcut && (
                      <div className="cmdk-item-shortcut">
                        {c.shortcut.split('+').map((k, i, arr) => (
                          <React.Fragment key={i}>
                            <kbd>{k}</kbd>{i < arr.length - 1 && '+'}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── USER POPOVER (clicking rail user avatar) ───
function UserPopover({ currentUser, lang, onLogout, onClose }) {
  const t = window.WOS.I18N[lang];
  const am = window.WOS.allianceMeta(currentUser.alliance);
  return (
    <div className="user-popover" onClick={e=>e.stopPropagation()}>
      <div className="user-pop-head">
        <div className="rail-user" style={{ background: am.color, position:'relative' }}>
          {currentUser.nickname.slice(0,2).toUpperCase()}
        </div>
        <div className="user-pop-info">
          <span className="user-pop-name">{currentUser.nickname}</span>
          <span className="user-pop-sub">{am.name} · # {currentUser.server}</span>
        </div>
      </div>
      <div className="user-pop-row">
        <span>{lang==='ko'?'역할':'Role'}</span>
        <span style={{color:'var(--ice-1)', fontFamily:'JetBrains Mono', fontSize: 11}}>
          {currentUser.isLeader && '★ '}{currentUser.role.toUpperCase()}
        </span>
      </div>
      <div className="user-pop-row">
        <span>{lang==='ko'?'서버':'Server'}</span>
        <span style={{color:'var(--ice-1)', fontFamily:'JetBrains Mono', fontSize: 11}}># {currentUser.server}</span>
      </div>
      <div className="user-pop-actions">
        <button className="btn-danger" onClick={onLogout}>↪ {t.logout}</button>
      </div>
    </div>
  );
}

function App() {
  const [lang, setLang] = useState('ko');
  const [users, setUsers] = useState(window.WOS.SEED_USERS);
  const [currentUser, setCurrentUser] = useState(null);
  const [tab, setTab] = useState('battle');
  const [notices, setNotices] = useState(window.WOS.SEED_NOTICES);
  const [posts, setPosts] = useState(window.WOS.SEED_POSTS_BY_ALLIANCE);
  const [messages, setMessages] = useState(window.WOS.SEED_CHAT);
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [clock, setClock] = useState(new Date());
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsVolume, setTtsVolume] = useState(0.7);
  const [chatDockOpen, setChatDockOpen] = useState(true);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [userPopOpen, setUserPopOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  const t = window.WOS.I18N[lang];

  useEffect(() => { const id = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(id); }, []);

  // restore session
  useEffect(() => {
    const s = window.WOS.loadState();
    if (s) {
      if (s.lang) setLang(s.lang);
      if (s.currentUserId) {
        const u = window.WOS.SEED_USERS.find(x => x.id === s.currentUserId);
        if (u) setCurrentUser(u);
      }
      if (typeof s.tab === 'string') setTab(s.tab);
      if (typeof s.autoTranslate === 'boolean') setAutoTranslate(s.autoTranslate);
      if (typeof s.ttsVolume === 'number') setTtsVolume(s.ttsVolume);
      if (typeof s.ttsEnabled === 'boolean') setTtsEnabled(s.ttsEnabled);
      if (typeof s.chatDockOpen === 'boolean') setChatDockOpen(s.chatDockOpen);
    }
  }, []);
  useEffect(() => {
    window.WOS.saveState({
      lang, currentUserId: currentUser?.id, tab, autoTranslate, ttsVolume, ttsEnabled, chatDockOpen
    });
  }, [lang, currentUser, tab, autoTranslate, ttsVolume, ttsEnabled, chatDockOpen]);

  // online users
  const onlineUsers = currentUser
    ? users.filter(u => u.id === currentUser.id || ['u2','u4','u5','u6','u8','u9','u10'].includes(u.id))
    : [];

  // login handlers
  function handleLogin(u) { setCurrentUser(u); }
  function handleSignup(data) {
    const newUser = { ...data, id: 'u' + (users.length + 1) };
    setUsers([...users, newUser]);
    setCurrentUser(newUser);
  }
  function handleLogout() {
    setCurrentUser(null);
    setTab('battle');
    setUserPopOpen(false);
  }

  function sendChat(text) {
    setMessages(ms => [...ms, {
      id: 'c' + Date.now(),
      userId: currentUser.id,
      nickname: currentUser.nickname,
      alliance: currentUser.alliance,
      text, textEn: text, createdAt: Date.now(),
    }]);
  }
  function addNotice({ title, body, pinned }) {
    setNotices(ns => [{ id: 'n' + Date.now(), authorId: currentUser.id, author: currentUser.nickname, title, body, pinned, createdAt: Date.now() }, ...ns]);
  }
  function addPost(allianceCode, { title, body }) {
    setPosts(p => ({ ...p, [allianceCode]: [{ id: 'p' + Date.now(), authorId: currentUser.id, author: currentUser.nickname, title, body, createdAt: Date.now() }, ...(p[allianceCode] || [])] }));
  }
  function deletePost(view, allianceCode, id) {
    if (view === 'notices') setNotices(ns => ns.filter(n => n.id !== id));
    else setPosts(p => ({ ...p, [allianceCode]: (p[allianceCode] || []).filter(x => x.id !== id) }));
  }
  function setRole(id, role) { setUsers(us => us.map(u => u.id === id ? { ...u, role } : u)); }
  function toggleLeader(id) { setUsers(us => us.map(u => u.id === id ? { ...u, isLeader: !u.isLeader } : u)); }
  function deleteUser(id) { setUsers(us => us.filter(u => u.id !== id)); }

  // global keyboard shortcuts
  useEffect(() => {
    function handler(e) {
      // ⌘K / Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen(o => !o);
        return;
      }
      // skip if typing
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setChatDockOpen(o => !o);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // close popover on outside click
  useEffect(() => {
    if (!userPopOpen) return;
    function handler() { setUserPopOpen(false); }
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [userPopOpen]);

  if (!currentUser) {
    return (
      <>
        <div className="app-bg"/>
        <window.SnowCanvas/>
        <div className="app-grid-overlay"/>
        <div className="app-vignette"/>
        <window.AuthModal lang={lang} users={users} onLogin={handleLogin} onSignup={handleSignup}/>
        <div style={{position:'fixed', top:16, right:16, zIndex:200}}>
          <select className="lang-select" value={lang} onChange={e=>setLang(e.target.value)}>
            <option value="ko">KO · 한국어</option>
            <option value="en">EN · English</option>
          </select>
        </div>
      </>
    );
  }

  const am = window.WOS.allianceMeta(currentUser.alliance);
  const canAccessAdmin = currentUser.role === 'developer' || currentUser.isLeader;

  const tabs = [
    { id: 'battle',    label: t.tabBattle,    icon: '⚔', tooltip: t.tabBattle },
    { id: 'community', label: t.tabCommunity, icon: '◫', tooltip: t.tabCommunity },
    { id: 'chat',      label: t.tabChat,      icon: '✉', tooltip: t.tabChat },
  ];
  if (canAccessAdmin) tabs.push({ id: 'admin', label: t.tabAdmin, icon: '★', tooltip: t.tabAdmin });

  // Build command palette commands
  const allCommands = [
    ...tabs.map(tb => ({ id: 'goto-'+tb.id, section: lang==='ko'?'이동':'NAVIGATE', icon: tb.icon, label: (lang==='ko'?'이동: ':'Go to: ') + tb.label, run: () => setTab(tb.id) })),
    { id: 'toggle-chat', section: lang==='ko'?'액션':'ACTIONS', icon: '✉', label: lang==='ko'?'채팅 토글':'Toggle chat dock', shortcut: 'C', run: () => setChatDockOpen(o => !o) },
    { id: 'toggle-tts', section: lang==='ko'?'액션':'ACTIONS', icon: ttsEnabled?'🔊':'🔇', label: (lang==='ko'?'TTS ':'TTS ') + (ttsEnabled?'OFF':'ON'), run: () => setTtsEnabled(e => !e) },
    { id: 'toggle-trans', section: lang==='ko'?'액션':'ACTIONS', icon: '⇄', label: lang==='ko'?'자동 번역 토글':'Toggle auto-translate', run: () => setAutoTranslate(a => !a) },
    { id: 'lang-ko', section: lang==='ko'?'언어':'LANGUAGE', icon: 'KO', label: '한국어', run: () => setLang('ko') },
    { id: 'lang-en', section: lang==='ko'?'언어':'LANGUAGE', icon: 'EN', label: 'English', run: () => setLang('en') },
    { id: 'logout', section: lang==='ko'?'세션':'SESSION', icon: '↪', label: t.logout, run: handleLogout },
  ];

  const dockActuallyOpen = chatDockOpen && tab !== 'chat';
  const consoleClass = 'console' + (dockActuallyOpen ? ' console--with-dock' : '');

  return (
    <>
      <div className="app-bg"/>
      <window.SnowCanvas/>
      <div className="app-grid-overlay"/>
      <div className="app-vignette"/>

      <div className={consoleClass}>
        {/* ICON RAIL */}
        <nav className={'rail' + (railOpen ? ' is-open' : '')}>
          <RailLogo/>
          <div className="rail-divider"/>
          {tabs.map(tb => (
            <button
              key={tb.id}
              className={'rail-btn' + (tab===tb.id?' active':'')}
              onClick={() => { setTab(tb.id); setRailOpen(false); }}
              title={tb.tooltip}
            >
              <span>{tb.icon}</span>
              <span className="rail-btn-tooltip">{tb.tooltip}</span>
            </button>
          ))}
          <div className="rail-divider"/>
          <button
            className={'rail-btn' + (chatDockOpen && tab!=='chat' ? ' active' : '')}
            onClick={() => setChatDockOpen(o => !o)}
            title={lang==='ko'?'채팅 도크':'Chat dock'}
          >
            <span>💬</span>
            <span className="rail-btn-tooltip">{lang==='ko'?'채팅 (C)':'Chat (C)'}</span>
          </button>
          <button
            className="rail-btn"
            onClick={() => setCmdkOpen(true)}
            title={lang==='ko'?'명령 (⌘K)':'Command (⌘K)'}
          >
            <span>⌘</span>
            <span className="rail-btn-tooltip">{lang==='ko'?'명령 (⌘K)':'Command (⌘K)'}</span>
          </button>

          <div className="rail-spacer"/>

          {/* User avatar */}
          <button
            className={'rail-user' + (currentUser.isLeader ? ' rail-user-leader' : '')}
            style={{ background: am.color }}
            onClick={(e) => { e.stopPropagation(); setUserPopOpen(o => !o); }}
            title={currentUser.nickname}
          >
            {currentUser.nickname.slice(0,2).toUpperCase()}
          </button>
        </nav>

        {/* CANVAS */}
        <div className="canvas">
          {/* TOPBAR */}
          <div className="topbar">
            <button className="mobile-toggle-rail" onClick={()=>setRailOpen(true)}>☰</button>
            <span className="topbar-title">{t.appTitle}</span>
            <span className="topbar-breadcrumb">
              <span>›</span>
              <span className="topbar-breadcrumb-current">
                {tabs.find(tb => tb.id === tab)?.label}
              </span>
            </span>

            <span className="topbar-spacer"/>

            <span className="world-clock">{window.WOS.fmtClock(clock)}</span>

            <button className="kbd-hint" onClick={()=>setCmdkOpen(true)} title="Command palette">
              <span>{lang==='ko'?'명령':'Cmd'}</span>
              <kbd>⌘K</kbd>
            </button>

            <div className="tts-control" title="TTS">
              <button onClick={()=>setTtsEnabled(!ttsEnabled)} aria-label="tts">{ttsEnabled ? '🔊' : '🔇'}</button>
              <input type="range" min="0" max="1" step="0.1" value={ttsVolume} onChange={e=>setTtsVolume(Number(e.target.value))}/>
            </div>

            <select className="lang-select" value={lang} onChange={e=>setLang(e.target.value)}>
              <option value="ko">KO</option>
              <option value="en">EN</option>
            </select>

            <button
              className={'topbar-icon-btn' + (chatDockOpen && tab !== 'chat' ? ' active' : '')}
              onClick={()=>setChatDockOpen(o => !o)}
              title={lang==='ko'?'채팅 도크 (C)':'Chat dock (C)'}
            >
              ✉
            </button>
          </div>

          {/* STAGE */}
          <div className="stage">
            {tab === 'battle' && (
              <window.BattleStage lang={lang} currentUser={currentUser} ttsEnabled={ttsEnabled} ttsVolume={ttsVolume}/>
            )}
            {tab === 'community' && (
              <div className="view-pad">
                <window.CommunityTab
                  lang={lang} currentUser={currentUser}
                  notices={notices} posts={posts}
                  onAddNotice={addNotice} onAddPost={addPost} onDelete={deletePost}/>
              </div>
            )}
            {tab === 'chat' && (
              <window.ChatTab
                lang={lang} currentUser={currentUser}
                messages={messages} onlineUsers={onlineUsers}
                onSend={sendChat}
                autoTranslate={autoTranslate} onToggleTranslate={()=>setAutoTranslate(!autoTranslate)}/>
            )}
            {tab === 'admin' && canAccessAdmin && (
              <div className="view-pad">
                <window.AdminTab
                  lang={lang} currentUser={currentUser} users={users}
                  onSetRole={setRole} onToggleLeader={toggleLeader} onDelete={deleteUser}/>
              </div>
            )}
          </div>
        </div>

        {/* CHAT DOCK */}
        {dockActuallyOpen && (
          <window.ChatDock
            lang={lang} currentUser={currentUser}
            messages={messages} onlineUsers={onlineUsers}
            onSend={sendChat}
            autoTranslate={autoTranslate} onToggleTranslate={()=>setAutoTranslate(!autoTranslate)}
            onClose={()=>setChatDockOpen(false)}
            floating={false}
          />
        )}
      </div>

      {/* User popover */}
      {userPopOpen && (
        <UserPopover currentUser={currentUser} lang={lang} onLogout={handleLogout} onClose={()=>setUserPopOpen(false)}/>
      )}

      {/* Command palette */}
      <CommandPalette
        open={cmdkOpen}
        onClose={()=>setCmdkOpen(false)}
        lang={lang}
        currentUser={currentUser}
        allCommands={allCommands}
        onRun={(cmd) => cmd.run()}
      />

      {/* Mobile rail overlay */}
      <div className={'mobile-overlay' + (railOpen ? ' is-open' : '')} onClick={()=>setRailOpen(false)}/>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
