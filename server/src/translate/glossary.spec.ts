// WOS 용어집이 5열을 갖추고, 문장에 등장한 용어만 언어 코드 라벨 형식(`매칭표기 → en: …; ko: …`)으로 골라내는지 검증한다.
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
    expect(lines).toEqual(['집결 → en: rally']);
    expect(lines.some((l) => l.startsWith('화로 →'))).toBe(false);
  });

  it('별칭(창기병)으로도 행을 찾고 매칭된 표기를 왼쪽에 쓴다', () => {
    expect(selectGlossaryLines('창기병 보내주세요', ['en'])).toEqual([
      '창기병 → en: Lancer',
    ]);
  });

  it('영어 원문은 대소문자를 무시하고 복수형도 잡는다', () => {
    expect(selectGlossaryLines('send LANCERS now', ['ko'])).toEqual([
      'Lancer → ko: 창병',
    ]);
    expect(selectGlossaryLines('two fortresses', ['ko'])).toEqual([
      'fortress → ko: 요새',
    ]);
  });

  it('영어 별칭은 단어 경계 안에서만 잡는다', () => {
    // "powerful" 안의 power, "waves" 는 복수형이라 잡히지만 "wavelength" 는 아니다.
    expect(selectGlossaryLines('powerful wavelength', ['ko'])).toEqual([]);
    expect(selectGlossaryLines('three waves', ['ko'])).toEqual(['wave → ko: 웨이브']);
  });

  it('키릴 원문은 대소문자를 무시하고 어미가 바뀐 형태(부분 일치·어간 별칭)도 잡는다', () => {
    expect(selectGlossaryLines('Сбор через 5 минут', ['ko'])).toEqual([
      'сбор → ko: 집결',
    ]);
    // копейщики(복수)·стрелки(복수)·замке(전치격) — 단어 경계 규칙이면 전부 놓친다.
    expect(selectGlossaryLines('копейщики и стрелки в замке', ['ko'])).toEqual([
      'замк → ko: 성',
      'Копейщик → ko: 창병',
      'стрелк → ko: 사수',
    ]);
  });

  it('SFC 는 태그처럼 쓰여 영어 대표 표기가 SFC 다(ko 열 별칭으로 매칭되므로 en 도 오른쪽에 남는다)', () => {
    expect(selectGlossaryLines('SFC 집결 go', ['en', 'ja'])).toEqual([
      '집결 → en: rally; ja: 集結',
      'SFC → en: SFC; ja: サンファイア城',
    ]);
  });

  it('한 글자 한국어(성)는 단어 경계와 조사 앞에서만 잡는다', () => {
    expect(selectGlossaryLines('완성했어요', ['en'])).toEqual([]);
    expect(selectGlossaryLines('성에 주둔', ['en'])).toEqual([
      '성 → en: castle',
      '주둔 → en: garrison',
    ]);
    expect(selectGlossaryLines('성 공격', ['en'])).toEqual(['성 → en: castle']);
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

  it('대상 언어 순서대로 언어 코드 라벨을 붙여 ; 로 잇는다', () => {
    expect(selectGlossaryLines('집결', ['en', 'ja'])).toEqual([
      '집결 → en: rally; ja: 集結',
    ]);
    expect(selectGlossaryLines('집결', ['ja', 'en'])).toEqual([
      '집결 → ja: 集結; en: rally',
    ]);
  });

  // 2026-09-10 E2E 핫픽스 — 대상에 발신 언어가 포함될 때(영어 원문·SFC 섞인 한국어) 매칭된 열의 언어를
  // 빼면 라벨 없는 값을 모델이 엉뚱한 칸에 넣는다. 매칭 열의 언어도 대표 표기와 함께 넣는다.
  it('대상에 매칭된 열의 언어가 포함되면 그 언어의 대표 표기도 라벨과 함께 넣는다(영어 원문·대상 en,ko)', () => {
    expect(
      selectGlossaryLines(
        'Bear trap starts at reset, garrison your troops in the fortress.',
        ['en', 'ko'],
      ),
    ).toEqual([
      'bear trap → en: Bear Hunt; ko: 곰 사냥',
      'fortress → en: fortress; ko: 요새',
      'troops → en: troops; ko: 병력',
      'garrison → en: garrison; ko: 주둔',
    ]);
  });

  it('SFC 가 섞인 한국어 원문·대상 en,ko 도 ko 표기를 라벨과 함께 넣는다', () => {
    expect(
      selectGlossaryLines('10분 뒤 SFC 집결 갑니다. 창병 위주로 넣어주세요.', ['en', 'ko']),
    ).toEqual([
      '집결 → en: rally; ko: 집결',
      'SFC → en: SFC; ko: SFC',
      '창병 → en: Lancer; ko: 창병',
    ]);
    expect(selectGlossaryLines('집결', ['ko', 'en', 'ja', 'zh', 'ru'])).toEqual([
      '집결 → ko: 집결; en: rally; ja: 集結; zh: 集结; ru: сбор',
    ]);
  });

  it('대상 언어가 매칭된 열뿐이면 그 행은 넣지 않는다(정보가 없는 줄)', () => {
    expect(selectGlossaryLines('집결', ['ko'])).toEqual([]);
  });
});
