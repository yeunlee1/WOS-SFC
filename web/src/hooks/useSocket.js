import { useEffect } from 'react';
import { useStore, ALLIANCES } from '../store';
import { connectSocket } from '../api';

// StrictMode 안전: cleanup에서 소켓 자체는 끊지 않고 핸들러만 해제.
// 실제 disconnect는 로그아웃 시 Header.handleLogout에서 명시적으로 호출됨.
export function useSocket(user) {
  const setNotices        = useStore((s) => s.setNotices);
  const setRallies        = useStore((s) => s.setRallies);
  const setMembers        = useStore((s) => s.setMembers);
  const setOnlineUsers    = useStore((s) => s.setOnlineUsers);
  const setCountdown      = useStore((s) => s.setCountdown);
  const setBoardPosts     = useStore((s) => s.setBoardPosts);
  const setAllianceNotices= useStore((s) => s.setAllianceNotices);
  const upsertRallyGroup    = useStore((s) => s.upsertRallyGroup);
  const removeRallyGroup    = useStore((s) => s.removeRallyGroup);
  const setRallyCountdown   = useStore((s) => s.setRallyCountdown);
  const clearRallyCountdown = useStore((s) => s.clearRallyCountdown);
  const setBusyHolder       = useStore((s) => s.setBusyHolder);

  useEffect(() => {
    if (!user) return;
    // httpOnly 쿠키가 자동 전송되므로 토큰 파라미터 불필요
    const socket = connectSocket();

    const boardHandlers = ALLIANCES.map((a) => (posts) => setBoardPosts(a, posts));

    const onRallyUpdated = (group) => upsertRallyGroup(group);
    const onRallyRemoved = ({ groupId }) => removeRallyGroup(groupId);
    const onRallyCountdownStart = (payload) => setRallyCountdown(payload.groupId, payload);
    const onRallyCountdownStop = ({ groupId }) => clearRallyCountdown(groupId);
    const onBusyState = ({ holder }) => setBusyHolder(holder);

    socket.on('notices:updated',  setNotices);
    socket.on('rallies:updated',  setRallies);
    socket.on('members:updated',  setMembers);
    socket.on('online:updated',   setOnlineUsers);
    socket.on('countdown:state',  setCountdown);
    socket.on('rallyGroup:updated', onRallyUpdated);
    socket.on('rallyGroup:removed', onRallyRemoved);
    socket.on('rallyGroup:countdown:start', onRallyCountdownStart);
    socket.on('rallyGroup:countdown:stop', onRallyCountdownStop);
    socket.on('busy:state', onBusyState);
    ALLIANCES.forEach((a, i) => socket.on(`board:updated:${a}`, boardHandlers[i]));
    ALLIANCES.forEach((a) => {
      socket.on(`alliance-notice:updated:${a}`, (notices) => setAllianceNotices(a, notices));
    });

    return () => {
      socket.off('notices:updated',  setNotices);
      socket.off('rallies:updated',  setRallies);
      socket.off('members:updated',  setMembers);
      socket.off('online:updated',   setOnlineUsers);
      socket.off('countdown:state',  setCountdown);
      socket.off('rallyGroup:updated', onRallyUpdated);
      socket.off('rallyGroup:removed', onRallyRemoved);
      socket.off('rallyGroup:countdown:start', onRallyCountdownStart);
      socket.off('rallyGroup:countdown:stop', onRallyCountdownStop);
      socket.off('busy:state', onBusyState);
      ALLIANCES.forEach((a, i) => socket.off(`board:updated:${a}`, boardHandlers[i]));
      ALLIANCES.forEach((a) => {
        socket.off(`alliance-notice:updated:${a}`);
      });
      // disconnect 하지 않음 — StrictMode 이중 cleanup에서 소켓이 잠시 죽었다 살아나며
      // 서버 handleConnection이 두 번 호출되어 countdown:state 중복 도착하는 문제 방지.
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
}
