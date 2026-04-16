// tts.constants.ts — TTS 공통 상수 및 유틸리티

export const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
export type TtsLang = typeof LANGS[number];

// ElevenLabs language_code 매핑
export const LANG_CODES: Record<string, string> = {
  ko: 'ko', en: 'en', ja: 'ja', zh: 'zh',
};

// 카운트다운 문구 (서비스·컨트롤러 공통 사용)
export const PHRASES: Record<string, Record<string, string>> = {
  start:  { ko: '카운트다운을 시작합니다.', en: 'Countdown starting.', ja: 'カウントダウンを開始します。', zh: '倒计时开始。' },
  stop:   { ko: '카운트다운이 중지되었습니다.', en: 'Countdown stopped.', ja: 'カウントダウンが中止されました。', zh: '倒计时已停止。' },
  finish: { ko: '시작!', en: 'Start!', ja: '始め!', zh: '开始!' },
};

// 숫자 범위
export const TTS_NUM_MIN = 1;
export const TTS_NUM_MAX = 600;  // 유효성 검사 상한 (최대 프리셋 10분)

// 사전 생성 상한 — 무료 티어: 1~180 ≈ 6,000글자/4개언어 (10,000글자/월 이내)
// Starter 이상으로 업그레이드 시 600으로 올려도 됨
export const TTS_PREGEN_MAX = 180;

/**
 * 허용된 TTS 키인지 검증 — 화이트리스트 초과 요청으로 ElevenLabs 비용 폭탄 방지
 * 유효한 키: PHRASES 키(start/stop/finish) 또는 1~600 사이의 정수
 */
export function isValidTtsKey(key: string): boolean {
  if (PHRASES[key]) return true;
  if (/^\d+$/.test(key)) {
    const n = parseInt(key, 10);
    return n >= TTS_NUM_MIN && n <= TTS_NUM_MAX;
  }
  return false;
}

/** 키에 해당하는 TTS 텍스트 반환 */
export function getTtsText(lang: string, key: string): string {
  if (PHRASES[key]) return PHRASES[key][lang] || PHRASES[key]['en'];
  return key; // 숫자는 그대로
}
