// 작전판 안에서 기존 전체 채팅을 공유해서 보여준다.
import ChatDock from '../Chat/ChatDock';

export default function OperationBoardChatPanel({ onClose }) {
  return (
    <div className="operation-chat-panel">
      <ChatDock onClose={onClose} />
    </div>
  );
}
