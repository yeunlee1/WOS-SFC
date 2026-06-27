// 작전판 탭 참여자와 세션 그리기 권한을 표시한다.
import { useStore } from '../../store';
import { canManageOperationBoard } from './operationBoardTypes';

const PRIVILEGED_ROLES = ['admin', 'developer'];

export default function OperationBoardParticipants({ participants, onPermission }) {
  const user = useStore((s) => s.user);
  const canManage = canManageOperationBoard(user);

  return (
    <section className="operation-panel-section">
      <h3>접속 인원 · {participants.length}</h3>
      <div className="operation-participant-list">
        {participants.length === 0 && (
          <span className="operation-muted">현재 작전판을 보고 있는 인원이 없습니다.</span>
        )}
        {participants.map((participant) => {
          const isPrivileged = PRIVILEGED_ROLES.includes(participant.role);
          return (
            <div key={participant.participantId} className="operation-participant-row">
              <span className="operation-participant-name">
                [{participant.alliance}] {participant.nickname}
              </span>
              <span className="operation-badge">{participant.role}</span>
              <span className="operation-badge">{participant.chatOpen ? '채팅 열림' : '채팅 닫힘'}</span>
              <label className="operation-draw-toggle">
                <input
                  type="checkbox"
                  checked={!!participant.canDraw}
                  disabled={!canManage || isPrivileged}
                  onChange={(event) => onPermission(participant.participantId, event.target.checked)}
                />
                그리기
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}
