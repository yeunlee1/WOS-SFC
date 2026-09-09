// WOS 용어집이 5열을 갖추고, 문장에 등장한 용어만 대상 언어 순서로 골라내는지 검증한다.
import { GLOSSARY, selectGlossaryLines } from './glossary';
import { TARGET_LANGS } from './script-detect';

describe('GLOSSARY 데이터', () => {
  it('모든 행이 5개 언어 열을 갖고 대표 표기(첫 원소)가 비어 있지 않다', () => {
    expect(GLOSSARY.length).toBeGreaterThan(0);
    for (const row of GLOSSARY) {
      for (const lang of TARGET_LANGS) {
        expect(Array.isArray(row[lang])).toBe(true);
        expect(row[lang].length).toBeGreaterThan(0);
        expect(row[lang][0].trim()).not.toBe('');
      }
    }
  });

  it.each(['집결', '화로', '창병', '사수', '보병', '요새전', '곰 사냥'])(
    '핵심 용어 %s 가 ko 열에 있다',
    (term) => {
      expect(GLOSSARY.some((row) => row.ko.includes(term))).toBe(true);
    },
  );
});

describe('selectGlossaryLines', () => {
  it('문장에 등장한 용어만 고른다', () => {
    const lines = selectGlossaryLines('10분 뒤 집결 갑니다', ['en']);
    expect(lines).toEqual(['집결=rally']);
    expect(lines.some((l) => l.startsWith('화로='))).toBe(false);
  });

  it('별칭(창기병)으로도 행을 찾고 매칭된 표기를 왼쪽에 쓴다', () => {
    expect(selectGlossaryLines('창기병 보내주세요', ['en'])).toEqual([
      '창기병=Lancer',
    ]);
  });

  it('영어 원문은 대소문자를 무시하고 복수형도 잡는다', () => {
    expect(selectGlossaryLines('send LANCERS now', ['ko'])).toEqual([
      'Lancer=창병',
    ]);
    expect(selectGlossaryLines('two fortresses', ['ko'])).toEqual([
      'fortress=요새',
    ]);
  });

  it('영어 별칭은 단어 경계 안에서만 잡는다', () => {
    // "powerful" 안의 power, "waves" 는 복수형이라 잡히지만 "wavelength" 는 아니다.
    expect(selectGlossaryLines('powerful wavelength', ['ko'])).toEqual([]);
    expect(selectGlossaryLines('three waves', ['ko'])).toEqual(['wave=웨이브']);
  });

  it('키릴 원문은 대소문자를 무시하고 어미가 바뀐 형태(부분 일치·어간 별칭)도 잡는다', () => {
    expect(selectGlossaryLines('Сбор через 5 минут', ['ko'])).toEqual([
      'сбор=집결',
    ]);
    // копейщики(복수)·стрелки(복수)·замке(전치격) — 단어 경계 규칙이면 전부 놓친다.
    expect(selectGlossaryLines('копейщики и стрелки в замке', ['ko'])).toEqual([
      'замк=성',
      'Копейщик=창병',
      'стрелк=사수',
    ]);
  });

  it('SFC 는 태그처럼 쓰여 영어 대표 표기가 SFC 다(ko 열 별칭으로 매칭되므로 en 도 오른쪽에 남는다)', () => {
    expect(selectGlossaryLines('SFC 집결 go', ['en', 'ja'])).toEqual([
      '집결=rally|集結',
      'SFC=SFC|サンファイア城',
    ]);
  });

  it('한 글자 한국어(성)는 단어 경계와 조사 앞에서만 잡는다', () => {
    expect(selectGlossaryLines('완성했어요', ['en'])).toEqual([]);
    expect(selectGlossaryLines('성에 주둔', ['en'])).toEqual([
      '성=castle',
      '주둔=garrison',
    ]);
    expect(selectGlossaryLines('성 공격', ['en'])).toEqual(['성=castle']);
    expect(selectGlossaryLines('성벽', ['en'])).toEqual([]);
  });

  it('상한 12행을 넘기지 않는다', () => {
    const text =
      '집결 연맹 요새 화로 보병 창병 사수 병력 행군 주둔 정찰 텔포 좌표 전투력 영웅 웨이브';
    const lines = selectGlossaryLines(text, ['en']);
    expect(lines).toHaveLength(12);
    expect(selectGlossaryLines(text, ['en'], 3)).toHaveLength(3);
  });

  it('용어가 없으면 빈 배열이다', () => {
    expect(selectGlossaryLines('안녕하세요 반갑습니다', ['en', 'ja'])).toEqual(
      [],
    );
    expect(selectGlossaryLines('', ['en'])).toEqual([]);
  });

  it('대상 언어 순서대로 | 로 잇는다', () => {
    expect(selectGlossaryLines('집결', ['en', 'ja'])).toEqual([
      '집결=rally|集結',
    ]);
    expect(selectGlossaryLines('집결', ['ja', 'en'])).toEqual([
      '집결=集結|rally',
    ]);
    expect(selectGlossaryLines('집결', ['ko', 'en', 'ja', 'zh', 'ru'])).toEqual(
      ['집결=rally|集結|集结|сбор'],
    );
  });

  it('대상 언어가 매칭된 열뿐이면 그 행은 넣지 않는다', () => {
    expect(selectGlossaryLines('집결', ['ko'])).toEqual([]);
  });
});
