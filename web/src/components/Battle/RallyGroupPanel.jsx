import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { api } from '../../api';
import { formatUser } from '../../utils/formatUser';
import RallyGroupEditor from './RallyGroupEditor';
import RallyGroupCountdown from './RallyGroupCountdown';
import { stopRallyCountdown } from './rallyGroupPlayer';
import RallyDots from './RallyDots';

const canAdmin = (role) => role === 'admin' || role === 'developer';
const MAX_GROUPS = 6;
// 행군시간 override 상한 — 서버 DTO @Max(180) (server/src/rally-groups/dto/update-march-override.dto.ts) 와 일치.
const MAX_MARCH_SECONDS = 180;

export default function RallyGroupPanel() {
  const user = useStore((s) => s.user);
  const rallyGroups = useStore((s) => s.rallyGroups);
  const setRallyGroups = useStore((s) => s.setRallyGroups);
  const rallyCountdowns = useStore((s) => s.rallyCountdowns);
  const busyHolder = useStore((s) => s.busyHolder);

  const [editingGroupId, setEditingGroupId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  // 대기 중 그룹에서 편집 중인 멤버 — { memberId, value }
  const [editingOverride, setEditingOverride] = useState(null);
  const [savingOverride, setSavingOverride] = useState(false);
  const isAdmin = canAdmin(user?.role);
  const atMax = rallyGroups.length >= MAX_GROUPS;

  useEffect(() => {
    api.listRallyGroups().then(setRallyGroups).catch(() => { /* noop */ });
  }, [setRallyGroups]);

  async function handleCreate() {
    // 이름은 서버가 displayOrder 기반으로 자동 할당 ("${N}번 집결그룹").
    if (atMax) {
      setError(`공격 카운트 그룹은 최대 ${MAX_GROUPS}개까지만 생성 가능합니다.`);
      return;
    }
    setError(null);
    setCreating(true);
    try {
      await api.createRallyGroup({});
    } catch (err) {
      setError(err?.message || '생성 실패');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('그룹을 삭제하시겠습니까?')) return;
    try { await api.deleteRallyGroup(id); }
    catch (err) {
      setError(err?.message || '삭제 실패');
      setTimeout(() => setError(null), 1500);
    }
  }

  async function handleStart(id) {
    try {
      await api.startRallyGroup(id);
    } catch (err) {
      // 서버 ConflictException 시 err.message가 '다른 카운트다운이 진행 중입니다.' 형태
      // 기타 오류는 일반 메시지
      setError(err?.message || '시작 실패');
      setTimeout(() => setError(null), 1500);
    }
  }

  // 행군시간 override 저장.
  // 검증 규약(빈 값·숫자 아님·범위 밖 → null 로 해제)은 PersonalPanel.handleSave 와 동일하다.
  // RallyGroupCountdown 의 상한 600 은 서버 DTO(@Max(180))가 400 으로 거절하는 값이라 따르지 않았다.
  async function handleSaveOverride(groupId, memberId) {
    const parsed = parseInt(editingOverride?.value ?? '', 10);
    const value =
      Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_MARCH_SECONDS ? parsed : null;
    setError(null);
    setSavingOverride(true);
    try {
      await api.updateRallyMarchOverride(groupId, memberId, value);
      setEditingOverride(null);
    } catch (err) {
      // 진행 중이면 서버가 409 와 사유를 준다 — 조용히 삼키지 않고 그대로 보여준다.
      setError(err?.message || '행군시간 저장 실패');
    } finally {
      setSavingOverride(false);
    }
  }

  async function handleStop(id) {
    stopRallyCountdown(); // 서버 응답 전에 클라이언트에서 즉시 오디오 정지
    try { await api.stopRallyGroup(id); }
    catch (err) {
      setError(err?.message || '정지 실패');
      setTimeout(() => setError(null), 1500);
    }
  }

  return (
    <div className="rally-group-panel">
      <div className="rally-group-panel__header">
        <h3>공격 카운트 ({rallyGroups.length}/{MAX_GROUPS})</h3>
        {isAdmin && (
          <button
            type="button"
            className="rally-btn rally-btn--primary"
            onClick={handleCreate}
            disabled={atMax || creating}
            title={atMax ? `최대 ${MAX_GROUPS}개까지 생성 가능` : ''}
          >
            ＋ 새 그룹
          </button>
        )}
      </div>

      {error && <div className="rally-error">{error}</div>}

      <div className="battle-viz-mobile">
        <RallyDots />
      </div>

      {rallyGroups.length === 0 && (
        <div className="rally-empty">등록된 공격 카운트 그룹이 없습니다.</div>
      )}

      <ul className="rally-group-list">
        {[...rallyGroups].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)).map((g) => {
          const countdown = rallyCountdowns[g.id];
          const running = g.state === 'running' && !!countdown;
          const sortedMembers = [...(g.members ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);
          // 자기 자신 그룹이 lock 잡았다면 running 상태라 시작 버튼이 어차피 안 보임
          const blockedByOther = busyHolder !== null && !(busyHolder.type === 'rally' && busyHolder.groupId === g.id);

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
                      <button type="button" className="rally-btn" onClick={() => handleStart(g.id)} disabled={sortedMembers.length === 0 || blockedByOther}>
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
                    // 서버 가드(RallyMemberSelfOrAdminGuard)와 같은 조건 — 본인 또는 관리자만 편집
                    const canEditMarch = isAdmin || (!!user && m.userId === user.id);
                    const editingThis = editingOverride?.memberId === m.id;
                    // state 가 running 인데 스냅샷이 아직 없으면 이 목록이 그대로 보인다.
                    // 그 상태로 저장하면 서버가 409 로 거절하므로 애초에 누르지 못하게 한다.
                    const lockedByRun = g.state === 'running';
                    return (
                      <li key={m.id} className="rally-member-row">
                        <span className="rally-member-order">{m.orderIndex}번</span>
                        <span className="rally-member-name">{formatUser(m.user)}</span>
                        {editingThis ? (
                          <>
                            <input
                              type="number"
                              className="rally-march-input"
                              value={editingOverride.value}
                              onChange={(e) =>
                                setEditingOverride({ memberId: m.id, value: e.target.value })
                              }
                              min={1}
                              max={MAX_MARCH_SECONDS}
                              aria-label="행군시간(초)"
                              autoFocus
                            />
                            <button
                              type="button"
                              className="rally-btn rally-btn--primary"
                              disabled={savingOverride}
                              onClick={() => handleSaveOverride(g.id, m.id)}
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              className="rally-btn"
                              onClick={() => setEditingOverride(null)}
                            >
                              취소
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="rally-member-march">
                              행군 {effective != null ? `${effective}초` : '미설정'}
                            </span>
                            {canEditMarch && (
                              <button
                                type="button"
                                className="rally-btn"
                                aria-label="행군시간 수정"
                                disabled={lockedByRun}
                                title={lockedByRun ? '카운트다운 진행 중에는 바꿀 수 없습니다' : undefined}
                                onClick={() => {
                                  setError(null);
                                  setEditingOverride({
                                    memberId: m.id,
                                    value: String(effective ?? ''),
                                  });
                                }}
                              >
                                수정
                              </button>
                            )}
                          </>
                        )}
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
