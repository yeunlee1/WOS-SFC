/* chat.jsx — full-page chat tab (ChatTab) + dockable chat (ChatDock) */
const { useState, useRef, useEffect } = React;

function ChatMsgList({ messages, autoTranslate, dense }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);
  return (
    <div className="chat-msgs" ref={scrollRef}>
      {messages.map(m => {
        if (m.system) return <div key={m.id} className="chat-system">— {m.text} —</div>;
        const meta = window.WOS.allianceMeta(m.alliance);
        const initials = (m.nickname || '??').slice(0, 2).toUpperCase();
        return (
          <div key={m.id} className="chat-msg">
            <div className="chat-msg-avatar" style={{ background: meta.color }}>{initials}</div>
            <div className="chat-msg-body">
              <div className="chat-msg-head">
                <span className="chat-msg-nick">{m.nickname}</span>
                <span className="chat-msg-time">{window.WOS.fmtTime(m.createdAt)}</span>
              </div>
              <p className="chat-msg-text">{m.text}</p>
              {autoTranslate && m.textEn && m.textEn !== m.text && (
                <div className="chat-msg-tr">→ {m.textEn}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChatComposer({ lang, onSend }) {
  const t = window.WOS.I18N[lang];
  const [text, setText] = useState('');
  function send() {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  }
  return (
    <div className="chat-input-row">
      <input
        className="input"
        placeholder={t.chatPlaceholder}
        value={text}
        onChange={e=>setText(e.target.value)}
        onKeyDown={e=>{ if (e.key === 'Enter') send(); }}
      />
      <button className="btn-primary" onClick={send}>▶</button>
    </div>
  );
}

// Dockable chat (right side panel)
function ChatDock({ lang, currentUser, messages, onlineUsers, onSend, autoTranslate, onToggleTranslate, onClose, floating }) {
  const t = window.WOS.I18N[lang];
  return (
    <aside className={'chat-dock' + (floating ? ' is-floating' : '')}>
      <div className="chat-dock-head">
        <span className="chat-dock-title">// {t.tabChat.toUpperCase()}</span>
        <span className="chat-online-pill">{onlineUsers.length} {lang==='ko'?'온라인':'online'}</span>
        <button className="chat-dock-close" onClick={onClose} title={lang==='ko'?'닫기':'close'}>×</button>
      </div>
      <div className="chat-online-strip">
        {onlineUsers.slice(0, 12).map(u => {
          const meta = window.WOS.allianceMeta(u.alliance);
          const initials = (u.nickname || '??').slice(0, 2).toUpperCase();
          return (
            <div key={u.id} className="chat-online-avatar" style={{ background: meta.color }} title={u.nickname + ' · ' + u.alliance}>
              {initials}
            </div>
          );
        })}
      </div>
      <ChatMsgList messages={messages} autoTranslate={autoTranslate}/>
      <div style={{padding: '0 12px', display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--text-2)', borderTop:'1px solid var(--line)', height: 32, fontFamily:'JetBrains Mono', letterSpacing:'0.1em'}}>
        <input type="checkbox" checked={autoTranslate} onChange={onToggleTranslate} style={{accentColor:'var(--ice-2)'}}/>
        <span>{t.autoTranslate.toUpperCase()}</span>
      </div>
      <ChatComposer lang={lang} onSend={onSend}/>
    </aside>
  );
}

// Full-page chat (when user navigates to chat tab)
function ChatTab({ lang, currentUser, messages, onlineUsers, onSend, autoTranslate, onToggleTranslate }) {
  const t = window.WOS.I18N[lang];
  return (
    <div className="view-pad" style={{display:'flex', flexDirection:'column', height:'100%'}}>
      <h2 className="view-title">// {t.tabChat}</h2>
      <p className="view-subtitle">{lang==='ko'?'동맹 전체 실시간 대화':'Realtime alliance-wide channel'}</p>

      <div style={{flex:1, display:'grid', gridTemplateColumns: '1fr 240px', gap: 16, minHeight: 0}}>
        <div style={{display:'flex', flexDirection:'column', minHeight: 0, background:'rgba(7,16,30,0.5)', border:'1px solid var(--line)', borderRadius: 10, overflow:'hidden'}}>
          <div style={{padding:'10px 14px', borderBottom:'1px solid var(--line)', display:'flex', alignItems:'center', gap:10}}>
            <span style={{fontFamily:'JetBrains Mono', fontSize:11, letterSpacing:'0.15em', color:'var(--ice-1)'}}># GENERAL</span>
            <span className="chat-online-pill">{onlineUsers.length} {lang==='ko'?'온라인':'online'}</span>
            <span style={{flex:1}}/>
            <label style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:11,color:'var(--text-2)',fontFamily:'JetBrains Mono',letterSpacing:'0.1em'}}>
              <input type="checkbox" checked={autoTranslate} onChange={onToggleTranslate} style={{accentColor:'var(--ice-2)'}}/>
              {t.autoTranslate}
            </label>
          </div>
          <ChatMsgList messages={messages} autoTranslate={autoTranslate}/>
          <ChatComposer lang={lang} onSend={onSend}/>
        </div>

        <div style={{background:'rgba(7,16,30,0.5)', border:'1px solid var(--line)', borderRadius: 10, padding: 14, overflow:'auto'}}>
          <div className="section-title" style={{marginBottom: 10}}>{t.online} · {onlineUsers.length}</div>
          {window.WOS.ALLIANCES.map(a => {
            const us = onlineUsers.filter(u => u.alliance === a.code);
            if (us.length === 0) return null;
            return (
              <div key={a.code} style={{marginBottom: 12}}>
                <div style={{display:'flex',alignItems:'center',gap:6, fontFamily:'JetBrains Mono', fontSize:10, letterSpacing:'0.15em', color:'var(--text-2)', marginBottom: 4}}>
                  <span style={{width:8,height:8,borderRadius:'50%',background:a.color}}/>
                  {a.name} · {us.length}
                </div>
                {us.map(u => (
                  <div key={u.id} style={{display:'flex',alignItems:'center',gap:8, padding:'4px 6px', borderRadius:4, fontSize:12, color:'var(--ice-0)'}}>
                    <span style={{width:6,height:6,borderRadius:'50%',background:'var(--green)', boxShadow:'0 0 4px var(--green)'}}/>
                    {u.nickname}
                    {u.isLeader && <span style={{fontSize:9,color:'var(--warn)'}}>★</span>}
                    {u.id === currentUser.id && <span style={{fontSize:9,color:'var(--ice-2)',marginLeft:'auto'}}>YOU</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

window.ChatTab = ChatTab;
window.ChatDock = ChatDock;
