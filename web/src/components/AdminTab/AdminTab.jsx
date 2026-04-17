import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { api } from '../../api';

// 역할 배지 렌더링 헬퍼
const roleBadge = (role) => {
  const map = {
    developer: { label: '👑 개발자', cls: 'role-badge--developer' },
    admin:     { label: '⚡ 관리자', cls: 'role-badge--admin' },
    member:    { label: '일반',      cls: 'role-badge--member' },
  };
  const { label, cls } = map[role] || map.member;
  return <span className={`role-badge ${cls}`}>{label}</span>;
};

export default function AdminTab() {
  // 현재 로그인 유저
  const user = useStore((s) => s.user);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 유저 목록 불러오기
  async function fetchUsers() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.adminGetUsers();
      setUsers(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []);

  // 역할 변경 (admin ↔ member)
  async function handleRoleChange(targetUser) {
    const newRole = targetUser.role === 'admin' ? 'member' : 'admin';
    try {
      await api.adminSetRole(targetUser.id, newRole);
      await fetchUsers();
    } catch (e) {
      alert(e.message);
    }
  }

  // 유저 밴
  async function handleBan(targetUser) {
    if (!window.confirm(`'${targetUser.nickname}' 유저를 밴하시겠습니까?`)) return;
    try {
      await api.adminBanUser(targetUser.id);
      await fetchUsers();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="admin-tab">
      {/* 헤더 */}
      <div className="admin-header">
        <h2>🛡️ 관리자 패널</h2>
        <button className="btn btn-sm" onClick={fetchUsers}>🔄 새로고침</button>
      </div>

      {/* 로딩 상태 */}
      {loading && <div className="admin-loading">로딩 중...</div>}

      {/* 에러 상태 */}
      {error && (
        <div className="admin-error">
          <span>{error}</span>
          <button className="btn btn-sm" onClick={fetchUsers}>재시도</button>
        </div>
      )}

      {/* 유저 목록 */}
      {!loading && !error && (
        <div className="admin-content">
          {/* 데스크톱: 테이블 */}
          <table className="admin-table">
            <thead>
              <tr>
                <th>닉네임</th>
                <th>연맹</th>
                <th>역할</th>
                <th>가입일</th>
                <th>액션</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.nickname}</td>
                  <td>{u.allianceName}</td>
                  <td>{roleBadge(u.role)}</td>
                  <td>{new Date(u.createdAt).toLocaleDateString('ko-KR')}</td>
                  <td className="admin-actions">
                    {/* developer는 역할 변경 불가 */}
                    {u.role !== 'developer' && (
                      <button
                        className="btn btn-sm"
                        onClick={() => handleRoleChange(u)}
                      >
                        {u.role === 'admin' ? '일반으로' : '관리자로'}
                      </button>
                    )}
                    {/* developer 및 자기 자신은 밴 불가 */}
                    {u.role !== 'developer' && u.id !== user?.id && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleBan(u)}
                      >
                        밴
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 모바일: 카드 목록 */}
          <div className="admin-card-list">
            {users.map((u) => (
              <div key={u.id} className="admin-card">
                <div className="admin-card-top">
                  <span className="admin-card-nickname">{u.nickname}</span>
                  {roleBadge(u.role)}
                </div>
                <div className="admin-card-info">
                  <span>{u.allianceName}</span>
                  <span>{new Date(u.createdAt).toLocaleDateString('ko-KR')}</span>
                </div>
                <div className="admin-card-actions">
                  {/* developer는 역할 변경 불가 */}
                  {u.role !== 'developer' && (
                    <button className="btn btn-sm" onClick={() => handleRoleChange(u)}>
                      {u.role === 'admin' ? '일반으로' : '관리자로'}
                    </button>
                  )}
                  {/* developer 및 자기 자신은 밴 불가 */}
                  {u.role !== 'developer' && u.id !== user?.id && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleBan(u)}>
                      밴
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
