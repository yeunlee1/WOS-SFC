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
  const [savedListRefreshKey, setSavedListRefreshKey] = useState(0);
  const socketState = useOperationBoardSocket(chatOpen);

  const canDraw = canUseOperationTools(user, socketState.canDraw);
  const canManage = canManageOperationBoard(user);

  function handleToggleChat() {
    const next = !chatOpen;
    setChatOpen(next);
  }

  // 지우기는 접속자 전원의 라이브 보드를 되돌릴 수 없이 비운다 — 확인을 받는다.
  function handleClear() {
    if (!canManage) return;
    if (!window.confirm('접속한 모든 사람의 작전판이 즉시 비워집니다. 지울까요?')) {
      return;
    }
    socketState.emitClear();
  }

  // 저장본 불러오기도 라이브 보드를 통째로 덮어쓴다 — 확인 후 이벤트 1건으로 적용한다.
  // 목록 응답에는 요소가 없다(메타만). 확인을 받은 뒤에만 개별 조회로 요소를 받아 온다 —
  // 목록에 요소를 싣던 때는 탭에 들어오기만 해도 저장본 50개분을 통째로 내려받았다.
  async function handleLoadSaved(board) {
    if (!canManage) return;
    if (
      !window.confirm(
        `저장본 "${board.title}"으로 덮어씁니다. 지금 그려진 내용은 사라집니다. 불러올까요?`,
      )
    ) {
      return;
    }
    try {
      const full = await api.getOperationBoard(board.id);
      socketState.emitReplaceBoard({
        elements: sanitizeOperationElements(full?.elements || []),
        background: {
          type: full?.backgroundType || 'grid',
          imageUrl: full?.backgroundImageUrl || null,
        },
      });
      setStatus('불러옴');
    } catch (err) {
      setStatus(err.message || '불러오기 실패');
    }
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
      setSavedListRefreshKey((value) => value + 1);
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
          {/* 라이브 보드는 서버 메모리에만 있다 — 저장을 유도하는 고지를 항상 띄운다. */}
          <p className="operation-board-hint">
            라이브 작전판은 서버 메모리에만 있습니다. 저장하지 않으면 재배포·재시작 때 사라집니다.
          </p>
          {socketState.sessionReset && (
            <p className="operation-board-alert" role="alert">
              서버가 재시작되어 라이브 작전판이 초기화되었습니다. 저장본에서 다시 불러오세요.
            </p>
          )}
        </div>
        <div className="operation-head-actions">
          {status && <span className="operation-status-text">{status}</span>}
          {socketState.lastError && (
            <span className="operation-status-text operation-board-error">
              {socketState.lastError}
            </span>
          )}
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
        onClear={handleClear}
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
        savedListRefreshKey={savedListRefreshKey}
        onPermission={socketState.emitPermission}
        onToggleOpen={() => setSideOpen((value) => !value)}
        onToggleChat={handleToggleChat}
        onLoadSaved={handleLoadSaved}
      />
    </div>
  );
}
