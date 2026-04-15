import { useEffect } from 'react';
import { useStore, ALLIANCES } from '../store';
import { connectSocket, disconnectSocket } from '../api';

export function useSocket(token) {
  const setNotices    = useStore((s) => s.setNotices);
  const setRallies    = useStore((s) => s.setRallies);
  const setMembers    = useStore((s) => s.setMembers);
  const setOnlineUsers= useStore((s) => s.setOnlineUsers);
  const setCountdown  = useStore((s) => s.setCountdown);
  const setBoardPosts = useStore((s) => s.setBoardPosts);

  useEffect(() => {
    if (!token) return;

    const socket = connectSocket(token);

    socket.on('notices:updated',  setNotices);
    socket.on('rallies:updated',  setRallies);
    socket.on('members:updated',  setMembers);
    socket.on('online:updated',   setOnlineUsers);
    socket.on('countdown:state',  setCountdown);
    ALLIANCES.forEach((a) =>
      socket.on(`board:updated:${a}`, (posts) => setBoardPosts(a, posts))
    );

    return () => {
      socket.off('notices:updated');
      socket.off('rallies:updated');
      socket.off('members:updated');
      socket.off('online:updated');
      socket.off('countdown:state');
      ALLIANCES.forEach((a) => socket.off(`board:updated:${a}`));
      disconnectSocket();
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
}
