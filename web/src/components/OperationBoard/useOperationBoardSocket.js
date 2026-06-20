// 작전판 소켓 이벤트 구독과 emit 함수를 제공한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSocket } from '../../api';

const EMPTY_BACKGROUND = { type: 'grid', imageUrl: null };

export function useOperationBoardSocket(chatOpen = false) {
  const [elements, setElements] = useState([]);
  const [background, setBackground] = useState(EMPTY_BACKGROUND);
  const [participants, setParticipants] = useState([]);
  const [canDraw, setCanDraw] = useState(false);
  const [connected, setConnected] = useState(false);
  const chatOpenRef = useRef(chatOpen);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  useEffect(() => {
    const socket = connectSocket();
    setConnected(socket.connected);

    function joinOperationBoard() {
      socket.emit('operation:join', { chatOpen: chatOpenRef.current });
    }
    function handleConnect() {
      setConnected(true);
      joinOperationBoard();
    }
    function handleDisconnect() {
      setConnected(false);
    }
    function handleState(state = {}) {
      setElements(Array.isArray(state.elements) ? state.elements : []);
      setBackground(state.background || EMPTY_BACKGROUND);
      setParticipants(Array.isArray(state.participants) ? state.participants : []);
      setCanDraw(!!state.canDraw);
    }
    function handlePresence(next) {
      setParticipants(Array.isArray(next) ? next : []);
    }
    function handleAdd(element) {
      setElements((prev) => [...prev, element].slice(-500));
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

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('operation:state', handleState);
    socket.on('operation:presence', handlePresence);
    socket.on('operation:element:add', handleAdd);
    socket.on('operation:element:remove', handleRemove);
    socket.on('operation:clear', handleClear);
    socket.on('operation:background:update', handleBackground);
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
    };
  }, []);

  useEffect(() => {
    connectSocket().emit('operation:chat-open', { chatOpen });
  }, [chatOpen]);

  const emitElement = useCallback((element) => {
    connectSocket().emit('operation:element:add', element);
  }, []);
  const emitRemoveElement = useCallback((id) => {
    connectSocket().emit('operation:element:remove', { id });
  }, []);
  const emitClear = useCallback(() => {
    connectSocket().emit('operation:clear');
  }, []);
  const emitPermission = useCallback((participantId, nextCanDraw) => {
    connectSocket().emit('operation:permission:update', {
      participantId,
      canDraw: nextCanDraw,
    });
  }, []);
  const emitBackground = useCallback((next) => {
    connectSocket().emit('operation:background:update', next);
  }, []);
  const emitChatOpen = useCallback((nextOpen) => {
    connectSocket().emit('operation:chat-open', { chatOpen: nextOpen });
  }, []);

  return {
    connected,
    elements,
    background,
    participants,
    canDraw,
    emitElement,
    emitRemoveElement,
    emitClear,
    emitPermission,
    emitBackground,
    emitChatOpen,
  };
}
