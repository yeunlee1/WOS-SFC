// TTS 라우트 입력이 canonical allowlist 값으로만 변환되는지 검증한다.
import { isValidTtsKey, parseTtsKey, parseTtsLang } from './tts.constants';

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
