import { useStore } from '../../store';
import { useI18n } from '../../i18n';

const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#ec4899',
};

function roleIcon(role) {
  if (role === 'developer') return '👑';
  if (role === 'admin') return '⚡';
  return '';
}

export default function OnlineList() {
  const { onlineUsers } = useStore();
  const { t } = useI18n();

  return (
    <div className="dashboard-panel">
      <div className="section-header">
        <h2>{t('onlineUsers')}</h2>
        <span className="online-count">{onlineUsers.length}명</span>
        <span className="section-desc">{t('onlineUsersDesc')}</span>
      </div>
      <div className="online-list">
        {onlineUsers.length === 0 ? (
          <span className="empty-text">접속 중인 유저가 없습니다</span>
        ) : (
          onlineUsers.map((u) => (
            <div key={u.nickname} className="online-chip">
              <span className="chip-alliance" style={{ background: ALLIANCE_COLORS[u.alliance] || '#64748b' }}>{u.alliance}</span>
              <span className="chip-nickname">{u.nickname}</span>
              {roleIcon(u.role) && <span className="chip-role">{roleIcon(u.role)}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
