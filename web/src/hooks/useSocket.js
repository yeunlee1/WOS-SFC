import { useEffect } from 'react';
import { useStore, ALLIANCES } from '../store';
import { connectSocket, disconnectSocket } from '../api';

export function useSocket(user) {
  const setNotices    = useStore((s) => s.setNotices);
  const setRallies    = useStore((s) => s.setRallies);
  const setMembers    = useStore((s) => s.setMembers);
  const setOnlineUsers= useStore((s) => s.setOnlineUsers);
  const setCountdown  = useStore((s) => s.setCountdown);
  const setBoardPosts = useStore((s) => s.setBoardPosts);

  useEffect(() => {
    if (!user) return;
    // httpOnly 쿠키가 자동 전송되므로 토큰 파라미터 불필요
    const socket = connectSocket();

    const boardHandlers = ALLIANCES.map((a) => (posts) => setBoardPosts(a, posts));

    socket.on('notices:updated',  setNotices);
    socket.on('rallies:updated',  setRallies);
    socket.on('members:updated',  setMembers);
    socket.on('online:updated',   setOnlineUsers);
    socket.on('countdown:state',  setCountdown);
    ALLIANCES.forEach((a, i) => socket.on(`board:updated:${a}`, boardHandlers[i]));

    return () => {
      socket.off('notices:updated',  setNotices);
      socket.off('rallies:updated',  setRallies);
      socket.off('members:updated',  setMembers);
      socket.off('online:updated',   setOnlineUsers);
      socket.off('countdown:state',  setCountdown);
      ALLIANCES.forEach((a, i) => socket.off(`board:updated:${a}`, boardHandlers[i]));
      disconnectSocket();
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
}
