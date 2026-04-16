// tts.constants.ts — TTS 공통 상수 및 유틸리티

export const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
export type TtsLang = typeof LANGS[number];

// Google Cloud TTS Chirp3-HD 음성 매핑 (4개 언어 동일 모델 패밀리 사용)
export const GOOGLE_VOICES: Record<string, { languageCode: string; name: string }> = {
  ko: { languageCode: 'ko-KR', name: 'ko-KR-Chirp3-HD-Aoede' },
  en: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Aoede' },
  ja: { languageCode: 'ja-JP', name: 'ja-JP-Chirp3-HD-Aoede' },
  zh: { languageCode: 'cmn-CN', name: 'cmn-CN-Chirp3-HD-Aoede' },
};

// 카운트다운 문구 (서비스·컨트롤러 공통 사용)
export const PHRASES: Record<string, Record<string, string>> = {
  start:  { ko: '준비해주세요.', en: 'Get ready.', ja: '準備してください。', zh: '请准备。' },
  stop:   { ko: '카운트다운이 중지되었습니다.', en: 'Countdown stopped.', ja: 'カウントダウンが中止されました。', zh: '倒计时已停止。' },
};

// 숫자 범위
export const TTS_NUM_MIN = 1;
export const TTS_NUM_MAX = 600;  // 유효성 검사 상한 (최대 프리셋 10분)

// 사전 생성 상한 — Google TTS 무료 티어: 월 1,000,000자 이내
// 1~600 × 4개 언어 ≈ 약 7,000자 — 넉넉하게 600까지 사전 생성 가능
export const TTS_PREGEN_MAX = 600;

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
