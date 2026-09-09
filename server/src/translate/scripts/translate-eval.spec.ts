// 평가 스크립트의 채점(발신 언어 칸 원문 보존)과 마크다운 표 이스케이프(백슬래시·파이프)를 검증한다. OpenAI 는 부르지 않는다.
import {
  EVAL_CASES,
  EvalCase,
  ModelSummary,
  renderFullOutputs,
  renderMarkdown,
  scoreCase,
} from './translate-eval';

describe('scoreCase — 발신 언어 칸', () => {
  const c: EvalCase = {
    group: '발신어 포함',
    text: 'Bear trap starts at reset, garrison your troops in the fortress.',
    source: ['en'],
    targets: ['en', 'ko'],
    expect: { en: [], ko: ['곰 사냥', '요새'] },
  };

  it('발신 언어 칸이 원문과 다르면(용어만 치환) 오출력 "원문 미보존" 이다', () => {
    const result = scoreCase(
      c,
      'en',
      {
        en: '곰 사냥 starts at reset, garrison your troops in the 요새.',
        ko: '곰 사냥은 리셋에 시작합니다. 요새에 병력을 주둔시키세요.',
      },
      'en',
    );
    expect(result.misOutput).toEqual(['en:원문 미보존']);
  });

  it('발신 언어 칸이 원문 그대로면 오출력이 없다', () => {
    const result = scoreCase(
      c,
      'en',
      { en: c.text, ko: '곰 사냥은 리셋에 시작합니다. 요새에 병력을 주둔시키세요.' },
      'en',
    );
    expect(result.misOutput).toEqual([]);
  });
});

describe('EVAL_CASES — 핫픽스 재현 문장', () => {
  it('대상 집합에 발신 언어가 포함된 두 문장(영어 원문·SFC 섞인 한국어)이 있다', () => {
    const withSelf = EVAL_CASES.filter(
      (c) => c.source.length === 1 && (c.targets as string[]).includes(c.source[0]),
    );
    expect(withSelf.map((c) => c.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Bear trap starts at reset'),
        expect.stringContaining('10분 뒤 SFC 집결 갑니다'),
      ]),
    );
  });
});

describe('renderMarkdown / renderFullOutputs — 표 셀 이스케이프', () => {
  const summary: ModelSummary = {
    model: 'm',
    cases: [
      {
        text: 't',
        group: 'g',
        source: 'ko',
        sourceOk: true,
        outputs: { en: 'a\\b | c' },
        termHits: 0,
        termTotal: 1,
        missing: ['en:x'],
        misOutput: [],
        ms: 1,
        inputTokens: 1,
        outputTokens: 1,
      },
    ],
    termHits: 0,
    termTotal: 1,
    misOutputCases: 0,
    sourceOk: 1,
    sourceTotal: 1,
    avgMs: 1,
    avgInput: 1,
    avgOutput: 1,
    costPerSentenceUsd: null,
    errors: 0,
    byGroup: { g: { hits: 0, total: 1, mis: 0 } },
  };

  it('출력 셀의 백슬래시와 파이프를 둘 다 이스케이프한다(CodeQL js/incomplete-sanitization)', () => {
    expect(renderMarkdown([summary])).toContain('en: a\\\\b \\| c');
    expect(renderFullOutputs([summary])).toContain('en: a\\\\b \\| c');
  });
});
