// 문자 스크립트로 원문 언어를 어림잡는다. 확실한 경우(한글·가나·키릴 단일)에만 번역을 건너뛰는 데 쓴다.
//
// 규칙(설계 3.4, 감사 C 5절 F) —
//   글자(letter)가 0이면 none. 한글만이면 ko. 가나가 있으면 ja(한자 동반 허용). 키릴만이면 ru.
//   한자만이면 han(ja/zh 구분 불가). 라틴만이면 latin(en이라고 단정하지 않음). 둘 이상 섞이면 mixed.
//   위 다섯 스크립트에 속하지 않는 글자(그리스·태국 등)만 있으면 판별 불가로 mixed 취급한다.
// 웹(web/src/chat/script.js)이 같은 규칙을 쓰고, docs/contracts/chat-events.json 의 픽스처를 공유한다.
export type Script = 'ko' | 'ja' | 'ru' | 'han' | 'latin' | 'mixed' | 'none';
export type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'ru';
export const TARGET_LANGS: readonly Lang[] = ['ko', 'en', 'ja', 'zh', 'ru'];

const RE = {
  hangul: /\p{Script=Hangul}/gu,
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  han: /\p{Script=Han}/gu,
  cyrillic: /\p{Script=Cyrillic}/gu,
  latin: /\p{Script=Latin}/gu,
};
const ANY_LETTER = /\p{L}/u;

const count = (re: RegExp, text: string): number =>
  (text.match(re) ?? []).length;

/** 유니코드 문자(letter) 범주가 하나라도 있는가. 숫자·이모지·기호만이면 false. */
export function hasLetters(text: string): boolean {
  return ANY_LETTER.test(text);
}

export function detectScript(text: string): Script {
  if (!hasLetters(text)) return 'none';
  const hangul = count(RE.hangul, text);
  const kana = count(RE.kana, text);
  const han = count(RE.han, text);
  const cyrillic = count(RE.cyrillic, text);
  const latin = count(RE.latin, text);
  // 가나가 있으면 한자는 일본어의 일부로 보고 별도 종류로 세지 않는다.
  const kinds = [
    hangul > 0,
    kana > 0,
    han > 0 && kana === 0,
    cyrillic > 0,
    latin > 0,
  ].filter(Boolean).length;
  if (kinds !== 1) return 'mixed';
  if (hangul > 0) return 'ko';
  if (kana > 0) return 'ja';
  if (han > 0) return 'han';
  if (cyrillic > 0) return 'ru';
  return 'latin';
}

/** 스크립트가 언어와 1:1인 경우에만 언어를 돌려준다. 그 언어는 번역 대상에서 뺀다. */
export function unambiguousLang(text: string): 'ko' | 'ja' | 'ru' | null {
  const script = detectScript(text);
  return script === 'ko' || script === 'ja' || script === 'ru' ? script : null;
}

/** 번역 대상 언어로 정규화한다. `other`·미지 값은 영어다(사용자 결정 2026-09-09). */
export function effectiveLang(language?: string | null): Lang {
  return (TARGET_LANGS as readonly string[]).includes(language ?? '')
    ? (language as Lang)
    : 'en';
}
