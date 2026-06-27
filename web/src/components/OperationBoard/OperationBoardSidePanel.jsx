// 작전판의 접이식 참여자·저장본·채팅 패널을 제공한다.
import OperationBoardChatPanel from './OperationBoardChatPanel';
import OperationBoardParticipants from './OperationBoardParticipants';
import OperationBoardSavedList from './OperationBoardSavedList';

export default function OperationBoardSidePanel({
  open,
  chatOpen,
  participants,
  savedListRefreshKey,
  onPermission,
  onToggleOpen,
  onToggleChat,
  onLoadSaved,
}) {
  return (
    <aside className={'operation-side-panel' + (open ? ' is-open' : '')}>
      <button type="button" className="operation-side-toggle" onClick={onToggleOpen}>
        {open ? '패널 닫기' : '패널 열기'}
      </button>
      {open && (
        <>
          <OperationBoardParticipants participants={participants} onPermission={onPermission} />
          <OperationBoardSavedList onLoad={onLoadSaved} refreshKey={savedListRefreshKey} />
          <button type="button" className="operation-chat-toggle" onClick={onToggleChat}>
            {chatOpen ? '채팅 닫기' : '채팅 열기'}
          </button>
          {chatOpen && <OperationBoardChatPanel onClose={onToggleChat} />}
        </>
      )}
    </aside>
  );
}
