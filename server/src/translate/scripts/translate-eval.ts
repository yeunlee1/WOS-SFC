// 번역 품질 평가 스크립트 — 운영 엔진(TranslateEngineService)을 그대로 불러 문장 세트를 모델별로 돌리고
// 용어 적중률·오출력·source 정확도·평균 ms·토큰·문장당 비용을 표로 만든다. 실제 OpenAI 를 호출한다(비용 발생).
//
// 실행:  npm --workspace server run translate:eval -- --models gpt-5.4-mini,gpt-5.4-nano [--out 파일] [--limit N]
//        server/.env 의 OPENAI_API_KEY 를 읽는다(npm 스크립트가 --env-file-if-exists=.env 로 넘긴다).
//
// 프롬프트·스키마·용어집·분할 규칙을 여기서 다시 구현하지 않는다 — 엔진 클래스를 직접 쓰므로 평가 결과가
// 운영 동작과 같다. 문장 세트는 반장 실측(번역-실측-2026-09-09.md) 10문장을 포함한 40문장이다.
import { ConfigService } from '@nestjs/config';
import { writeFileSync } from 'fs';
import { Lang, TARGET_LANGS } from '../script-detect';
import {
  SourceLang,
  TranslateEngineService,
  TranslateProviderError,
} from '../translate-engine.service';
import { TranslateUsageRecord, TranslateUsageService } from '../translate-usage.service';

/** 평가 문장. expect 의 용어는 대소문자 무시 부분 일치이고 `a|b` 는 둘 중 하나면 된다. */
export interface EvalCase {
  group: string;
  text: string;
  /** 모델이 돌려줘야 할 source. 여럿이면 그중 하나. */
  source: SourceLang[];
  targets: Lang[];
  expect: Partial<Record<Lang, string[]>>;
  /** 스크립트 비율·잔존 검사를 건너뛴다(글자가 없거나 언어가 모호한 특수 문장). */
  lenient?: boolean;
}

const ALL_FROM = (skip: Lang): Lang[] => TARGET_LANGS.filter((l) => l !== skip);

export const EVAL_CASES: EvalCase[] = [
  // ko → en/ja/zh/ru (반장 실측 7문장 포함)
  { group: 'ko→*', text: '10분 뒤 SFC 집결 갑니다. 창병 위주로 넣어주세요.', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['rally', 'lancer'], ja: ['集結', '槍兵'], zh: ['集结', '枪兵'], ru: ['сбор', 'копейщик'] } },
  { group: 'ko→*', text: '곰 사냥 집결 5분 남았어요, 병력 꽉 채워서 참여!', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['bear hunt', 'rally', 'troops'], ja: ['クマ狩り', '集結', '兵力'], zh: ['猎熊', '集结', '部队|兵力'], ru: ['охот', 'сбор', 'войск'] } },
  { group: 'ko→*', text: '행군 시간 1분 30초인 분들은 지금 출발하세요.', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['march time'], ja: ['行軍時間'], zh: ['行军时间'], ru: ['марш'] } },
  { group: 'ko→*', text: '적 방패 벗겨졌음. 좌표 456,789 정찰 부탁.', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['shield', '456,789', 'scout'], ja: ['シールド', '456,789', '偵察'], zh: ['护盾', '456,789', '侦察'], ru: ['щит', '456,789', 'развед'] } },
  { group: 'ko→*', text: '화로 30렙 찍었습니다 ㅋㅋ', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['furnace', '30'], ja: ['溶鉱炉', '30'], zh: ['熔炉', '30'], ru: ['печ', '30'] } },
  { group: 'ko→*', text: '수비 병력 성에 주둔시켜 주세요. 텔포 준비.', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['garrison', 'castle', 'teleport'], ja: ['駐屯', '城', 'テレポート'], zh: ['驻防', '城堡', '传送'], ru: ['гарнизон', 'замок', 'телепорт'] } },
  { group: 'ko→*', text: '요새전 두 번째 웨이브에서 사수 비율 올려주세요.', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['fortress battle', 'wave', 'marksm'], ja: ['要塞戦', 'ウェーブ', '射手'], zh: ['要塞战', '波次|波', '射手'], ru: ['битв', 'волн', 'стрел'] } },
  { group: 'ko→*', text: '연맹 리더가 집결장 맡습니다, 보병 넣어주세요.', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['alliance', 'rally leader', 'infantry'], ja: ['同盟', '集結リーダー', '歩兵'], zh: ['联盟', '集结队长', '步兵'], ru: ['альянс', 'лидер', 'сбор', 'пехот'] } },
  { group: 'ko→*', text: '전투력 낮은 분들은 영웅만 보내세요.', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['power', 'hero'], ja: ['戦闘力', '英雄'], zh: ['战力', '英雄'], ru: ['мощ', 'геро'] } },
  { group: 'ko→*', text: '이주 오신 분들 서버 채팅에서 인사해요.', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['transfer', 'state'], ja: ['移住', 'サーバー'], zh: ['迁服', '州'], ru: ['переезд|переех', 'штат'] } },
  { group: 'ko→*', text: '보호막 언제 풀려요? 텔레포트 자리 잡아둘게요.', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['shield', 'teleport'], ja: ['シールド', 'テレポート'], zh: ['护盾', '传送'], ru: ['щит', 'телепорт'] } },
  { group: 'ko→*', text: '정찰 결과 궁병만 있어요, 창기병으로 치면 됩니다.', source: ['ko'], targets: ALL_FROM('ko'), expect: { en: ['scout', 'marksm', 'lancer'], ja: ['偵察', '射手', '槍兵'], zh: ['侦察', '射手', '枪兵'], ru: ['развед', 'стрел', 'копейщик'] } },
  // en → ko (반장 실측 2문장 포함)
  { group: 'en→ko', text: 'Rally on the castle in 3 min, fill with lancers, no marksmen please.', source: ['en'], targets: ['ko'], expect: { ko: ['집결', '성', '창병', '사수|궁병'] } },
  { group: 'en→ko', text: 'Bear trap starts at reset, garrison your troops in the fortress.', source: ['en'], targets: ['ko'], expect: { ko: ['곰 사냥|곰 함정|곰사냥', '주둔', '병력', '요새'] } },
  { group: 'en→ko', text: 'Shield is down at 123,456 - scout it now.', source: ['en'], targets: ['ko'], expect: { ko: ['방패|보호막', '123,456', '정찰'] } },
  { group: 'en→ko', text: 'Furnace 30 finally lol, my power is 50M now.', source: ['en'], targets: ['ko'], expect: { ko: ['화로', '30', '전투력', '50M'] } },
  { group: 'en→ko', text: 'Rally leader will be me, send infantry only.', source: ['en'], targets: ['ko'], expect: { ko: ['집결장|집결 리더', '보병'] } },
  { group: 'en→ko', text: 'Teleport next to the alliance castle before the fortress battle.', source: ['en'], targets: ['ko'], expect: { ko: ['텔포|텔레포트', '연맹', '성', '요새전'] } },
  { group: 'en→ko', text: 'Second wave in 2 min, march time under 1:00 go now.', source: ['en'], targets: ['ko'], expect: { ko: ['웨이브', '행군', '1:00'] } },
  { group: 'en→ko', text: 'gg everyone, transfer to state 1234 tomorrow', source: ['en'], targets: ['ko'], expect: { ko: ['이주', '서버', '1234'] } },
  // ja → ko
  { group: 'ja→ko', text: '集結まで5分、兵力を満タンに', source: ['ja'], targets: ['ko'], expect: { ko: ['집결', '5분', '병력'] } },
  { group: 'ja→ko', text: '要塞戦の準備をしてください、槍兵を多めに', source: ['ja'], targets: ['ko'], expect: { ko: ['요새전', '창병'] } },
  { group: 'ja→ko', text: '溶鉱炉30になった、駐屯お願いします', source: ['ja'], targets: ['ko'], expect: { ko: ['화로', '30', '주둔'] } },
  { group: 'ja→ko', text: '座標456,789を偵察して、シールドが切れてる', source: ['ja'], targets: ['ko'], expect: { ko: ['좌표', '456,789', '정찰', '방패|보호막'] } },
  { group: 'ja→ko', text: 'クマ狩りの集結リーダーは誰？', source: ['ja'], targets: ['ko'], expect: { ko: ['곰 사냥|곰사냥', '집결장|집결 리더'] } },
  // zh → ko (반장 실측 1문장 포함)
  { group: 'zh→ko', text: '熔炉30级了，集结准备好了吗？', source: ['zh'], targets: ['ko'], expect: { ko: ['화로', '30', '집결'] } },
  { group: 'zh→ko', text: '要塞战第二波多放射手', source: ['zh'], targets: ['ko'], expect: { ko: ['요새전', '사수|궁병'] } },
  { group: 'zh→ko', text: '护盾掉了，坐标456,789，去侦察', source: ['zh'], targets: ['ko'], expect: { ko: ['방패|보호막', '456,789', '정찰'] } },
  { group: 'zh→ko', text: '猎熊集结5分钟后开始，部队填满', source: ['zh'], targets: ['ko'], expect: { ko: ['곰 사냥|곰사냥', '집결', '병력'] } },
  { group: 'zh→ko', text: '联盟集结队长换成我，只放步兵', source: ['zh'], targets: ['ko'], expect: { ko: ['연맹', '집결장|집결 리더', '보병'] } },
  // ru → ko
  { group: 'ru→ko', text: 'Сбор через 5 минут, войска полные', source: ['ru'], targets: ['ko'], expect: { ko: ['집결', '5분', '병력'] } },
  { group: 'ru→ko', text: 'Щит упал, координаты 456,789, разведка', source: ['ru'], targets: ['ko'], expect: { ko: ['방패|보호막', '456,789', '정찰'] } },
  { group: 'ru→ko', text: 'Печь 30 наконец, гарнизон в замке', source: ['ru'], targets: ['ko'], expect: { ko: ['화로', '30', '주둔', '성'] } },
  { group: 'ru→ko', text: 'Битва за крепость завтра, копейщики и стрелки', source: ['ru'], targets: ['ko'], expect: { ko: ['요새전', '창병', '사수|궁병'] } },
  // 특수 — 좌표·이모지·숫자만·혼합·로마자 한국어·독일어·한자 전용
  { group: '특수', text: '456,789 👍', source: ['unknown'], targets: ['en', 'ko'], expect: { en: ['456,789'], ko: ['456,789'] }, lenient: true },
  { group: '특수', text: 'SFC 집결 go', source: ['ko', 'unknown'], targets: ['en', 'ja'], expect: { en: ['rally', 'SFC'], ja: ['集結', 'SFC'] }, lenient: true },
  { group: '특수', text: 'annyeong gg', source: ['ko', 'en', 'unknown'], targets: ['ko'], expect: { ko: [] }, lenient: true },
  { group: '특수', text: 'Wir sammeln in 5 Minuten', source: ['unknown'], targets: ['ko', 'en'], expect: { ko: ['5분'], en: ['5 min'] }, lenient: true },
  { group: '특수', text: '集結 5分', source: ['ja', 'zh', 'unknown'], targets: ['ko', 'en'], expect: { ko: ['집결', '5분'], en: ['rally', '5 min'] }, lenient: true },
  { group: '특수', text: '🔥🔥🔥 GO GO GO 🔥🔥🔥', source: ['en', 'unknown'], targets: ['ko'], expect: { ko: ['🔥'] }, lenient: true },
];

/**
 * USD / 1M 토큰(Standard, 캐시 제외). 없는 모델은 표에 '—' 로 나온다.
 * 출처: https://developers.openai.com/api/docs/pricing — 2026-09-10 확인.
 */
export const PRICES: Record<string, { input: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5.6-terra': { input: 2.0, output: 12.0 },
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
};

const SCRIPT_RE: Record<Lang, RegExp> = {
  ko: /\p{Script=Hangul}/gu,
  en: /\p{Script=Latin}/gu,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu,
  zh: /\p{Script=Han}/gu,
  ru: /\p{Script=Cyrillic}/gu,
};
const LETTER_RE = /\p{L}/gu;
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

/** 원문 스크립트 글자가 번역문에 남았는가. 원문에 그대로 있는 짧은 토큰(태그·gg·lol·좌표)은 뺀다. */
const stripPunct = (t: string) => t.replace(/^[("'\[]+|[.,!?;:。、！？)"'\]]+$/gu, '');

function residue(sourceLang: Lang, text: string, output: string): number {
  const keep = [...new Set(text.split(/\s+/).map(stripPunct))].filter(
    (t) => t && (t.length <= 3 || /\d/.test(t) || t === t.toUpperCase()),
  );
  const cleaned = output
    .split(/\s+/)
    .map(stripPunct)
    .filter(
      (t) =>
        !keep.some((k) => t === k || (/\d/.test(k) && t.startsWith(k))),
    )
    .join(' ');
  return count(SCRIPT_RE[sourceLang], cleaned);
}

function scriptRatio(target: Lang, output: string): number {
  const letters = count(LETTER_RE, output);
  if (letters === 0) return 1;
  return count(SCRIPT_RE[target], output) / letters;
}

function termHit(output: string, term: string): boolean {
  const lower = output.toLowerCase();
  return term.split('|').some((alt) => lower.includes(alt.toLowerCase()));
}

export interface CaseResult {
  text: string;
  group: string;
  source: SourceLang | 'error';
  sourceOk: boolean;
  outputs: Partial<Record<Lang, string>>;
  termHits: number;
  termTotal: number;
  missing: string[];
  misOutput: string[];
  ms: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

export interface ModelSummary {
  model: string;
  cases: CaseResult[];
  termHits: number;
  termTotal: number;
  misOutputCases: number;
  sourceOk: number;
  sourceTotal: number;
  avgMs: number;
  avgInput: number;
  avgOutput: number;
  costPerSentenceUsd: number | null;
  errors: number;
  byGroup: Record<string, { hits: number; total: number; mis: number }>;
}

class CapturingUsage extends TranslateUsageService {
  readonly records: TranslateUsageRecord[] = [];
  override record(entry: TranslateUsageRecord): void {
    this.records.push(entry);
  }
}

function makeEngine(model: string) {
  const config = {
    get: (key: string) => (key === 'TRANSLATE_MODEL' ? model : process.env[key]),
  } as unknown as ConfigService;
  const usage = new CapturingUsage();
  return { engine: new TranslateEngineService(config, usage), usage };
}

export function scoreCase(
  c: EvalCase,
  source: SourceLang,
  outputs: Partial<Record<Lang, string>>,
  sourceLang: Lang | null,
): Pick<CaseResult, 'sourceOk' | 'termHits' | 'termTotal' | 'missing' | 'misOutput'> {
  const missing: string[] = [];
  const misOutput: string[] = [];
  let termHits = 0;
  let termTotal = 0;
  for (const target of c.targets) {
    const output = outputs[target];
    const expected = c.expect[target] ?? [];
    termTotal += expected.length;
    if (output === undefined) {
      missing.push(...expected.map((t) => `${target}:${t}`));
      misOutput.push(`${target}:없음`);
      continue;
    }
    for (const term of expected) {
      if (termHit(output, term)) termHits += 1;
      else missing.push(`${target}:${term}`);
    }
    if (!c.lenient) {
      const ratio = scriptRatio(target, output);
      if (ratio < 0.6) misOutput.push(`${target}:스크립트 비율 ${ratio.toFixed(2)}`);
      if (sourceLang && sourceLang !== target) {
        const left = residue(sourceLang, c.text, output);
        if (left > 0) misOutput.push(`${target}:원문 스크립트 잔존 ${left}자`);
      }
    }
  }
  return { sourceOk: c.source.includes(source), termHits, termTotal, missing, misOutput };
}

/** 문장마다 엔진·usage 를 따로 만든다 — 하나를 공유하면 동시 실행 중 다른 문장의 토큰이 섞여 귀속된다(1차 실행에서 확인). */
async function runCase(model: string, c: EvalCase): Promise<CaseResult> {
  const { engine, usage } = makeEngine(model);
  const before = 0;
  const startedAt = Date.now();
  try {
    const result = await engine.translateMulti(c.text, c.targets);
    const ms = Date.now() - startedAt;
    const used = usage.records.slice(before);
    const sourceLang = c.source.length === 1 && c.source[0] !== 'unknown' ? c.source[0] : null;
    return {
      text: c.text,
      group: c.group,
      source: result.source,
      outputs: result.translations,
      ms,
      inputTokens: used.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: used.reduce((s, r) => s + r.outputTokens, 0),
      ...scoreCase(c, result.source, result.translations, sourceLang),
    };
  } catch (error) {
    const message =
      error instanceof TranslateProviderError
        ? `${error.status ?? ''} ${error.message}`.trim()
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      text: c.text,
      group: c.group,
      source: 'error',
      sourceOk: false,
      outputs: {},
      termHits: 0,
      termTotal: Object.values(c.expect).reduce((s, terms) => s + (terms?.length ?? 0), 0),
      missing: [],
      misOutput: [],
      ms: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      error: message,
    };
  }
}

async function runModel(model: string, cases: EvalCase[], concurrency: number): Promise<ModelSummary> {
  const results: CaseResult[] = new Array(cases.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = next++;
        if (index >= cases.length) return;
        results[index] = await runCase(model, cases[index]);
        process.stderr.write(`[${model}] ${index + 1}/${cases.length}\n`);
      }
    }),
  );
  const ok = results.filter((r) => !r.error);
  const termHits = results.reduce((s, r) => s + r.termHits, 0);
  const termTotal = results.reduce((s, r) => s + r.termTotal, 0);
  const avg = (pick: (r: CaseResult) => number) =>
    ok.length === 0 ? 0 : ok.reduce((s, r) => s + pick(r), 0) / ok.length;
  const price = PRICES[model];
  const avgInput = avg((r) => r.inputTokens);
  const avgOutput = avg((r) => r.outputTokens);
  const byGroup: ModelSummary['byGroup'] = {};
  for (const r of results) {
    const g = (byGroup[r.group] ??= { hits: 0, total: 0, mis: 0 });
    g.hits += r.termHits;
    g.total += r.termTotal;
    if (r.misOutput.length > 0 || r.error) g.mis += 1;
  }
  return {
    model,
    cases: results,
    termHits,
    termTotal,
    misOutputCases: results.filter((r) => r.misOutput.length > 0).length,
    sourceOk: results.filter((r) => r.sourceOk).length,
    sourceTotal: results.length,
    avgMs: avg((r) => r.ms),
    avgInput,
    avgOutput,
    costPerSentenceUsd: price ? (avgInput * price.input + avgOutput * price.output) / 1_000_000 : null,
    errors: results.filter((r) => r.error).length,
    byGroup,
  };
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`);

export function renderMarkdown(summaries: ModelSummary[]): string {
  const lines: string[] = [];
  lines.push('| 모델 | 용어 적중 | 오출력 문장 | source 정확도 | 평균 ms | 평균 입력 토큰 | 평균 출력 토큰 | 문장당 비용(USD) | 오류 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const s of summaries) {
    lines.push(
      `| ${s.model} | ${s.termHits}/${s.termTotal} (${pct(s.termHits, s.termTotal)}) | ${s.misOutputCases} | ${s.sourceOk}/${s.sourceTotal} (${pct(s.sourceOk, s.sourceTotal)}) | ${Math.round(s.avgMs)} | ${s.avgInput.toFixed(0)} | ${s.avgOutput.toFixed(0)} | ${s.costPerSentenceUsd === null ? '—' : `$${s.costPerSentenceUsd.toFixed(6)}`} | ${s.errors} |`,
    );
  }
  lines.push('');
  lines.push('### 방향별 용어 적중 / 오출력 문장');
  lines.push('');
  const groups = [...new Set(summaries.flatMap((s) => Object.keys(s.byGroup)))];
  lines.push(`| 모델 | ${groups.join(' | ')} |`);
  lines.push(`|---|${groups.map(() => '---').join('|')}|`);
  for (const s of summaries) {
    lines.push(
      `| ${s.model} | ${groups
        .map((g) => {
          const v = s.byGroup[g];
          return v ? `${v.hits}/${v.total} · 오출력 ${v.mis}` : '—';
        })
        .join(' | ')} |`,
    );
  }
  for (const s of summaries) {
    const problems = s.cases.filter((r) => r.error || r.missing.length > 0 || r.misOutput.length > 0 || !r.sourceOk);
    lines.push('');
    lines.push(`### ${s.model} — 문제 문장 ${problems.length}건`);
    lines.push('');
    if (problems.length === 0) {
      lines.push('없음.');
      continue;
    }
    lines.push('| 원문 | source | 누락 용어 | 오출력 | 출력 |');
    lines.push('|---|---|---|---|---|');
    for (const r of problems) {
      const outputs = r.error
        ? `오류: ${r.error}`
        : Object.entries(r.outputs)
            .map(([lang, text]) => `${lang}: ${text}`)
            .join('<br>');
      lines.push(
        `| ${r.text} | ${r.source}${r.sourceOk ? '' : ' ✗'} | ${r.missing.join(', ') || '—'} | ${r.misOutput.join(', ') || '—'} | ${outputs.replace(/\|/g, '\\|')} |`,
      );
    }
  }
  return lines.join('\n');
}

export function renderFullOutputs(summaries: ModelSummary[]): string {
  const lines: string[] = [];
  for (const s of summaries) {
    lines.push('');
    lines.push(`### ${s.model} — 전체 출력`);
    lines.push('');
    lines.push('| 원문 | source | 출력 | ms | 입력/출력 토큰 |');
    lines.push('|---|---|---|---|---|');
    for (const r of s.cases) {
      const outputs = r.error
        ? `오류: ${r.error}`
        : Object.entries(r.outputs)
            .map(([lang, text]) => `${lang}: ${text}`)
            .join('<br>');
      lines.push(`| ${r.text} | ${r.source} | ${outputs.replace(/\|/g, '\\|')} | ${r.ms} | ${r.inputTokens}/${r.outputTokens} |`);
    }
  }
  return lines.join('\n');
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=');
    args[key] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return args;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY 가 없다. server/.env 를 확인할 것.');
  }
  const models = (args.models ?? process.env.TRANSLATE_MODEL ?? 'gpt-5.4-mini')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const limit = args.limit ? Number(args.limit) : EVAL_CASES.length;
  const concurrency = args.concurrency ? Number(args.concurrency) : 4;
  const cases = EVAL_CASES.slice(0, limit);

  const summaries: ModelSummary[] = [];
  for (const model of models) {
    summaries.push(await runModel(model, cases, concurrency));
  }
  const markdown = renderMarkdown(summaries);
  const full = args.full === 'true' ? renderFullOutputs(summaries) : '';
  const report = `${markdown}\n${full}`;
  process.stdout.write(`${report}\n`);
  if (args.out) {
    writeFileSync(args.out, `${report}\n`, 'utf8');
    process.stderr.write(`저장: ${args.out}\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
