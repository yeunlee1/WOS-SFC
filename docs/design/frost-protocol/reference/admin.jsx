/* admin.jsx — user management */
function AdminTab({ lang, currentUser, users, onSetRole, onToggleLeader, onDelete }) {
  const t = window.WOS.I18N[lang];
  const isDev = currentUser && currentUser.role === 'developer';
  const isLeader = currentUser && currentUser.isLeader;

  // Leader can only manage own alliance, dev can manage all
  const visible = isDev ? users : users.filter(u => u.alliance === currentUser.alliance);

  return (
    <div className="admin-tab">
      <div className="admin-header">
        <h2>👑 {t.userMgmt}</h2>
        <span style={{fontSize:12, color:'var(--text-2)'}}>
          {isDev ? (lang==='ko'?'개발자: 전체 관리':'Developer: full access')
                 : (lang==='ko'?'연맹장: '+currentUser.alliance+' 관리':'Leader: '+currentUser.alliance+' only')}
        </span>
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>{t.nickname}</th>
            <th>{t.alliance}</th>
            <th>{lang==='ko'?'역할':'Role'}</th>
            <th>{lang==='ko'?'액션':'Actions'}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(u => (
            <tr key={u.id}>
              <td>
                <strong style={{color:'var(--ice-0)'}}>{u.nickname}</strong>
                {u.isLeader && <span className="leader-badge">★ {t.leader}</span>}
              </td>
              <td>
                <span className="user-alliance-badge" style={{background: window.WOS.allianceMeta(u.alliance).color}}>{u.alliance}</span>
              </td>
              <td><span className={'role-badge role-badge--'+u.role}>{u.role.toUpperCase()}</span></td>
              <td>
                <div className="admin-actions">
                  {(isDev || (isLeader && u.alliance === currentUser.alliance && u.id !== currentUser.id)) && (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={()=>onToggleLeader(u.id)}>
                        ★ {u.isLeader ? t.unsetLeader : t.setLeader}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>onSetRole(u.id, u.role==='admin'?'member':'admin')}>
                        {u.role==='admin' ? t.demote : t.promote}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={()=>{ if (confirm(lang==='ko'?'정말 삭제?':'Delete?')) onDelete(u.id); }}>
                        × {t.deleteUser}
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile cards */}
      <div className="admin-card-list">
        {visible.map(u => (
          <div key={u.id} className="admin-card">
            <div className="admin-card-top">
              <div>
                <div className="admin-card-nickname">{u.nickname} {u.isLeader && <span className="leader-badge">★</span>}</div>
                <div className="admin-card-info">
                  <span className="user-alliance-badge" style={{background: window.WOS.allianceMeta(u.alliance).color}}>{u.alliance}</span>
                  <span className={'role-badge role-badge--'+u.role}>{u.role.toUpperCase()}</span>
                </div>
              </div>
            </div>
            {(isDev || (isLeader && u.alliance === currentUser.alliance && u.id !== currentUser.id)) && (
              <div className="admin-card-actions">
                <button className="btn btn-ghost btn-sm" onClick={()=>onToggleLeader(u.id)}>★ {u.isLeader ? t.unsetLeader : t.setLeader}</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>onSetRole(u.id, u.role==='admin'?'member':'admin')}>{u.role==='admin' ? t.demote : t.promote}</button>
                <button className="btn btn-danger btn-sm" onClick={()=>{ if (confirm(lang==='ko'?'삭제?':'Delete?')) onDelete(u.id); }}>×</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

window.AdminTab = AdminTab;
