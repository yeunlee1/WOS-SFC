// 작전판 소켓 이벤트 구독과 emit 함수를 제공한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSocket } from '../../api';

const EMPTY_BACKGROUND = { type: 'grid', imageUrl: null };
const MAX_ELEMENTS = 500;

export function useOperationBoardSocket(chatOpen = false) {
  const [elements, setElements] = useState([]);
  const [background, setBackground] = useState(EMPTY_BACKGROUND);
  const [participants, setParticipants] = useState([]);
  const [canDraw, setCanDraw] = useState(false);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState('');
  const [sessionReset, setSessionReset] = useState(false);
  const chatOpenRef = useRef(chatOpen);
  const socketIdRef = useRef(null);
  // 서버가 알려 주는 라이브 세션 식별자 — 값이 바뀌면 서버가 재시작돼 라이브 보드가 사라진 것이다.
  const sessionIdRef = useRef(null);

  // 서버 거절 ack 를 사용자에게 그대로 전달한다. 조용히 무시하면 그린 획이 사라진 이유를 알 수 없다.
  const handleAck = useCallback((ack) => {
    if (ack && ack.ok === false) {
      setLastError(ack.reason || '작전판 요청이 거부되었습니다.');
      return;
    }
    if (ack && ack.ok === true) setLastError('');
  }, []);

  const clearError = useCallback(() => setLastError(''), []);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  useEffect(() => {
    const socket = connectSocket();
    setConnected(socket.connected);

    function joinOperationBoard() {
      socketIdRef.current = socket.id || null;
      // join 이 거절되면 보드가 빈 채로 남는다 — 사유를 받아 사용자에게 알린다.
      socket.emit(
        'operation:join',
        { chatOpen: chatOpenRef.current },
        handleAck,
      );
    }
    function handleConnect() {
      setConnected(true);
      joinOperationBoard();
    }
    function handleDisconnect() {
      setConnected(false);
    }
    function handleState(state = {}) {
      const nextSessionId = state.sessionId || null;
      if (
        sessionIdRef.current &&
        nextSessionId &&
        nextSessionId !== sessionIdRef.current
      ) {
        setSessionReset(true);
      }
      sessionIdRef.current = nextSessionId;

      setElements(Array.isArray(state.elements) ? state.elements : []);
      setBackground(state.background || EMPTY_BACKGROUND);
      setParticipants(Array.isArray(state.participants) ? state.participants : []);
      setCanDraw(!!state.canDraw);
    }
    function handlePresence(next) {
      const list = Array.isArray(next) ? next : [];
      setParticipants(list);
      const ownParticipant = list.find((participant) => participant.participantId === socketIdRef.current);
      if (ownParticipant) setCanDraw(!!ownParticipant.canDraw);
    }
    function handleAdd(element) {
      setElements((prev) => [...prev, element].slice(-MAX_ELEMENTS));
    }
    function handleRemove(body) {
      setElements((prev) => prev.filter((element) => element.id !== body?.id));
    }
    function handleClear() {
      setElements([]);
    }
    function handleBackground(next) {
      setBackground(next || EMPTY_BACKGROUND);
    }
    // 저장본 불러오기 — 요소를 하나씩 받지 않고 한 이벤트로 통째로 교체한다.
    function handleBoardReplace(next = {}) {
      setElements(Array.isArray(next.elements) ? next.elements : []);
      setBackground(next.background || EMPTY_BACKGROUND);
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('operation:state', handleState);
    socket.on('operation:presence', handlePresence);
    socket.on('operation:element:add', handleAdd);
    socket.on('operation:element:remove', handleRemove);
    socket.on('operation:clear', handleClear);
    socket.on('operation:background:update', handleBackground);
    socket.on('operation:board:replace', handleBoardReplace);
    joinOperationBoard();

    return () => {
      socket.emit('operation:leave');
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('operation:state', handleState);
      socket.off('operation:presence', handlePresence);
      socket.off('operation:element:add', handleAdd);
      socket.off('operation:element:remove', handleRemove);
      socket.off('operation:clear', handleClear);
      socket.off('operation:background:update', handleBackground);
      socket.off('operation:board:replace', handleBoardReplace);
    };
  }, []);

  useEffect(() => {
    connectSocket().emit('operation:chat-open', { chatOpen });
  }, [chatOpen]);

  const emitElement = useCallback((element) => {
    connectSocket().emit('operation:element:add', element, handleAck);
  }, [handleAck]);
  const emitRemoveElement = useCallback((id) => {
    connectSocket().emit('operation:element:remove', { id }, handleAck);
  }, [handleAck]);
  const emitClear = useCallback(() => {
    connectSocket().emit('operation:clear', {}, handleAck);
  }, [handleAck]);
  const emitPermission = useCallback((participantId, nextCanDraw) => {
    connectSocket().emit(
      'operation:permission:update',
      { participantId, canDraw: nextCanDraw },
      handleAck,
    );
  }, [handleAck]);
  const emitBackground = useCallback((next) => {
    connectSocket().emit('operation:background:update', next, handleAck);
  }, [handleAck]);
  const emitChatOpen = useCallback((nextOpen) => {
    connectSocket().emit('operation:chat-open', { chatOpen: nextOpen });
  }, []);
  // 저장본 500개를 개별 이벤트로 보내면 브로드캐스트 팬아웃이 접속자 수만큼 곱해진다. 1건으로 보낸다.
  const emitReplaceBoard = useCallback(({ elements: nextElements, background: nextBackground }) => {
    connectSocket().emit(
      'operation:board:replace',
      { elements: nextElements, background: nextBackground },
      handleAck,
    );
  }, [handleAck]);

  return {
    connected,
    elements,
    background,
    participants,
    canDraw,
    lastError,
    sessionReset,
    clearError,
    emitElement,
    emitRemoveElement,
    emitClear,
    emitPermission,
    emitBackground,
    emitChatOpen,
    emitReplaceBoard,
  };
}
