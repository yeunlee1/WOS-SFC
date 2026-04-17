import { useStore, ALLIANCES } from '../../store';

const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#ec4899',
};

const ROLE_ORDER = { developer: 0, admin: 1, member: 2 };

function roleIcon(role) {
  if (role === 'developer') return '👑';
  if (role === 'admin') return '⚡';
  return '';
}

export default function OnlinePanel({ style, isOpen }) {
  const onlineUsers = useStore((s) => s.onlineUsers);

  // 연맹별 그룹 + 역할 정렬
  const groups = ALLIANCES.map((alliance) => {
    const users = onlineUsers
      .filter((u) => u.alliance === alliance)
      .sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3));
    return { alliance, users };
  }).filter((g) => g.users.length > 0); // 0명 연맹 제외

  return (
    <aside className={`online-panel${isOpen ? ' online-panel--open' : ''}`} style={style}>
      <div className="online-panel-header">
        <span className="online-panel-server">🌐 2677</span>
        <span className="online-panel-total">{onlineUsers.length}명</span>
      </div>

      <div className="online-panel-body">
        {groups.length === 0 ? (
          <span className="online-panel-empty">접속자 없음</span>
        ) : (
          groups.map(({ alliance, users }) => (
            <div key={alliance} className="online-alliance-group">
              <div className="online-alliance-label">
                <span
                  className="online-alliance-dot"
                  style={{ background: ALLIANCE_COLORS[alliance] || '#64748b' }}
                />
                <span className="online-alliance-name">{alliance}</span>
                <span className="online-alliance-count">{users.length}</span>
              </div>
              <ul className="online-user-list">
                {users.map((u) => (
                  <li key={u.nickname} className="online-user-item">
                    {roleIcon(u.role) && (
                      <span className="online-user-icon">{roleIcon(u.role)}</span>
                    )}
                    <span className="online-user-nick">{u.nickname}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
