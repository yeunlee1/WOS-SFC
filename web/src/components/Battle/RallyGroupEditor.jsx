import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { api } from '../../api';
import { formatUser } from '../../utils/formatUser';

export default function RallyGroupEditor({ groupId, onClose }) {
  const group = useStore((s) => s.rallyGroups.find((g) => g.id === groupId));
  const [allUsers, setAllUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listAssignableUsers().then(setAllUsers).catch((e) => setError(e?.message || '사용자 목록 실패'));
  }, []);

  const memberUserIds = useMemo(
    () => new Set((group?.members ?? []).map((m) => m.userId)),
    [group]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allUsers
      .filter((u) => !memberUserIds.has(u.id))
      .filter((u) => !term || u.nickname.toLowerCase().includes(term) || (u.allianceName ?? '').toLowerCase().includes(term));
  }, [allUsers, memberUserIds, search]);

  async function handleAdd(userId) {
    setError(null);
    setBusyId(userId);
    try { await api.addRallyGroupMember(groupId, userId); }
    catch (e) { setError(e?.message || '추가 실패'); }
    finally { setBusyId(null); }
  }

  async function handleRemove(memberId) {
    setError(null);
    setBusyId(memberId);
    try { await api.removeRallyGroupMember(groupId, memberId); }
    catch (e) { setError(e?.message || '삭제 실패'); }
    finally { setBusyId(null); }
  }

  if (!group) return null;

  const sortedMembers = [...(group.members ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div className="rally-modal-backdrop" onClick={onClose}>
      <div className="rally-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rally-modal__header">
          <h3>{group.name} — 집결장 편집</h3>
          <button type="button" className="rally-btn" onClick={onClose}>닫기</button>
        </div>

        {error && <div className="rally-error">{error}</div>}

        <div className="rally-modal__section">
          <h4>현재 집결장 ({sortedMembers.length}/10)</h4>
          <ul className="rally-member-list">
            {sortedMembers.map((m) => (
              <li key={m.id} className="rally-member-row">
                <span className="rally-member-order">{m.orderIndex}번</span>
                <span className="rally-member-name">{formatUser(m.user)}</span>
                <button
                  type="button"
                  className="rally-btn rally-btn--danger"
                  disabled={busyId === m.id}
                  onClick={() => handleRemove(m.id)}
                >
                  제거
                </button>
              </li>
            ))}
            {sortedMembers.length === 0 && <li className="rally-empty-small">없음</li>}
          </ul>
        </div>

        <div className="rally-modal__section">
          <h4>사용자 추가</h4>
          <input
            type="text"
            className="rally-search"
            placeholder="닉네임 또는 연맹 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="rally-user-list">
            {filtered.map((u) => (
              <li key={u.id} className="rally-user-row">
                <span className="rally-member-name">{formatUser(u)}</span>
                <span className="rally-user-role">{u.role}</span>
                <button
                  type="button"
                  className="rally-btn rally-btn--primary"
                  disabled={busyId === u.id || sortedMembers.length >= 10}
                  onClick={() => handleAdd(u.id)}
                >
                  추가
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="rally-empty-small">결과 없음</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
