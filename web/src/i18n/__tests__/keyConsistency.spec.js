// keyConsistency.spec.js — i18n 키 일관성 회귀 가드.
//
// 검증 목적:
//  1) 4개 언어(ko/en/ja/zh) 모두 동일한 키 셋을 가져야 한다.
//     한 언어에만 키를 추가하고 다른 언어를 깜빡 잊으면 t(key)가 ko fallback으로 빠지면서
//     UI가 한국어로 새는 회귀 발생. 테스트로 즉시 차단.
//  2) Phase 2 — Layout Shell에서 추가된 19개 키가 4개 언어 모두에 존재해야 한다.
//
// 설계 메모:
//  - i18n/index.jsx 의 UI_TEXTS 객체는 export 되지 않으므로 소스 파싱으로 키 추출.
//    (nicknameRegex.spec.js 와 동일 패턴 — 정책이 바뀌면 테스트가 깨져 모든 언어 동기화 강제)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const i18nSrc = readFileSync(
  resolve(__dirname, '..', 'index.jsx'),
  'utf8',
);

/** 언어 블록 추출 — 'lang: {' 부터 매칭 닫는 '}' 까지 슬라이스 */
function extractLangKeys(src, lang) {
  const tag = `\n  ${lang}: {`;
  const idx = src.indexOf(tag);
  if (idx === -1) throw new Error(`UI_TEXTS.${lang} 블록 시작점을 찾지 못했습니다.`);
  let i = idx + tag.length - 1; // '{' 위치
  const start = i;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  const block = src.slice(start, i + 1);
  const keys = new Set();
  // 들여쓰기된 식별자: 키 형태 (한 줄 정의 + 함수형 정의 모두 매칭)
  const keyRe = /^[ \t]+([a-zA-Z][a-zA-Z0-9]*)\s*:/gm;
  let m;
  while ((m = keyRe.exec(block))) keys.add(m[1]);
  return keys;
}

const SUPPORTED = ['ko', 'en', 'ja', 'zh'];
const KEY_SETS = Object.fromEntries(
  SUPPORTED.map((l) => [l, extractLangKeys(i18nSrc, l)]),
);

describe('i18n UI_TEXTS — 4개 언어 키 일관성 회귀 가드', () => {
  it('모든 언어 블록이 발견됨 (ko/en/ja/zh)', () => {
    for (const l of SUPPORTED) {
      expect(KEY_SETS[l].size).toBeGreaterThan(0);
    }
  });

  it('ko 와 en/ja/zh 가 정확히 동일한 키 셋', () => {
    const ko = KEY_SETS.ko;
    for (const lang of ['en', 'ja', 'zh']) {
      const other = KEY_SETS[lang];
      const onlyInKo = [...ko].filter((k) => !other.has(k));
      const onlyInOther = [...other].filter((k) => !ko.has(k));
      expect(onlyInKo, `ko 에만 있는 키 (${lang} 누락)`).toEqual([]);
      expect(onlyInOther, `${lang} 에만 있는 키 (ko 누락)`).toEqual([]);
    }
  });

  it('Phase 2 — Layout Shell 신규 19개 키가 4개 언어 모두에 존재', () => {
    // verify-loop 1회차에서 cmdkToggleTrans 키는 dead key로 판정되어 제거됨.
    // 대신 tabAdmin 키가 추가되어 admin 탭 라벨이 4개 언어 일관됨.
    const PHASE2_KEYS = [
      'chatDockTitle', 'chatDockTooltip',
      'cmdkTitle', 'cmdkTooltip', 'cmdkPlaceholder', 'cmdkNoResults',
      'cmdkSectionNavigate', 'cmdkSectionActions', 'cmdkSectionLanguage',
      'cmdkSectionTheme', 'cmdkSectionSession',
      'cmdkGoToPrefix', 'cmdkToggleChat', 'cmdkToggleTTS',
      'tabAdmin',
      'railHomeTitle',
      'popoverRole', 'popoverServer',
      'breadcrumbSep',
    ];
    expect(PHASE2_KEYS).toHaveLength(19);
    for (const key of PHASE2_KEYS) {
      for (const lang of SUPPORTED) {
        expect(
          KEY_SETS[lang].has(key),
          `Phase 2 키 누락: ${lang}.${key}`,
        ).toBe(true);
      }
    }
  });
});
