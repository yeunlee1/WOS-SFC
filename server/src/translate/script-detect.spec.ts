// 스크립트 판별이 계약 픽스처 8문장을 규칙대로 분류하는지 검증한다.
import fixtures from '../../../docs/contracts/chat-events.json';
import {
  detectScript,
  effectiveLang,
  hasLetters,
  unambiguousLang,
} from './script-detect';

type ScriptFixture = { text: string; script: string; unambiguous: string | null };

const scriptFixtures = (fixtures as { 'script-fixtures': ScriptFixture[] })[
  'script-fixtures'
];

describe('detectScript / unambiguousLang', () => {
  it('픽스처가 8문장이다(공유 계약이 줄어들면 잡는다)', () => {
    expect(scriptFixtures).toHaveLength(8);
  });

  it.each(scriptFixtures.map((f) => [f.text, f.script, f.unambiguous]))(
    '%s → %s / %s',
    (text, script, unambiguous) => {
      expect(detectScript(text as string)).toBe(script);
      expect(unambiguousLang(text as string)).toBe(unambiguous);
    },
  );

  it('가나와 한자가 섞인 문장은 ja(단일)이지 mixed가 아니다', () => {
    expect(detectScript('要塞戦の準備をしてください')).toBe('ja');
    expect(unambiguousLang('要塞戦の準備をしてください')).toBe('ja');
  });

  it('한글과 한자가 섞이면 mixed다', () => {
    expect(detectScript('요새 要塞')).toBe('mixed');
    expect(unambiguousLang('요새 要塞')).toBeNull();
  });

  it('빈 문자열은 none이다', () => {
    expect(detectScript('')).toBe('none');
    expect(unambiguousLang('')).toBeNull();
  });
});

describe('hasLetters', () => {
  it.each([
    ['456,789 👍', false],
    ['', false],
    ['   ', false],
    ['a', true],
    ['가', true],
    ['あ', true],
    ['漢', true],
    ['я', true],
  ])('%s → %s', (text, expected) => {
    expect(hasLetters(text)).toBe(expected);
  });
});

describe('effectiveLang', () => {
  it.each([
    ['ko', 'ko'],
    ['en', 'en'],
    ['ja', 'ja'],
    ['zh', 'zh'],
    ['ru', 'ru'],
    ['other', 'en'],
    [undefined, 'en'],
    [null, 'en'],
    ['xx', 'en'],
    ['', 'en'],
  ])('%s → %s', (input, out) => {
    expect(effectiveLang(input as string | null | undefined)).toBe(out);
  });
});
