import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// AuthModal.jsx의 NICKNAME_REGEX 리터럴이 서버 SignupDto 정책과 동일한지 가드.
// (정규식 자체는 export되지 않으므로 소스 파싱으로 추출 — 정책이 바뀌면 테스트가 깨져
//  서버측 dto-validation.spec.ts와 함께 갱신해야 함을 강제함.)
const __dirname = dirname(fileURLToPath(import.meta.url));
const authModalSrc = readFileSync(
  resolve(__dirname, '..', 'AuthModal.jsx'),
  'utf8',
);

// 정규식 리터럴 추출 — 한 줄에 정의된 const NICKNAME_REGEX = /.../; 패턴을 캡처
const match = authModalSrc.match(/const\s+NICKNAME_REGEX\s*=\s*(\/[^\n;]+\/);/);
if (!match) {
  throw new Error('AuthModal.jsx에서 NICKNAME_REGEX 정의를 찾지 못했습니다.');
}
// eslint-disable-next-line no-eval -- 테스트에서 신뢰된 자체 소스 파싱
const NICKNAME_REGEX = eval(match[1]);

describe('AuthModal NICKNAME_REGEX — 클라이언트 측 닉네임 검증 정책', () => {
  describe('통과 케이스', () => {
    it.each([
      ['영문+숫자', 'tester01'],
      ['순수 영문 2자', 'ab'],
      ['한글 완성형 2자', '테스'],
      ['한글+영문+숫자 혼합', '닉네임abc1'],
      ['한글 20자 경계', '가'.repeat(20)],
      ['영문 20자 경계', 'a'.repeat(20)],
    ])('%s 통과 — %s', (_, value) => {
      expect(NICKNAME_REGEX.test(value)).toBe(true);
    });
  });

  describe('거부 케이스', () => {
    it.each([
      ['빈 문자열', ''],
      ['1자 영문 (MinLength 미만)', 'a'],
      ['1자 한글 (MinLength 미만)', '가'],
      ['21자 (MaxLength 초과)', 'a'.repeat(21)],
      ['특수문자 포함', 'tester!'],
      ['공백 포함', 'test er'],
      ['언더스코어', 'test_er'],
      ['하이픈', 'test-er'],
      ['한글 단일 자모(ㄱㄴ)', 'ㄱㄴ'],
      ['한글 모음 분리(ㅎㅏ)', 'ㅎㅏ'],
      ['zero-width space 포함', 'tes​ter'],
      ['이모지 포함', 'tester🚀'],
      ['중국어(번체) 거부', '中文'],
      ['일본어 히라가나 거부', 'にほん'],
    ])('%s 거부 — %s', (_, value) => {
      expect(NICKNAME_REGEX.test(value)).toBe(false);
    });
  });

  it('서버 SignupDto와 동일한 패턴 — /^[A-Za-z0-9가-힣]{2,20}$/', () => {
    expect(NICKNAME_REGEX.source).toBe('^[A-Za-z0-9가-힣]{2,20}$');
    expect(NICKNAME_REGEX.flags).toBe('');
  });
});
