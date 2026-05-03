/* ════════════════════════════════════════════════════════════
   data.jsx — i18n, mock data, localStorage helpers
   ════════════════════════════════════════════════════════════ */

const ALLIANCES = [
  { code: 'KOR', name: 'KOR', color: 'var(--kor)' },
  { code: 'NSL', name: 'NSL', color: 'var(--nsl)' },
  { code: 'JKY', name: 'JKY', color: 'var(--jky)' },
  { code: 'GPX', name: 'GPX', color: 'var(--gpx)' },
  { code: 'UFO', name: 'UFO', color: 'var(--ufo)' },
];

const I18N = {
  ko: {
    appTitle: 'WOS · SFC',
    tabBattle: '전투',
    tabCommunity: '커뮤니티',
    tabChat: '채팅',
    tabAdmin: '관리',
    online: '온라인',
    logout: '로그아웃',
    login: '로그인',
    signup: '가입',
    nickname: '닉네임',
    password: '비밀번호',
    server: '서버',
    alliance: '연맹',
    selectAlliance: '연맹 선택',
    submit: '확인',
    or: '또는',
    devQuickLogin: '개발자 빠른 로그인',
    haveAccount: '이미 가입했나요?',
    noAccount: '아직 가입 안 했나요?',
    incorrect: '닉네임 또는 비밀번호가 올바르지 않습니다',
    fillAll: '모든 항목을 입력해주세요',
    // battle
    countdown: '카운트다운',
    personal: '내 출정',
    rally: '집결 그룹',
    defenseSide: '방어 측',
    attackSide: '공격 측',
    waiting: '대기',
    active: '진행중',
    finished: '종료',
    march: '행군',
    arrival: '도착',
    add: '추가',
    delete: '삭제',
    setTotal: '총 시간',
    seconds: '초',
    presets: '프리셋',
    sec: 's',
    min: 'm',
    rallyName: '그룹 이름',
    timeLeft: '남은 시간',
    noMembers: '아직 출정 멤버가 없습니다',
    noRallies: '진행중인 집결이 없습니다',
    onlyAdmin: '관리자만 카운트다운을 시작할 수 있습니다',
    start: '시작',
    stop: '정지',
    reset: '초기화',
    // community
    notices: '공지사항',
    board: '게시판',
    pin: '고정',
    title: '제목',
    body: '내용',
    post: '게시',
    cancel: '취소',
    write: '작성',
    selectAllianceTab: '연맹별 게시판',
    // chat
    chatPlaceholder: '메시지 입력...',
    send: '전송',
    autoTranslate: '자동 번역',
    chatJoined: '님이 입장했습니다',
    // admin
    userMgmt: '사용자 관리',
    setLeader: '연맹장 지정',
    unsetLeader: '연맹장 해제',
    promote: '관리자',
    demote: '일반',
    deleteUser: '삭제',
    leader: '연맹장',
  },
  en: {
    appTitle: 'WOS · SFC',
    tabBattle: 'BATTLE',
    tabCommunity: 'COMMUNITY',
    tabChat: 'CHAT',
    tabAdmin: 'ADMIN',
    online: 'ONLINE',
    logout: 'Log out',
    login: 'Log in',
    signup: 'Sign up',
    nickname: 'Nickname',
    password: 'Password',
    server: 'Server',
    alliance: 'Alliance',
    selectAlliance: 'Select alliance',
    submit: 'Submit',
    or: 'or',
    devQuickLogin: 'Dev quick login',
    haveAccount: 'Have an account?',
    noAccount: 'No account yet?',
    incorrect: 'Incorrect nickname or password',
    fillAll: 'Please fill all fields',
    countdown: 'Countdown',
    personal: 'My Dispatch',
    rally: 'Rally Groups',
    defenseSide: 'Defense Side',
    attackSide: 'Attack Side',
    waiting: 'Waiting',
    active: 'Active',
    finished: 'Finished',
    march: 'March',
    arrival: 'Arrival',
    add: 'Add',
    delete: 'Delete',
    setTotal: 'Total',
    seconds: 'sec',
    presets: 'Presets',
    sec: 's',
    min: 'm',
    rallyName: 'Group name',
    timeLeft: 'Time left',
    noMembers: 'No dispatch members yet',
    noRallies: 'No active rallies',
    onlyAdmin: 'Only admins can start a countdown',
    start: 'Start',
    stop: 'Stop',
    reset: 'Reset',
    notices: 'Notices',
    board: 'Board',
    pin: 'Pin',
    title: 'Title',
    body: 'Body',
    post: 'Post',
    cancel: 'Cancel',
    write: 'Write',
    selectAllianceTab: 'By alliance',
    chatPlaceholder: 'Type a message...',
    send: 'Send',
    autoTranslate: 'Auto-translate',
    chatJoined: 'joined',
    userMgmt: 'User management',
    setLeader: 'Set leader',
    unsetLeader: 'Unset leader',
    promote: 'Admin',
    demote: 'Member',
    deleteUser: 'Delete',
    leader: 'Leader',
  }
};

// Seed users
const SEED_USERS = [
  { id: 'u1', nickname: 'IceQueen',  password: '1234', alliance: 'KOR', role: 'developer', isLeader: false, server: 1234 },
  { id: 'u2', nickname: 'FrostLord', password: '1234', alliance: 'KOR', role: 'admin',     isLeader: true,  server: 1234 },
  { id: 'u3', nickname: 'Glacier',   password: '1234', alliance: 'KOR', role: 'member',    isLeader: false, server: 1234 },
  { id: 'u4', nickname: 'Avalanche', password: '1234', alliance: 'NSL', role: 'admin',     isLeader: true,  server: 1234 },
  { id: 'u5', nickname: 'Tundra',    password: '1234', alliance: 'NSL', role: 'member',    isLeader: false, server: 1234 },
  { id: 'u6', nickname: 'Permafrost',password: '1234', alliance: 'JKY', role: 'admin',     isLeader: true,  server: 1234 },
  { id: 'u7', nickname: 'IceShard',  password: '1234', alliance: 'JKY', role: 'member',    isLeader: false, server: 1234 },
  { id: 'u8', nickname: 'Blizzard',  password: '1234', alliance: 'GPX', role: 'admin',     isLeader: true,  server: 1234 },
  { id: 'u9', nickname: 'Snowfall',  password: '1234', alliance: 'UFO', role: 'admin',     isLeader: true,  server: 1234 },
  { id: 'u10',nickname: 'Crystal',   password: '1234', alliance: 'UFO', role: 'member',    isLeader: false, server: 1234 },
];

const SEED_NOTICES = [
  { id: 'n1', authorId: 'u1', author: 'IceQueen', title: 'SFC 일정 안내 (Dec 14, 19:00 UTC)', body: '이번 주 SFC 일정을 공지합니다. 모든 연맹원은 시간 엄수 부탁드립니다. 출정 시간 ±2초 오차로 진행됩니다.', pinned: true, createdAt: Date.now() - 1000 * 60 * 60 * 3 },
  { id: 'n2', authorId: 'u1', author: 'IceQueen', title: '신규 연맹 통합 — UFO 연합 합류', body: 'UFO 연맹이 동맹에 합류했습니다. 전투 채팅 및 행군 시간 공유를 위해 명단을 갱신해주세요.', pinned: false, createdAt: Date.now() - 1000 * 60 * 60 * 24 },
  { id: 'n3', authorId: 'u2', author: 'FrostLord', title: '카운트다운 자동화 도입', body: 'TTS 음성 카운트다운이 도입되었습니다. 헤더 우측에서 볼륨 조절 가능합니다.', pinned: false, createdAt: Date.now() - 1000 * 60 * 60 * 48 },
];

const SEED_POSTS_BY_ALLIANCE = {
  KOR: [
    { id: 'p1', authorId: 'u3', author: 'Glacier',   title: 'KOR 출정 영상 업데이트', body: '지난 SFC 영상을 첨부했습니다. 주력 부대 행군 타이밍이 완벽했어요.', createdAt: Date.now() - 1000 * 60 * 30 },
    { id: 'p2', authorId: 'u2', author: 'FrostLord', title: '주말 정기 훈련 안내', body: '토요일 21시 정기 훈련합니다. 행군 5초 단위 연습.', createdAt: Date.now() - 1000 * 60 * 60 * 6 },
  ],
  NSL: [
    { id: 'p3', authorId: 'u5', author: 'Tundra', title: '집결 명령 개선 제안', body: '리더 행군 시간을 +3초 늦추는 게 좋을 것 같습니다.', createdAt: Date.now() - 1000 * 60 * 60 * 2 },
  ],
  JKY: [],
  GPX: [],
  UFO: [
    { id: 'p4', authorId: 'u10', author: 'Crystal', title: 'UFO 첫 SFC 참여 후기', body: '동맹과 함께한 첫 SFC, 만족스러웠습니다 ❄️', createdAt: Date.now() - 1000 * 60 * 60 * 12 },
  ],
};

const SEED_CHAT = [
  { id: 'c1', userId: 'u2', nickname: 'FrostLord', alliance: 'KOR', text: '5분 후 집결 시작합니다. 준비하세요.', textEn: 'Rally starting in 5 min. Get ready.', createdAt: Date.now() - 1000 * 60 * 8 },
  { id: 'c2', userId: 'u4', nickname: 'Avalanche', alliance: 'NSL', text: 'NSL 전원 대기중', textEn: 'NSL all standing by', createdAt: Date.now() - 1000 * 60 * 7 },
  { id: 'c3', userId: 'u8', nickname: 'Blizzard',  alliance: 'GPX', text: 'GPX ready', textEn: 'GPX ready', createdAt: Date.now() - 1000 * 60 * 6 },
  { id: 'c4', userId: 'u6', nickname: 'Permafrost',alliance: 'JKY', text: 'JKY 카운트 시작 부탁드립니다', textEn: 'JKY please start the count', createdAt: Date.now() - 1000 * 60 * 5 },
  { id: 'c5', userId: 'u9', nickname: 'Snowfall',  alliance: 'UFO', text: '👍', textEn: '👍', createdAt: Date.now() - 1000 * 60 * 4 },
];

// localStorage
const LS_KEY = 'wos-sfc-state-v1';
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}
function saveState(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e) {}
}

function allianceMeta(code) {
  return ALLIANCES.find(a => a.code === code) || ALLIANCES[0];
}

function fmtClock(date) {
  const d = date || new Date();
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC';
}
function fmtAgo(ts, lang) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (lang === 'ko') {
    if (d > 0) return d + '일 전';
    if (h > 0) return h + '시간 전';
    if (m > 0) return m + '분 전';
    return '방금';
  } else {
    if (d > 0) return d + 'd ago';
    if (h > 0) return h + 'h ago';
    if (m > 0) return m + 'm ago';
    return 'just now';
  }
}
function fmtTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

window.WOS = {
  ALLIANCES, I18N, SEED_USERS, SEED_NOTICES, SEED_POSTS_BY_ALLIANCE, SEED_CHAT,
  loadState, saveState, allianceMeta, fmtClock, fmtAgo, fmtTime, LS_KEY
};
