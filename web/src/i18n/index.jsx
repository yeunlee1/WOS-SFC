import { createContext, useContext, useState, useCallback } from 'react';

// ─── 지원 언어 목록 ───
export const SUPPORTED_LANGS = [
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
];

// ─── UI 텍스트 맵 ───
const UI_TEXTS = {
  ko: {
    modalTitle: '서버 코드를 입력하세요',
    modalAllianceLabel: '연맹 선택',
    modalNicknameLabel: '닉네임',
    modalNicknamePlaceholder: '게임 닉네임',
    modalJoin: '입장',
    modalConnecting: '연결 중...',
    modalDevSummary: '🔧 개발자 코드',
    modalDevPlaceholder: '개발자 전용 코드',
    onlineUsers: '👥 접속 중',
    onlineUsersDesc: '현재 온라인',
    roleDeveloper: '👑 개발자',
    roleAdmin: '⚡ 관리자',
    roleUser: '일반',
    tabDashboard: '🗺️ 대쉬보드',
    tabBattle: '⚔️ 전투현황',
    tabCommunity: '💬 커뮤니티',
    tabChat: '💬 채팅',
    tabNotices: '공지사항',
    boardPost: '게시하기',
    emptyBoard: '게시물이 없어요',
    rallyTimer: '⏱️ 집결 타이머',
    rallyTimerDesc: '최대 6개 동시 추적',
    dispatchTiming: '🚀 발송 타이밍',
    dispatchDesc: '도착 시각 기준 발송 시각 계산',
    noticeboard: '📌 공지 핀보드',
    noticeboardDesc: '중요 공지 고정 보관',
    rallyAdd: '추가',
    rallyNamePlaceholder: '집결 이름',
    rallyMinPlaceholder: '분',
    rallySecPlaceholder: '초',
    arrivalLabel: '도착 예정',
    calcBtn: '계산',
    memberNamePlaceholder: '집결원 이름',
    memberNormalPlaceholder: '일반(초)',
    memberPetPlaceholder: '펫(초)',
    memberAddBtn: '추가',
    emptyRally: '집결 정보를 입력하고 추가하세요',
    emptyDispatch: '집결원을 추가하고 계산하세요',
    emptyNotice: '고정된 공지가 없어요',
    noticePin: '📌 고정하기',
    noticeTitlePlaceholder: '제목 (선택)',
    noticeContentPlaceholder: '공지 내용을 붙여넣으세요...',
    translateBtn: '번역하기',
    translateSource: '원문',
    translateResult: '번역 결과',
    copyBtn: '복사',
    copied: '복사됨!',
    langLabel: '내 언어',
    translating: '번역 중...',
    viewOriginal: '원문 보기',
    discord: '💬 디스코드',
    kakao: '🟡 카카오톡',
    game: '🎮 게임 내',
    delete: '삭제',
    translateHint: (lang) => `→ ${SUPPORTED_LANGS.find(l => l.code === lang)?.label || lang} 로 번역`,
    backToList: '목록',
    noticeWriteTitle: '새 공지 작성',
    chatPlaceholder: '메시지를 입력하세요...',
    chatSend: '전송',
    countdownStart: '시작',
    countdownStop: '정지',
    countdownSeconds: '초',
    viewTranslation: '번역 보기',
    logout: '로그아웃',
    // 게임 명칭에 맞춰 "수비 카운트"로 변경. 타 언어(en/ja/zh)는 번역가 검수 후 동기화 예정.
    countdown: '⏳ 수비 카운트',
  },
  en: {
    modalTitle: 'Enter server code',
    modalAllianceLabel: 'Select Alliance',
    modalNicknameLabel: 'Nickname',
    modalNicknamePlaceholder: 'Game nickname',
    modalJoin: 'Join',
    modalConnecting: 'Connecting...',
    modalDevSummary: '🔧 Developer Code',
    modalDevPlaceholder: 'Developer only code',
    onlineUsers: '👥 Online',
    onlineUsersDesc: 'Currently online',
    roleDeveloper: '👑 Dev',
    roleAdmin: '⚡ Admin',
    roleUser: 'User',
    tabDashboard: '🗺️ Dashboard',
    tabBattle: '⚔️ Battle',
    tabCommunity: '💬 Community',
    tabChat: '💬 Chat',
    tabNotices: 'Notices',
    boardPost: 'Post',
    emptyBoard: 'No posts yet',
    rallyTimer: '⏱️ Rally Timer',
    rallyTimerDesc: 'Track up to 6 rallies',
    dispatchTiming: '🚀 Dispatch Timing',
    dispatchDesc: 'Calculate send times by arrival',
    noticeboard: '📌 Notice Board',
    noticeboardDesc: 'Pin important notices',
    rallyAdd: 'Add',
    rallyNamePlaceholder: 'Rally name',
    rallyMinPlaceholder: 'min',
    rallySecPlaceholder: 'sec',
    arrivalLabel: 'Arrival',
    calcBtn: 'Calc',
    memberNamePlaceholder: 'Member name',
    memberNormalPlaceholder: 'Normal(s)',
    memberPetPlaceholder: 'Pet(s)',
    memberAddBtn: 'Add',
    emptyRally: 'Add a rally to start tracking',
    emptyDispatch: 'Add members and calculate',
    emptyNotice: 'No pinned notices',
    noticePin: '📌 Pin',
    noticeTitlePlaceholder: 'Title (optional)',
    noticeContentPlaceholder: 'Paste notice content here...',
    translateBtn: 'Translate',
    translateSource: 'Source',
    translateResult: 'Translation',
    copyBtn: 'Copy',
    copied: 'Copied!',
    langLabel: 'My Language',
    translating: 'Translating...',
    viewOriginal: 'View Original',
    discord: '💬 Discord',
    kakao: '🟡 KakaoTalk',
    game: '🎮 In-game',
    delete: 'Del',
    translateHint: (lang) => `→ ${SUPPORTED_LANGS.find(l => l.code === lang)?.label || lang}`,
    backToList: 'Back',
    noticeWriteTitle: 'New Notice',
    chatPlaceholder: 'Type a message...',
    chatSend: 'Send',
    countdownStart: 'Start',
    countdownStop: 'Stop',
    countdownSeconds: 's',
    viewTranslation: 'View Translation',
    logout: 'Logout',
    countdown: '⏳ Countdown',
  },
  ja: {
    modalTitle: 'サーバーコードを入力してください',
    modalAllianceLabel: '同盟を選択',
    modalNicknameLabel: 'ニックネーム',
    modalNicknamePlaceholder: 'ゲームニックネーム',
    modalJoin: '入場',
    modalConnecting: '接続中...',
    modalDevSummary: '🔧 開発者コード',
    modalDevPlaceholder: '開発者専用コード',
    onlineUsers: '👥 オンライン',
    onlineUsersDesc: '現在オンライン',
    roleDeveloper: '👑 開発者',
    roleAdmin: '⚡ 管理者',
    roleUser: '一般',
    tabDashboard: '🗺️ ダッシュボード',
    tabBattle: '⚔️ 戦闘状況',
    tabCommunity: '💬 コミュニティ',
    tabChat: '💬 チャット',
    tabNotices: 'お知らせ',
    boardPost: '投稿する',
    emptyBoard: '投稿がありません',
    rallyTimer: '⏱️ 集結タイマー',
    rallyTimerDesc: '最大6件同時追跡',
    dispatchTiming: '🚀 出兵タイミング',
    dispatchDesc: '到着時刻基準で出兵時刻を計算',
    noticeboard: '📌 お知らせボード',
    noticeboardDesc: '重要なお知らせを固定保管',
    rallyAdd: '追加',
    rallyNamePlaceholder: '集結名',
    rallyMinPlaceholder: '分',
    rallySecPlaceholder: '秒',
    arrivalLabel: '到着予定',
    calcBtn: '計算',
    memberNamePlaceholder: 'メンバー名',
    memberNormalPlaceholder: '通常(秒)',
    memberPetPlaceholder: 'ペット(秒)',
    memberAddBtn: '追加',
    emptyRally: '集結情報を入力してください',
    emptyDispatch: 'メンバーを追加して計算',
    emptyNotice: 'お知らせはありません',
    noticePin: '📌 固定する',
    noticeTitlePlaceholder: 'タイトル（任意）',
    noticeContentPlaceholder: 'お知らせ内容を貼り付け...',
    translateBtn: '翻訳する',
    translateSource: '原文',
    translateResult: '翻訳結果',
    copyBtn: 'コピー',
    copied: 'コピー済!',
    langLabel: '言語',
    translating: '翻訳中...',
    viewOriginal: '原文を見る',
    discord: '💬 Discord',
    kakao: '🟡 カカオトーク',
    game: '🎮 ゲーム内',
    delete: '削除',
    translateHint: (lang) => `→ ${SUPPORTED_LANGS.find(l => l.code === lang)?.label || lang} に翻訳`,
    backToList: '一覧',
    noticeWriteTitle: '新規お知らせ',
    chatPlaceholder: 'メッセージを入力...',
    chatSend: '送信',
    countdownStart: 'スタート',
    countdownStop: '停止',
    countdownSeconds: '秒',
    viewTranslation: '翻訳を見る',
    logout: 'ログアウト',
    countdown: '⏳ カウントダウン',
  },
  zh: {
    modalTitle: '请输入服务器代码',
    modalAllianceLabel: '选择联盟',
    modalNicknameLabel: '昵称',
    modalNicknamePlaceholder: '游戏昵称',
    modalJoin: '加入',
    modalConnecting: '连接中...',
    modalDevSummary: '🔧 开发者代码',
    modalDevPlaceholder: '开发者专用代码',
    onlineUsers: '👥 在线',
    onlineUsersDesc: '当前在线',
    roleDeveloper: '👑 开发者',
    roleAdmin: '⚡ 管理员',
    roleUser: '普通',
    tabDashboard: '🗺️ 仪表盘',
    tabBattle: '⚔️ 战斗状况',
    tabCommunity: '💬 社区',
    tabChat: '💬 聊天',
    tabNotices: '公告',
    boardPost: '发布',
    emptyBoard: '暂无帖子',
    rallyTimer: '⏱️ 集结计时器',
    rallyTimerDesc: '最多同时追踪6个集结',
    dispatchTiming: '🚀 派遣时机',
    dispatchDesc: '按到达时间计算派遣时间',
    noticeboard: '📌 公告板',
    noticeboardDesc: '固定重要公告',
    rallyAdd: '添加',
    rallyNamePlaceholder: '集结名称',
    rallyMinPlaceholder: '分',
    rallySecPlaceholder: '秒',
    arrivalLabel: '预计到达',
    calcBtn: '计算',
    memberNamePlaceholder: '成员名称',
    memberNormalPlaceholder: '普通(秒)',
    memberPetPlaceholder: '宠物(秒)',
    memberAddBtn: '添加',
    emptyRally: '请输入集结信息',
    emptyDispatch: '添加成员后计算',
    emptyNotice: '暂无固定公告',
    noticePin: '📌 固定',
    noticeTitlePlaceholder: '标题（可选）',
    noticeContentPlaceholder: '粘贴公告内容...',
    translateBtn: '翻译',
    translateSource: '原文',
    translateResult: '翻译结果',
    copyBtn: '复制',
    copied: '已复制!',
    langLabel: '我的语言',
    translating: '翻译中...',
    viewOriginal: '查看原文',
    discord: '💬 Discord',
    kakao: '🟡 KakaoTalk',
    game: '🎮 游戏内',
    delete: '删除',
    translateHint: (lang) => `→ 翻译为 ${SUPPORTED_LANGS.find(l => l.code === lang)?.label || lang}`,
    backToList: '返回',
    noticeWriteTitle: '新建公告',
    chatPlaceholder: '输入消息...',
    chatSend: '发送',
    countdownStart: '开始',
    countdownStop: '停止',
    countdownSeconds: '秒',
    viewTranslation: '查看翻译',
    logout: '退出',
    countdown: '⏳ 倒计时',
  },
};

// ─── 번역 캐시 (localStorage) ───
const TRANS_CACHE_KEY = 'wos-trans-cache';
const MAX_CACHE = 500;

function _getCache() {
  try { return JSON.parse(localStorage.getItem(TRANS_CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function _makeCacheKey(text, lang) {
  return `${lang}:${text.trim().substring(0, 80)}:${text.length}`;
}

export function getCachedTranslation(text, lang) {
  return _getCache()[_makeCacheKey(text, lang)] || null;
}

export function cacheTranslation(text, lang, translated) {
  const cache = _getCache();
  const entries = Object.keys(cache);
  if (entries.length >= MAX_CACHE) {
    const trimmed = {};
    entries.slice(-MAX_CACHE + 1).forEach((k) => { trimmed[k] = cache[k]; });
    trimmed[_makeCacheKey(text, lang)] = translated;
    localStorage.setItem(TRANS_CACHE_KEY, JSON.stringify(trimmed));
  } else {
    cache[_makeCacheKey(text, lang)] = translated;
    localStorage.setItem(TRANS_CACHE_KEY, JSON.stringify(cache));
  }
}

// ─── Context ───
const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(
    () => localStorage.getItem('wos-lang') || 'ko'
  );

  const t = useCallback((key) => {
    const texts = UI_TEXTS[lang] || UI_TEXTS.ko;
    const val = texts[key] !== undefined ? texts[key] : (UI_TEXTS.ko[key] ?? key);
    return val;
  }, [lang]);

  const changeLang = useCallback((code) => {
    localStorage.setItem('wos-lang', code);
    setLangState(code);
  }, []);

  return (
    <I18nContext.Provider value={{ lang, t, changeLang, SUPPORTED_LANGS }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
