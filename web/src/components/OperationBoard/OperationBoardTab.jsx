// 실시간 작전판 탭의 캔버스와 협업 패널을 구성한다.
import { useState } from 'react';
import { api } from '../../api';
import { useStore } from '../../store';
import OperationBoardCanvas from './OperationBoardCanvas';
import OperationBoardSidePanel from './OperationBoardSidePanel';
import OperationBoardToolbar from './OperationBoardToolbar';
import { useOperationBoardSocket } from './useOperationBoardSocket';
import {
  canManageOperationBoard,
  canUseOperationTools,
  OPERATION_MARKERS,
  sanitizeOperationElements,
} from './operationBoardTypes';

export default function OperationBoardTab() {
  const user = useStore((s) => s.user);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#7dd3fc');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [marker, setMarker] = useState(OPERATION_MARKERS[2]);
  const [sideOpen, setSideOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [status, setStatus] = useState('');
  const socketState = useOperationBoardSocket(chatOpen);

  const canDraw = canUseOperationTools(user, socketState.canDraw);
  const canManage = canManageOperationBoard(user);

  function handleToggleChat() {
    const next = !chatOpen;
    setChatOpen(next);
    socketState.emitChatOpen(next);
  }

  function handleLoadSaved(board) {
    if (!canDraw) return;
    socketState.emitClear();
    socketState.emitBackground({
      type: board.backgroundType || 'grid',
      imageUrl: board.backgroundImageUrl || null,
    });
    sanitizeOperationElements(board.elements || []).forEach(socketState.emitElement);
  }

  async function handleUploadBackground(file) {
    if (!canManage) return;
    try {
      const result = await api.uploadOperationBoardBackground(file);
      if (result?.url) {
        socketState.emitBackground({ type: 'image', imageUrl: result.url });
        setStatus('배경 적용됨');
      }
    } catch (err) {
      setStatus(err.message || '배경 업로드 실패');
    }
  }

  async function handleSave() {
    if (!canManage) return;
    const title = window.prompt('저장 이름', '작전판');
    if (!title?.trim()) return;
    try {
      await api.saveOperationBoard({
        title,
        backgroundType: socketState.background?.type || 'grid',
        backgroundImageUrl: socketState.background?.imageUrl || null,
        elements: sanitizeOperationElements(socketState.elements),
      });
      setStatus('저장됨');
    } catch (err) {
      setStatus(err.message || '저장 실패');
    }
  }

  return (
    <div className="operation-board-tab">
      <header className="operation-board-head">
        <div>
          <h1>작전판</h1>
          <p>{socketState.connected ? '실시간 연결됨' : '연결 대기 중'}</p>
        </div>
        <div className="operation-head-actions">
          {status && <span className="operation-status-text">{status}</span>}
          <span className={'operation-status-pill' + (canDraw ? ' can-draw' : '')}>
            {canDraw ? '그리기 가능' : '보기 전용'}
          </span>
        </div>
      </header>

      <OperationBoardToolbar
        tool={tool}
        color={color}
        strokeWidth={strokeWidth}
        marker={marker}
        canDraw={canDraw}
        canManage={canManage}
        onToolChange={setTool}
        onColorChange={setColor}
        onStrokeWidthChange={setStrokeWidth}
        onMarkerChange={setMarker}
        onClear={socketState.emitClear}
        onSave={handleSave}
        onUploadBackground={handleUploadBackground}
        onResetBackground={() => socketState.emitBackground({ type: 'grid', imageUrl: null })}
      />

      <OperationBoardCanvas
        elements={socketState.elements}
        background={socketState.background}
        tool={tool}
        color={color}
        strokeWidth={strokeWidth}
        marker={marker}
        canDraw={canDraw}
        onAddElement={socketState.emitElement}
        onRemoveElement={socketState.emitRemoveElement}
      />

      <OperationBoardSidePanel
        open={sideOpen}
        chatOpen={chatOpen}
        participants={socketState.participants}
        onPermission={socketState.emitPermission}
        onToggleOpen={() => setSideOpen((value) => !value)}
        onToggleChat={handleToggleChat}
        onLoadSaved={handleLoadSaved}
      />
    </div>
  );
}
