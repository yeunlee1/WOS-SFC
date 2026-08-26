import { useEffect, useRef } from 'react';
import { useStore, ALLIANCES, getChatMessageKey } from '../store';
import { connectSocket, translateChatMessage } from '../api';

const CHAT_TRANSLATION_INTERVAL_MS = 6500;
const CHAT_TRANSLATION_MAX_ATTEMPTS = 3;
const CHAT_TRANSLATION_MAX_RATE_RETRIES = 5;
const CHAT_TRANSLATION_JOB_TIMEOUT_MS = 40_000;
const CHAT_TRANSLATION_RETRY_GRACE_MS = 250;
const chatTranslationRequests = new Map();
const chatTranslationQueue = [];
let chatTranslationTimer = null;
let chatTranslationRunning = false;
let chatTranslationLastStartedAt = 0;
let chatTranslationGeneration = 0;
let chatTranslationRunToken = 0;
let chatTranslationController = null;
let systemMessageSequence = 0;

function clearChatTranslationRequest(job) {
  if (chatTranslationRequests.get(job.requestKey) === job.generation) {
    chatTranslationRequests.delete(job.requestKey);
  }
}

function needsChatTranslation(message, targetLanguage) {
  const state = useStore.getState();
  if (
    !state.chatAutoTranslate ||
    !targetLanguage ||
    message?._type === 'system'
  )
    return false;
  if (
    !message?.language ||
    message.language === targetLanguage ||
    targetLanguage === 'other'
  )
    return false;

  const messageKey = getChatMessageKey(message);
  const stored = state.chatMessages.find(
    (item) => getChatMessageKey(item) === messageKey,
  );
  return !(
    stored?.translatedContent && stored.translatedLanguage === targetLanguage
  );
}

function addChatTranslationJob(job) {
  if (!job.priority) {
    chatTranslationQueue.push(job);
    return;
  }

  const firstHistoryIndex = chatTranslationQueue.findIndex(
    (queued) => !queued.priority,
  );
  if (firstHistoryIndex === -1) chatTranslationQueue.push(job);
  else chatTranslationQueue.splice(firstHistoryIndex, 0, job);
}

function scheduleNextChatTranslation() {
  if (
    chatTranslationRunning ||
    chatTranslationTimer ||
    chatTranslationQueue.length === 0
  )
    return;

  const elapsed = Date.now() - chatTranslationLastStartedAt;
  const intervalDelay =
    chatTranslationLastStartedAt === 0
      ? 0
      : Math.max(0, CHAT_TRANSLATION_INTERVAL_MS - elapsed);
  const earliestReadyAt = Math.min(
    ...chatTranslationQueue.map((job) => job.notBefore || 0),
  );
  const readyDelay = Math.max(0, earliestReadyAt - Date.now());
  const delay = Math.max(intervalDelay, readyDelay);

  chatTranslationTimer = setTimeout(() => {
    chatTranslationTimer = null;
    runNextChatTranslation();
  }, delay);
}

function retryChatTranslation(job, error) {
  if (job.generation !== chatTranslationGeneration) return false;
  if (!needsChatTranslation(job.message, job.targetLanguage)) {
    return false;
  }

  if (error?.status === 429 && Number.isFinite(error.retryAfterMs)) {
    if (job.rateRetries >= CHAT_TRANSLATION_MAX_RATE_RETRIES) return false;
    job.rateRetries += 1;
    job.notBefore =
      Date.now() +
      Math.max(CHAT_TRANSLATION_INTERVAL_MS, error.retryAfterMs) +
      CHAT_TRANSLATION_RETRY_GRACE_MS;
    addChatTranslationJob(job);
    return true;
  }

  if (job.attempt >= CHAT_TRANSLATION_MAX_ATTEMPTS) return false;
  job.attempt += 1;
  job.notBefore =
    Date.now() + CHAT_TRANSLATION_INTERVAL_MS * Math.max(1, job.attempt - 1);
  addChatTranslationJob(job);
  return true;
}

function withChatTranslationTimeout(promise, controller) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('chat translation timeout'));
    }, CHAT_TRANSLATION_JOB_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function runNextChatTranslation() {
  if (chatTranslationRunning) return;

  const now = Date.now();
  let job = null;
  for (let index = 0; index < chatTranslationQueue.length; ) {
    const candidate = chatTranslationQueue[index];
    if (
      candidate.generation !== chatTranslationGeneration ||
      !needsChatTranslation(candidate.message, candidate.targetLanguage)
    ) {
      chatTranslationQueue.splice(index, 1);
      clearChatTranslationRequest(candidate);
      continue;
    }
    if (!job && (candidate.notBefore || 0) <= now) {
      job = chatTranslationQueue.splice(index, 1)[0];
      break;
    }
    index += 1;
  }
  if (!job) {
    scheduleNextChatTranslation();
    return;
  }

  chatTranslationRunning = true;
  chatTranslationLastStartedAt = Date.now();
  const runToken = ++chatTranslationRunToken;
  const controller = new AbortController();
  chatTranslationController = controller;
  let requeued = false;

  withChatTranslationTimeout(
    Promise.resolve().then(() =>
      translateChatMessage(job.message, job.targetLanguage, {
        signal: controller.signal,
      }),
    ),
    controller,
  )
    .then((translated) => {
      if (job.generation !== chatTranslationGeneration) return;
      if (!translated?.translatedContent) {
        requeued = retryChatTranslation(job);
        return;
      }

      useStore
        .getState()
        .setChatMessageTranslation(
          job.messageKey,
          translated.translatedContent,
          job.targetLanguage,
        );
    })
    .catch((error) => {
      requeued = retryChatTranslation(job, error);
    })
    .finally(() => {
      if (runToken !== chatTranslationRunToken) return;
      if (!requeued) clearChatTranslationRequest(job);
      chatTranslationController = null;
      chatTranslationRunning = false;
      scheduleNextChatTranslation();
    });
}

function resetChatTranslationQueue() {
  chatTranslationGeneration += 1;
  chatTranslationRunToken += 1;
  chatTranslationController?.abort();
  chatTranslationController = null;
  chatTranslationRunning = false;
  chatTranslationLastStartedAt = 0;
  chatTranslationQueue.length = 0;
  chatTranslationRequests.clear();
  if (chatTranslationTimer) clearTimeout(chatTranslationTimer);
  chatTranslationTimer = null;
}

function queueChatTranslation(message, targetLanguage, priority = false) {
  if (!needsChatTranslation(message, targetLanguage)) return;

  const messageKey = getChatMessageKey(message);

  const requestKey = `${messageKey}:${targetLanguage}`;
  if (chatTranslationRequests.has(requestKey)) return;
  const job = {
    message,
    messageKey,
    targetLanguage,
    requestKey,
    priority,
    attempt: 1,
    rateRetries: 0,
    notBefore: 0,
    generation: chatTranslationGeneration,
  };
  chatTranslationRequests.set(requestKey, job.generation);
  addChatTranslationJob(job);
  scheduleNextChatTranslation();
}

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

  useEffect(() => {
    chatLanguageRef.current = chatLanguage;
  }, [chatLanguage]);

  useEffect(() => {
    if (!user) return;
    // httpOnly 쿠키가 자동 전송되므로 토큰 파라미터 불필요
    const socket = connectSocket();

    const boardHandlers = ALLIANCES.map(
      (a) => (posts) => setBoardPosts(a, posts),
    );
    const allianceNoticeHandlers = ALLIANCES.map(
      (a) => (notices) => setAllianceNotices(a, notices),
    );

    const onRallyUpdated = (group) => upsertRallyGroup(group);
    const onRallyRemoved = ({ groupId }) => removeRallyGroup(groupId);
    const onRallyCountdownStart = (payload) =>
      setRallyCountdown(payload.groupId, payload);
    const onRallyCountdownStop = ({ groupId }) => clearRallyCountdown(groupId);
    const onBusyState = ({ holder }) => setBusyHolder(holder);
    const onChatHistory = (messages) => {
      const safeMessages = Array.isArray(messages) ? messages : [];
      setChatHistory(safeMessages);
      safeMessages.forEach((message) =>
        queueChatTranslation(message, chatLanguageRef.current),
      );
    };
    const onChatMessage = (message) => {
      if (!message) return;
      appendChatMessage(message);
      queueChatTranslation(message, chatLanguageRef.current, true);
    };
    // 서버가 히스토리 조회에 실패한 경우. 빈 채팅을 정상처럼 보이게 두지 않는다.
    // (문구는 서버가 보내는 입퇴장 알림과 마찬가지로 아직 한국어 고정 — i18n 키 추가 필요)
    const onChatError = (payload) => {
      if (payload?.scope !== 'history') return;
      appendChatMessage({
        _type: 'system',
        _id: `${Date.now()}-${systemMessageSequence++}`,
        text: '지난 대화를 불러오지 못했습니다. 새 메시지는 정상 수신됩니다.',
        createdAt: new Date().toISOString(),
      });
    };
    const onChatSystem = (message) => {
      appendChatMessage({
        _type: 'system',
        _id: `${Date.now()}-${systemMessageSequence++}`,
        text: String(message || ''),
        createdAt: new Date().toISOString(),
      });
    };

    socket.on('notices:updated', setNotices);
    socket.on('rallies:updated', setRallies);
    socket.on('members:updated', setMembers);
    socket.on('online:updated', setOnlineUsers);
    socket.on('countdown:state', setCountdown);
    socket.on('rallyGroup:updated', onRallyUpdated);
    socket.on('rallyGroup:removed', onRallyRemoved);
    socket.on('rallyGroup:countdown:start', onRallyCountdownStart);
    socket.on('rallyGroup:countdown:stop', onRallyCountdownStop);
    socket.on('busy:state', onBusyState);
    socket.on('chat:history', onChatHistory);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:system', onChatSystem);
    socket.on('chat:error', onChatError);
    ALLIANCES.forEach((a, i) =>
      socket.on(`board:updated:${a}`, boardHandlers[i]),
    );
    ALLIANCES.forEach((a, i) => {
      socket.on(`alliance-notice:updated:${a}`, allianceNoticeHandlers[i]);
    });

    return () => {
      socket.off('notices:updated', setNotices);
      socket.off('rallies:updated', setRallies);
      socket.off('members:updated', setMembers);
      socket.off('online:updated', setOnlineUsers);
      socket.off('countdown:state', setCountdown);
      socket.off('rallyGroup:updated', onRallyUpdated);
      socket.off('rallyGroup:removed', onRallyRemoved);
      socket.off('rallyGroup:countdown:start', onRallyCountdownStart);
      socket.off('rallyGroup:countdown:stop', onRallyCountdownStop);
      socket.off('busy:state', onBusyState);
      socket.off('chat:history', onChatHistory);
      socket.off('chat:message', onChatMessage);
      socket.off('chat:system', onChatSystem);
      socket.off('chat:error', onChatError);
      ALLIANCES.forEach((a, i) =>
        socket.off(`board:updated:${a}`, boardHandlers[i]),
      );
      ALLIANCES.forEach((a, i) => {
        socket.off(`alliance-notice:updated:${a}`, allianceNoticeHandlers[i]);
      });
      // disconnect 하지 않음 — StrictMode 이중 cleanup에서 소켓이 잠시 죽었다 살아나며
      // 서버 handleConnection이 두 번 호출되어 countdown:state 중복 도착하는 문제 방지.
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // 자동번역을 켜거나 UI 언어를 바꾸면 이미 받은 원문 중 필요한 항목만 번역한다.
  useEffect(() => {
    resetChatTranslationQueue();
    if (!user || !chatAutoTranslate) return;
    useStore.getState().chatMessages.forEach((message) => {
      queueChatTranslation(message, chatLanguage);
    });
  }, [user, chatAutoTranslate, chatLanguage]);
}
