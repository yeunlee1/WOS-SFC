import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { api } from '../../api';
import { formatUser } from '../../utils/formatUser';
import RallyGroupEditor from './RallyGroupEditor';
import RallyGroupCountdown from './RallyGroupCountdown';
import { stopRallyCountdown } from './rallyGroupPlayer';

const canAdmin = (role) => role === 'admin' || role === 'developer';

export default function RallyGroupPanel() {
  const user = useStore((s) => s.user);
  const rallyGroups = useStore((s) => s.rallyGroups);
  const setRallyGroups = useStore((s) => s.setRallyGroups);
  const rallyCountdowns = useStore((s) => s.rallyCountdowns);

  const [editingGroupId, setEditingGroupId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState(null);
  const isAdmin = canAdmin(user?.role);

  useEffect(() => {
    api.listRallyGroups().then(setRallyGroups).catch(() => { /* noop */ });
  }, [setRallyGroups]);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      await api.createRallyGroup({ name });
      setNewName('');
      setCreating(false);
    } catch (err) {
      setError(err?.message || '생성 실패');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('그룹을 삭제하시겠습니까?')) return;
    try { await api.deleteRallyGroup(id); }
    catch (err) { setError(err?.message || '삭제 실패'); }
  }

  async function handleStart(id) {
    try { await api.startRallyGroup(id); }
    catch (err) { setError(err?.message || '시작 실패'); }
  }

  async function handleStop(id) {
    stopRallyCountdown(); // 서버 응답 전에 클라이언트에서 즉시 오디오 정지
    try { await api.stopRallyGroup(id); }
    catch (err) { setError(err?.message || '정지 실패'); }
  }

  return (
    <div className="rally-group-panel">
      <div className="rally-group-panel__header">
        <h3>집결 그룹</h3>
        {isAdmin && (
          <button type="button" className="rally-btn rally-btn--primary" onClick={() => setCreating((v) => !v)}>
            {creating ? '취소' : '＋ 새 그룹'}
          </button>
        )}
      </div>

      {creating && (
        <form className="rally-create-form" onSubmit={handleCreate}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="예: 1차행군조"
            maxLength={40}
            autoFocus
          />
          <button type="submit" className="rally-btn rally-btn--primary">만들기</button>
        </form>
      )}

      {error && <div className="rally-error">{error}</div>}

      {rallyGroups.length === 0 && (
        <div className="rally-empty">등록된 집결 그룹이 없습니다.</div>
      )}

      <ul className="rally-group-list">
        {rallyGroups.map((g) => {
          const countdown = rallyCountdowns[g.id];
          const running = g.state === 'running' && !!countdown;
          const sortedMembers = [...(g.members ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);

          return (
            <li key={g.id} className={`rally-group-card ${running ? 'running' : ''}`}>
              <div className="rally-group-card__top">
                <div>
                  <span className="rally-group-card__name">{g.name}</span>
                  <span className={`rally-badge rally-badge--${g.state}`}>{g.state}</span>
                </div>
                {isAdmin && (
                  <div className="rally-group-card__actions">
                    {!running && (
                      <button type="button" className="rally-btn" onClick={() => handleStart(g.id)} disabled={sortedMembers.length === 0}>
                        시작
                      </button>
                    )}
                    {running && (
                      <button type="button" className="rally-btn rally-btn--warn" onClick={() => handleStop(g.id)}>정지</button>
                    )}
                    <button type="button" className="rally-btn" onClick={() => setEditingGroupId(g.id)}>집결장 편집</button>
                    <button type="button" className="rally-btn rally-btn--danger" onClick={() => handleDelete(g.id)}>삭제</button>
                  </div>
                )}
              </div>

              {running ? (
                <RallyGroupCountdown group={g} countdown={countdown} />
              ) : (
                <ul className="rally-member-list">
                  {sortedMembers.map((m) => {
                    const effective = m.marchSecondsOverride ?? m.user?.marchSeconds ?? null;
                    return (
                      <li key={m.id} className="rally-member-row">
                        <span className="rally-member-order">{m.orderIndex}번</span>
                        <span className="rally-member-name">{formatUser(m.user)}</span>
                        <span className="rally-member-march">
                          행군 {effective != null ? `${effective}초` : '미설정'}
                        </span>
                      </li>
                    );
                  })}
                  {sortedMembers.length === 0 && (
                    <li className="rally-empty-small">집결장 없음</li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {editingGroupId && (
        <RallyGroupEditor
          groupId={editingGroupId}
          onClose={() => setEditingGroupId(null)}
        />
      )}
    </div>
  );
}
