// 작전판 저장본 목록과 관리 동작을 제공한다.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useStore } from '../../store';
import { canManageOperationBoard } from './operationBoardTypes';

export default function OperationBoardSavedList({ onLoad, refreshKey = 0 }) {
  const user = useStore((s) => s.user);
  const canManage = canManageOperationBoard(user);
  const [boards, setBoards] = useState([]);

  async function refresh() {
    setBoards(await api.listOperationBoards());
  }

  useEffect(() => {
    refresh().catch(() => setBoards([]));
  }, [refreshKey]);

  async function rename(board) {
    const title = window.prompt('새 이름', board.title);
    if (!title?.trim()) return;
    await api.renameOperationBoard(board.id, { title });
    await refresh();
  }

  async function remove(board) {
    if (!window.confirm('저장본을 삭제하시겠습니까?')) return;
    await api.deleteOperationBoard(board.id);
    await refresh();
  }

  return (
    <section className="operation-panel-section">
      <h3>저장본</h3>
      <div className="operation-saved-list">
        {boards.length === 0 && (
          <span className="operation-muted">저장된 작전판이 없습니다.</span>
        )}
        {boards.map((board) => (
          <div key={board.id} className="operation-saved-row">
            <button type="button" onClick={() => onLoad(board)} disabled={!canManage}>
              {board.title}
            </button>
            {canManage && (
              <>
                <button type="button" onClick={() => rename(board)}>이름</button>
                <button type="button" onClick={() => remove(board)}>삭제</button>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
