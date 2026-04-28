import { useEffect } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { api, disconnectSocket } from '../../api';

const ALLIANCE_COLORS = {
  KOR: '#3b82f6', NSL: '#22c55e', JKY: '#a855f7',
  GPX: '#f97316', UFO: '#ec4899',
};

/**
 * UserPopover — Icon Rail 의 사용자 아바타 클릭 시 표시되는 팝오버.
 *
 * 닫기:
 *  - 외부 클릭 (부모가 등록한 document click 핸들러로 처리, e.stopPropagation으로 보호)
 *  - 로그아웃 후 자동 unmount (currentUser=null)
 *  - Escape 키
 */
export default function UserPopover({ onClose }) {
  const { t } = useI18n();
  const user = useStore((s) => s.user);
  const clearUser = useStore((s) => s.clearUser);

  // Escape로 닫기
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!user) return null;

  const am = ALLIANCE_COLORS[user.allianceName] || '#64748b';
  const roleLabel = {
    developer: t('roleDeveloper'),
    admin:     t('roleAdmin'),
    member:    t('roleUser'),
  }[user.role] || t('roleUser');

  async function handleLogout() {
    disconnectSocket();
    await api.logout().catch(() => { /* 무시 — 이미 만료된 세션 등 */ });
    clearUser();
    onClose?.();
  }

  return (
    <div
      className="user-popover"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={user.nickname}
    >
      <div className="user-pop-head">
        <div className="rail-user user-pop-avatar" style={{ background: am }}>
          {(user.nickname || '??').slice(0, 2).toUpperCase()}
        </div>
        <div className="user-pop-info">
          <span className="user-pop-name">{user.nickname}</span>
          <span className="user-pop-sub">
            {user.allianceName}{user.serverCode ? ` · # ${user.serverCode}` : ''}
          </span>
        </div>
      </div>
      <div className="user-pop-row">
        <span>{t('popoverRole')}</span>
        <span className="user-pop-value">
          {user.isLeader && '★ '}{roleLabel}
        </span>
      </div>
      {user.serverCode && (
        <div className="user-pop-row">
          <span>{t('popoverServer')}</span>
          <span className="user-pop-value"># {user.serverCode}</span>
        </div>
      )}
      <div className="user-pop-actions">
        <button className="btn-danger" onClick={handleLogout}>
          ↪ {t('logout')}
        </button>
      </div>
    </div>
  );
}
