// 채팅 원문의 스크립트(한글·가나·한자·키릴·라틴)를 세어 번역을 건너뛸 수 있는 언어를 판별한다. 서버와 같은 규칙.
export const SUPPORTED_TARGETS = ['ko', 'en', 'ja', 'zh', 'ru'];

// 스크립트별 글자 범위. 문장부호·숫자·이모지는 어느 범위에도 안 잡혀 "글자"로 세지 않는다.
const SCRIPT_RANGES = {
  hangul: /[ᄀ-ᇿ㄰-㆏가-힯]/u,
  kana: /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾟ]/u,
  han: /[㐀-䶿一-鿿豈-﫿]/u,
  cyrillic: /[Ѐ-ӿԀ-ԯ]/u,
  latin: /[A-Za-zÀ-ɏ]/u,
};

function countScripts(text) {
  const counts = { hangul: 0, kana: 0, han: 0, cyrillic: 0, latin: 0 };
  for (const ch of String(text ?? '')) {
    for (const key of Object.keys(SCRIPT_RANGES)) {
      if (SCRIPT_RANGES[key].test(ch)) {
        counts[key] += 1;
        break;
      }
    }
  }
  return counts;
}

// 'ko'|'ja'|'ru'|'han'|'latin'|'mixed'|'none'
// 가나+한자 조합은 일본어 문장의 정상 형태이므로 ja. 한자만 있으면 ja/zh를 가를 수 없어 han.
export function detectScript(text) {
  const c = countScripts(text);
  const total = c.hangul + c.kana + c.han + c.cyrillic + c.latin;
  if (total === 0) return 'none';
  if (c.hangul === total) return 'ko';
  if (c.cyrillic === total) return 'ru';
  if (c.latin === total) return 'latin';
  if (c.han === total) return 'han';
  if (c.kana + c.han === total && c.kana > 0) return 'ja';
  return 'mixed';
}

// 이 값이 있을 때만 그 언어를 번역 대상에서 뺀다. 라틴·한자·혼합은 판별 불가라 null.
export function unambiguousLang(text) {
  const script = detectScript(text);
  return script === 'ko' || script === 'ja' || script === 'ru' ? script : null;
}

// UI 언어를 번역 대상 언어로 정규화한다. other·미지 값은 영어(사용자 결정 2026-09-09).
export function effectiveLang(language) {
  return SUPPORTED_TARGETS.includes(language) ? language : 'en';
}
