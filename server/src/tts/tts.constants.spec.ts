// TTS 라우트 입력이 canonical allowlist 값으로만 변환되는지 검증한다.
import {
  LANGS,
  getTtsText,
  isValidTtsKey,
  parseTtsKey,
  parseTtsLang,
} from './tts.constants';

describe('TTS 입력 canonicalization', () => {
  it('지원 언어와 등록 문구·canonical 숫자만 반환한다', () => {
    expect(parseTtsLang('ko')).toBe('ko');
    expect(parseTtsLang('KO')).toBeNull();
    expect(parseTtsKey('start')).toBe('start');
    expect(parseTtsKey('1')).toBe('1');
    expect(parseTtsKey('180')).toBe('180');
  });

  it.each([
    '__proto__',
    'constructor',
    'toString',
    '../1',
    '..\\1',
    '001',
    '0',
    '181',
  ])('경로·prototype·비정규 숫자 키 %s를 거부한다', (key) => {
    expect(parseTtsKey(key)).toBeNull();
    expect(isValidTtsKey(key)).toBe(false);
  });
});

// 개인 출발 안내 음성.
// web/src/components/Battle/PersonalPanel.jsx 가 speak('march', lang) 을 호출하고
// web/src/components/Battle/Countdown.jsx 가 prefetchTts(['start','stop','march']) 를
// 호출한다. 서버 PHRASES 에 march 가 없으면 parseTtsKey 가 null 을 반환해
// GET /tts-audio/:lang/march 가 404 로 떨어지고, 클라이언트는 폴백 없이 무음이 된다.
describe('개인 출발 안내(march) 문구', () => {
  it('march 키가 canonical allowlist 에 포함된다', () => {
    expect(parseTtsKey('march')).toBe('march');
    expect(isValidTtsKey('march')).toBe(true);
  });

  it.each([...LANGS])('%s 문구가 등록되어 있다 (키 문자열이 새어 나오지 않는다)', (lang) => {
    const text = getTtsText(lang, 'march');
    expect(typeof text).toBe('string');
    expect(text.trim().length).toBeGreaterThan(0);
    // PHRASES 미등록이면 getTtsText 가 키를 그대로 돌려준다 — 그 경우 실패해야 한다.
    expect(text).not.toBe('march');
  });

  it('4개 언어 문구가 서로 달라 en 폴백으로 뭉개지지 않았다', () => {
    const texts = LANGS.map((lang) => getTtsText(lang, 'march'));
    expect(new Set(texts).size).toBe(LANGS.length);
  });
});
