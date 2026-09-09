// 메시지의 표시 상태(원문·번역·대기·실패)를 고르는 순수 셀렉터 — ChatMessageItem이 쓴다.
import { effectiveLang } from './script';

// translations는 chatTranslations[id] 항목(없으면 undefined), pending·failed는 그 id의 플래그.
// 우선순위 — 번역 있음 > 실패 > 대기 > 원문. 번역문이 원문과 같으면(이미 내 언어) 원문.
export function selectDisplay(
  msg,
  translations,
  myLang,
  autoTranslate,
  pending,
  failed,
) {
  const original = typeof msg?.content === 'string' ? msg.content : '';
  const base = { state: 'original', text: original, original };
  if (!autoTranslate) return base;

  const lang = effectiveLang(myLang);
  const translated =
    translations && typeof translations[lang] === 'string'
      ? translations[lang]
      : null;
  if (translated !== null) {
    if (translated === original) return base;
    return { state: 'translated', text: translated, original };
  }
  if (failed) return { ...base, state: 'failed' };
  if (pending) return { ...base, state: 'pending' };
  return base;
}
