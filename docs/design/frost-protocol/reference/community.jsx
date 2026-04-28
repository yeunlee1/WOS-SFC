/* community.jsx — notices + alliance boards */
const { useState } = React;

function CommunityTab({ lang, currentUser, notices, posts, onAddNotice, onAddPost, onDelete }) {
  const t = window.WOS.I18N[lang];
  const [view, setView] = useState('notices'); // notices | board
  const [allianceTab, setAllianceTab] = useState(currentUser?.alliance || 'KOR');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(false);

  const canPost = currentUser && (
    view === 'notices'
      ? (currentUser.role === 'admin' || currentUser.role === 'developer' || currentUser.isLeader)
      : true
  );

  function submit() {
    if (!title || !body) return;
    if (view === 'notices') {
      onAddNotice({ title, body, pinned: pin });
    } else {
      onAddPost(allianceTab, { title, body });
    }
    setTitle(''); setBody(''); setPin(false); setComposing(false);
  }

  const list = view === 'notices'
    ? [...notices].sort((a,b) => (b.pinned?1:0) - (a.pinned?1:0) || b.createdAt - a.createdAt)
    : (posts[allianceTab] || []).slice().sort((a,b) => b.createdAt - a.createdAt);

  return (
    <div style={{maxWidth: 900}}>
      <div className="sub-tab-nav">
        <button className={'sub-tab-btn'+(view==='notices'?' active':'')} onClick={()=>{setView('notices'); setComposing(false);}}>📌 {t.notices}</button>
        <button className={'sub-tab-btn'+(view==='board'?' active':'')} onClick={()=>{setView('board'); setComposing(false);}}>💬 {t.board}</button>
      </div>

      {view === 'board' && (
        <div className="sub-tab-nav sub-tab-nav--secondary">
          {window.WOS.ALLIANCES.map(a => (
            <button key={a.code} className={'sub-tab-btn' + (allianceTab===a.code?' active':'')} onClick={()=>setAllianceTab(a.code)}>
              <span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:a.color,marginRight:6,verticalAlign:'middle'}}/>
              {a.name}
            </button>
          ))}
        </div>
      )}

      {canPost && !composing && (
        <button className="btn btn-ghost" onClick={()=>setComposing(true)} style={{marginBottom: 14}}>
          ✎ {view==='notices' ? (lang==='ko'?'새 공지':'New notice') : t.write}
        </button>
      )}

      {composing && (
        <div className="compose-card">
          <input className="input" placeholder={t.title} value={title} onChange={e=>setTitle(e.target.value)}/>
          <textarea className="input" placeholder={t.body} value={body} onChange={e=>setBody(e.target.value)} rows={4}/>
          <div style={{display:'flex',gap:8,alignItems:'center', marginTop: 8}}>
            {view==='notices' && (
              <label style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,color:'var(--text-2)'}}>
                <input type="checkbox" checked={pin} onChange={e=>setPin(e.target.checked)}/>
                📌 {t.pin}
              </label>
            )}
            <span className="spacer"/>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setComposing(false); setTitle(''); setBody('');}}>{t.cancel}</button>
            <button className="btn btn-primary btn-sm" onClick={submit}>{t.post}</button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty-message">{lang==='ko'?'아직 게시물이 없습니다':'No posts yet'}</div>
      ) : list.map(p => (
        <div key={p.id} className="post-card">
          <div className="post-card-head">
            {p.pinned && <span className="post-pin">📌 PIN</span>}
            <span className="post-author">{p.author}</span>
            <span className="post-meta">{window.WOS.fmtAgo(p.createdAt, lang)}</span>
            {currentUser && (currentUser.role === 'developer' || currentUser.id === p.authorId) && (
              <button className="btn btn-danger btn-sm" onClick={()=>onDelete(view, allianceTab, p.id)}>×</button>
            )}
          </div>
          <div className="post-title">{p.title}</div>
          <div className="post-body">{p.body}</div>
        </div>
      ))}
    </div>
  );
}

window.CommunityTab = CommunityTab;
