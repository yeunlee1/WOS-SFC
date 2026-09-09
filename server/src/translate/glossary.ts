// WOS 게임 용어집과, 문장에 등장한 용어만 프롬프트에 넣는 선택 함수. ja·zh·ru 표기는 2026-09-10 초안(연맹 확인 전).
// ru 열의 소문자 짧은 항목(стрелк·замк·печ 등)은 어미 변화를 잡기 위한 어간 별칭이다.
//
// 각 열의 첫 원소가 대표 표기, 나머지는 별칭이다. 원문에서 어느 열의 별칭이든 등장하면
// 그 행을 `{매칭 표기} → {언어코드}: {대표 표기}; …` 한 줄로 만든다(대상 언어 전부, 매칭된 열의 언어 포함).
// 용어집 전체를 매번 넣으면 입력 토큰이 약 2.8배(감사 C 6절)라 등장한 행만 넣는다.
import { Lang, TARGET_LANGS } from './script-detect';

export interface GlossaryRow {
  ko: string[];
  en: string[];
  ja: string[];
  zh: string[];
  ru: string[];
}

export const GLOSSARY_MAX_LINES = 12;

export const GLOSSARY: GlossaryRow[] = [
  { ko: ['집결'], en: ['rally', 'rallies'], ja: ['集結'], zh: ['集结'], ru: ['сбор'] },
  { ko: ['집결장', '집결 리더'], en: ['rally leader'], ja: ['集結リーダー'], zh: ['集结队长'], ru: ['лидер сбора', 'лидером сбора'] },
  { ko: ['연맹'], en: ['alliance'], ja: ['同盟'], zh: ['联盟'], ru: ['альянс'] },
  // SFC 는 채팅에서 태그처럼 쓰여 대표 표기를 SFC 로 둔다(규칙 "태그는 그대로"와 일치). Sunfire Castle 은 별칭.
  { ko: ['SFC', '썬파이어'], en: ['SFC', 'Sunfire Castle'], ja: ['サンファイア城'], zh: ['烈日城堡'], ru: ['Замок Санфайр'] },
  { ko: ['곰 사냥', '곰사냥', '곰 함정'], en: ['Bear Hunt', 'bear trap'], ja: ['クマ狩り'], zh: ['猎熊'], ru: ['Охота на медведя', 'охот'] },
  { ko: ['요새전'], en: ['Fortress Battle'], ja: ['要塞戦'], zh: ['要塞战'], ru: ['Битва за крепость', 'битв'] },
  { ko: ['요새'], en: ['fortress'], ja: ['要塞'], zh: ['要塞'], ru: ['крепость', 'крепост'] },
  { ko: ['성'], en: ['castle'], ja: ['城'], zh: ['城堡'], ru: ['замок', 'замк'] },
  { ko: ['화로'], en: ['Furnace'], ja: ['溶鉱炉'], zh: ['熔炉'], ru: ['Печь', 'печ'] },
  { ko: ['보병', '방패병'], en: ['Infantry'], ja: ['歩兵'], zh: ['步兵'], ru: ['Пехота', 'пехот'] },
  { ko: ['창병', '창기병'], en: ['Lancer', 'lancers'], ja: ['槍兵'], zh: ['枪兵'], ru: ['Копейщик'] },
  { ko: ['사수', '궁병'], en: ['Marksman', 'marksmen'], ja: ['射手'], zh: ['射手'], ru: ['Стрелок', 'стрелк'] },
  { ko: ['병력'], en: ['troops'], ja: ['兵力'], zh: ['部队'], ru: ['войска', 'войск'] },
  { ko: ['행군 시간', '행군시간'], en: ['march time'], ja: ['行軍時間'], zh: ['行军时间'], ru: ['время марша'] },
  { ko: ['행군'], en: ['march'], ja: ['行軍'], zh: ['行军'], ru: ['марш'] },
  { ko: ['주둔', '수비'], en: ['garrison'], ja: ['駐屯'], zh: ['驻防'], ru: ['гарнизон'] },
  { ko: ['정찰'], en: ['scout'], ja: ['偵察'], zh: ['侦察'], ru: ['разведка', 'разведк'] },
  { ko: ['방패', '보호막'], en: ['shield'], ja: ['シールド'], zh: ['护盾'], ru: ['щит'] },
  { ko: ['텔포', '텔레포트'], en: ['teleport'], ja: ['テレポート'], zh: ['传送'], ru: ['телепорт'] },
  { ko: ['좌표'], en: ['coordinates', 'coords'], ja: ['座標'], zh: ['坐标'], ru: ['координаты', 'координат'] },
  { ko: ['전투력'], en: ['power'], ja: ['戦闘力'], zh: ['战力'], ru: ['мощь', 'мощ'] },
  { ko: ['영웅'], en: ['hero', 'heroes'], ja: ['英雄'], zh: ['英雄'], ru: ['герой', 'геро'] },
  { ko: ['서버'], en: ['state'], ja: ['サーバー'], zh: ['州'], ru: ['штат'] },
  { ko: ['이주'], en: ['transfer', 'migration'], ja: ['移住'], zh: ['迁服'], ru: ['переезд', 'переех'] },
  { ko: ['웨이브'], en: ['wave'], ja: ['ウェーブ'], zh: ['波次'], ru: ['волна', 'волн'] },
  { ko: ['렙', '레벨'], en: ['level', 'lvl'], ja: ['レベル'], zh: ['级'], ru: ['уровень', 'уровн'] },
];

// 한 글자 한국어 별칭이 다른 낱말(완성·성벽)에 묻히지 않게 허용하는 뒤 문맥 — 문장 끝·공백·조사.
const KO_SINGLE_TRAILING = '(?=$|\\s|에|으로|에서|은|는|이|가|을|를|도)';
const LATIN_ALIAS = /^[\p{Script=Latin}\s.'-]+$/u;
// 러시아어는 격·수에 따라 어미가 바뀌므로(сбор→сбора, замок→замке) 단어 경계 대신 소문자 부분 일치를 쓰고
// 행에 어간 별칭(стрелк, замк)을 둔다. 잘못 걸린 행은 프롬프트에 한 줄 더 들어갈 뿐이라 해가 작다.
const CYRILLIC_ALIAS = /^[\p{Script=Cyrillic}\s-]+$/u;
const HANGUL_SINGLE = /^\p{Script=Hangul}$/u;

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 별칭 하나의 매칭 규칙. 라틴은 단어 경계·대소문자 무시·복수형, 키릴은 소문자 부분 일치, 한 글자 한글은 조사 경계, 그 밖은 포함. */
function aliasMatcher(alias: string): (text: string) => boolean {
  if (CYRILLIC_ALIAS.test(alias)) {
    const needle = alias.toLowerCase();
    return (text) => text.toLowerCase().includes(needle);
  }
  if (LATIN_ALIAS.test(alias)) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(alias)}(?:s|es)?(?![\\p{L}\\p{N}])`,
      'iu',
    );
    return (text) => re.test(text);
  }
  if (HANGUL_SINGLE.test(alias)) {
    const re = new RegExp(`(?<!\\S)${alias}${KO_SINGLE_TRAILING}`, 'u');
    return (text) => re.test(text);
  }
  return (text) => text.includes(alias);
}

type CompiledAlias = { alias: string; column: Lang; test: (text: string) => boolean };

const COMPILED: { row: GlossaryRow; aliases: CompiledAlias[] }[] = GLOSSARY.map(
  (row) => ({
    row,
    aliases: TARGET_LANGS.flatMap((column) =>
      row[column].map((alias) => ({ alias, column, test: aliasMatcher(alias) })),
    ),
  }),
);

/**
 * 원문에 등장한 용어 행을 `매칭표기 → en: 대표; ko: 대표` 형태(대상 언어 순서, 언어 코드 라벨)로 돌려준다.
 * 매칭된 열과 같은 언어도 빼지 않는다 — 2026-09-10 E2E 에서 대상 {en, ko} 에 영어 원문이 들어왔을 때
 * 라벨 없이 `bear trap=곰 사냥` 만 남기자 모델이 그 값을 en 칸에 넣고 ko 칸은 용어만 치환했다.
 * 대상이 매칭된 열의 언어뿐이면 줄에 정보가 없으므로 넣지 않는다.
 */
export function selectGlossaryLines(
  text: string,
  targets: readonly Lang[],
  max = GLOSSARY_MAX_LINES,
): string[] {
  if (!text || targets.length === 0 || max <= 0) return [];
  const lines: string[] = [];
  for (const { row, aliases } of COMPILED) {
    const hit = aliases.find((a) => a.test(text));
    if (!hit) continue;
    if (targets.every((lang) => lang === hit.column)) continue;
    const labeled = targets.map((lang) => `${lang}: ${row[lang][0]}`);
    lines.push(`${hit.alias} → ${labeled.join('; ')}`);
    if (lines.length >= max) break;
  }
  return lines;
}
