// 채팅 항목 공용 포맷 — locale·시간·이니셜. ChatTab·ChatDock·작전판 패널·동화 버전이 같은 값을 쓴다 (B-18).
const LOCALES = {
  ko: 'ko-KR',
  en: 'en-US',
  ja: 'ja-JP',
  zh: 'zh-CN',
  ru: 'ru-RU',
};

// UI 문구가 en으로 폴백하는 언어(other·미지)는 시간 표기도 en-US로 맞춘다.
export function localeFor(lang) {
  return LOCALES[lang] || 'en-US';
}

export function formatMessageTime(createdAt, lang) {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(localeFor(lang), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function initialsOf(nickname) {
  return (nickname || '??').slice(0, 2).toUpperCase();
}
