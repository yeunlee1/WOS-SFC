// tts.constants.ts — TTS 공통 상수 및 유틸리티

export const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
export type TtsLang = typeof LANGS[number];

// Google Cloud TTS 음성 매핑 — Wavenet 계열 (SSML <prosody> 태그 완전 지원)
//
// 왜 Chirp3-HD 대신 Wavenet인가:
//   사용자 요청 "모든 숫자 음정 일정하게" 구현을 위해 <prosody pitch="0st">
//   사용이 필수인데, Chirp3-HD는 SSML prosody 를 지원하지 않아 pitch 강제가
//   불가능하다. Wavenet은 prosody/rate/pitch/volume 모두 지원.
//   음질은 Chirp3 > Wavenet 이지만 카운트다운 숫자 읽기 용도에서는 Wavenet도
//   충분히 자연스럽다.
export const GOOGLE_VOICES: Record<string, { languageCode: string; name: string }> = {
  ko: { languageCode: 'ko-KR', name: 'ko-KR-Wavenet-A' },
  en: { languageCode: 'en-US', name: 'en-US-Wavenet-F' },
  ja: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-B' },
  zh: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-A' },
};

// 카운트다운 문구 (서비스·컨트롤러 공통 사용)
export const PHRASES: Record<string, Record<string, string>> = {
  start:  { ko: '준비해주세요.', en: 'Get ready.', ja: '準備してください。', zh: '请准备。' },
  stop:   { ko: '카운트다운이 중지되었습니다.', en: 'Countdown stopped.', ja: 'カウントダウンが中止されました。', zh: '倒计时已停止。' },
};

// 숫자 범위
export const TTS_NUM_MIN = 1;
export const TTS_NUM_MAX = 180;  // 최대 허용 상한 (3분 = 180초)

// 사전 생성 상한 — 최대 프리셋 3분(180초) 기준
// 1~180 × 4개 언어 + 문구 ≈ 약 2,200자 (무료 티어 1,000,000자 이내)
export const TTS_PREGEN_MAX = 180;

/**
 * 허용된 TTS 키인지 검증 — 화이트리스트 초과 요청으로 API 비용 폭탄 방지
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
  return key; // 숫자는 그대로 (서비스에서 SSML로 감쌈)
}
