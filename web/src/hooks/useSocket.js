// 전역 소켓 훅 — 서버 이벤트를 스토어와 채팅 번역 동기화 모듈에 연결한다. 번역 요청 규칙 자체는 chat/translationSync.js에 있다.
import { useEffect, useRef } from 'react';
import { useStore, ALLIANCES } from '../store';
import { api, connectSocket } from '../api';
import { createTranslationSync } from '../chat/translationSync';
import {
  createOnlineTracker,
  createSystemMessage,
} from '../chat/systemMessages';

// StrictMode 안전: cleanup에서 소켓 자체는 끊지 않고 핸들러만 해제.
// 실제 disconnect는 로그아웃 시 Header.handleLogout에서 명시적으로 호출됨.
export function useSocket(user, chatLanguage = user?.language) {
  const setNotices = useStore((s) => s.setNotices);
  const setRallies = useStore((s) => s.setRallies);
  const setMembers = useStore((s) => s.setMembers);
  const setOnlineUsers = useStore((s) => s.setOnlineUsers);
  const setCountdown = useStore((s) => s.setCountdown);
  const setBoardPosts = useStore((s) => s.setBoardPosts);
  const setAllianceNotices = useStore((s) => s.setAllianceNotices);
  const upsertRallyGroup = useStore((s) => s.upsertRallyGroup);
  const removeRallyGroup = useStore((s) => s.removeRallyGroup);
  const setRallyCountdown = useStore((s) => s.setRallyCountdown);
  const clearRallyCountdown = useStore((s) => s.clearRallyCountdown);
  const setBusyHolder = useStore((s) => s.setBusyHolder);
  const setChatHistory = useStore((s) => s.setChatHistory);
  const appendChatMessage = useStore((s) => s.appendChatMessage);
  const chatAutoTranslate = useStore((s) => s.chatAutoTranslate);
  const chatLanguageRef = useRef(chatLanguage);
  const syncRef = useRef(null);

  useEffect(() => {
    chatLanguageRef.current = chatLanguage;
  }, [chatLanguage]);

  useEffect(() => {
    if (!user) return;
    // httpOnly 쿠키가 자동 전송되므로 토큰 파라미터 불필요
    const socket = connectSocket();

    const sync = createTranslationSync({
      store: useStore,
      translateBatch: (lang, items, options) =>
        api.translateBatch(lang, items, options),
      emitLanguage: (lang) => socket.emit('chat:language', { lang }),
    });
    syncRef.current = sync;

    // 입퇴장은 서버가 방송하지 않고 online:updated diff로 만든다 (C-5, B-16).
    const tracker = createOnlineTracker({
      onFlush: ({ joined, left }) => {
        if (joined.length === 1) {
          appendChatMessage(
            createSystemMessage({ kind: 'joined', nickname: joined[0] }),
          );
        } else if (joined.length > 1) {
          appendChatMessage(
            createSystemMessage({
              kind: 'joinedMany',
              count: joined.length,
              nicknames: joined,
            }),
          );
        }
        if (left.length === 1) {
          appendChatMessage(
            createSystemMessage({ kind: 'left', nickname: left[0] }),
          );
        } else if (left.length > 1) {
          appendChatMessage(
            createSystemMessage({
              kind: 'leftMany',
              count: left.length,
              nicknames: left,
            }),
          );
        }
      },
    });

    const boardHandlers = ALLIANCES.map(
      (a) => (posts) => setBoardPosts(a, posts),
    );
    const allianceNoticeHandlers = ALLIANCES.map(
      (a) => (notices) => setAllianceNotices(a, notices),
    );

    // 접속(재접속 포함)마다 대상 언어를 서버에 보고한다 — 소켓별 상태라 매번 필요하다.
    const onConnect = () =>
      sync.onConnect(
        chatLanguageRef.current,
        useStore.getState().chatAutoTranslate,
      );
    const onOnlineUpdated = (list) => {
      const safeList = Array.isArray(list) ? list : [];
      setOnlineUsers(safeList);
      tracker.update(safeList);
    };
    const onRallyUpdated = (group) => upsertRallyGroup(group);
    const onRallyRemoved = ({ groupId }) => removeRallyGroup(groupId);
    const onRallyCountdownStart = (payload) =>
      setRallyCountdown(payload.groupId, payload);
    const onRallyCountdownStop = ({ groupId }) => clearRallyCountdown(groupId);
    const onBusyState = ({ holder }) => setBusyHolder(holder);
    const onChatHistory = (messages) => {
      const safeMessages = Array.isArray(messages) ? messages : [];
      setChatHistory(safeMessages);
      sync.onHistory(safeMessages);
    };
    const onChatMessage = (message) => {
      if (!message) return;
      appendChatMessage(message);
      sync.onMessage(message);
    };
    const onChatTranslation = (payload) => sync.onPushed(payload);
    // 서버가 히스토리 조회에 실패한 경우(레거시 chat:error). 빈 채팅을 정상처럼 보이게 두지 않는다.
    const onChatError = (payload) => {
      if (payload?.scope !== 'history') return;
      appendChatMessage(createSystemMessage({ kind: 'history_error' }));
    };
    // 새 서버는 { kind } 객체, 옛 서버는 문자열을 보낸다. 둘 다 받는다.
    const onChatSystem = (payload) => {
      if (payload && typeof payload === 'object') {
        if (typeof payload.kind !== 'string') return;
        appendChatMessage(
          createSystemMessage({
            kind: payload.kind,
            ...(payload.nickname ? { nickname: payload.nickname } : {}),
          }),
        );
        return;
      }
      const text = String(payload || '');
      if (!text) return;
      appendChatMessage(createSystemMessage({ kind: 'text', text }));
    };

    socket.on('connect', onConnect);
    socket.on('notices:updated', setNotices);
    socket.on('rallies:updated', setRallies);
    socket.on('members:updated', setMembers);
    socket.on('online:updated', onOnlineUpdated);
    socket.on('countdown:state', setCountdown);
    socket.on('rallyGroup:updated', onRallyUpdated);
    socket.on('rallyGroup:removed', onRallyRemoved);
    socket.on('rallyGroup:countdown:start', onRallyCountdownStart);
    socket.on('rallyGroup:countdown:stop', onRallyCountdownStop);
    socket.on('busy:state', onBusyState);
    socket.on('chat:history', onChatHistory);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:translation', onChatTranslation);
    socket.on('chat:system', onChatSystem);
    socket.on('chat:error', onChatError);
    ALLIANCES.forEach((a, i) =>
      socket.on(`board:updated:${a}`, boardHandlers[i]),
    );
    ALLIANCES.forEach((a, i) => {
      socket.on(`alliance-notice:updated:${a}`, allianceNoticeHandlers[i]);
    });
    // 이미 연결된 소켓에 다시 붙는 경우(StrictMode 재마운트 등)는 connect 이벤트가 없다.
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('notices:updated', setNotices);
      socket.off('rallies:updated', setRallies);
      socket.off('members:updated', setMembers);
      socket.off('online:updated', onOnlineUpdated);
      socket.off('countdown:state', setCountdown);
      socket.off('rallyGroup:updated', onRallyUpdated);
      socket.off('rallyGroup:removed', onRallyRemoved);
      socket.off('rallyGroup:countdown:start', onRallyCountdownStart);
      socket.off('rallyGroup:countdown:stop', onRallyCountdownStop);
      socket.off('busy:state', onBusyState);
      socket.off('chat:history', onChatHistory);
      socket.off('chat:message', onChatMessage);
      socket.off('chat:translation', onChatTranslation);
      socket.off('chat:system', onChatSystem);
      socket.off('chat:error', onChatError);
      ALLIANCES.forEach((a, i) =>
        socket.off(`board:updated:${a}`, boardHandlers[i]),
      );
      ALLIANCES.forEach((a, i) => {
        socket.off(`alliance-notice:updated:${a}`, allianceNoticeHandlers[i]);
      });
      tracker.dispose();
      sync.dispose();
      if (syncRef.current === sync) syncRef.current = null;
      // disconnect 하지 않음 — StrictMode 이중 cleanup에서 소켓이 잠시 죽었다 살아나며
      // 서버 handleConnection이 두 번 호출되어 countdown:state 중복 도착하는 문제 방지.
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // UI 언어·자동번역 토글이 바뀌면 동기화 모듈이 서버에 보고하고 빠진 번역을 다시 센다.
  useEffect(() => {
    syncRef.current?.onLanguageChange(chatLanguage);
  }, [chatLanguage]);

  useEffect(() => {
    syncRef.current?.onAutoTranslateChange(chatAutoTranslate);
  }, [chatAutoTranslate]);
}
