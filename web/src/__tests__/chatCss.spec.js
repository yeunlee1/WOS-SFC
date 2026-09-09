// chatCss.spec.js — 채팅 CSS 계약 가드 (B-2, B-8, B-22, B Q5).
//
// 검증 목적:
//  1) 채팅 레이아웃(display/flex/grid/min-width/z-index/word-wrap…)은 테마 밖 베이스 규칙에만 있고
//     body.theme-* 스코프는 색·배경·테두리·글꼴·간격만 덮는다.
//  2) 세 테마(frost/spring/daylight)의 `.chat-*` 선택자 집합이 같다 — spring 누락(B-8) 재발 방지.
//  3) 도크가 float하는 ≤1180px 베이스 규칙의 z-index가 모바일 오버레이(199)보다 높다 (B-2).
//  4) .chat-tab-topbar는 베이스에서 flex-wrap: wrap (B-22).
//  5) JSX가 쓰는 chat-* 클래스는 전부 베이스 규칙이 있다 — 테마가 빠뜨려도 무스타일이 되지 않는다.
//
// [한계] 선언의 존재와 값만 본다. 실제 렌더 결과(겹침·넘침)는 브라우저 캡처로 따로 확인한다.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(resolve(here, '../../style.css'), 'utf-8');
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');

const THEMES = ['frost', 'spring', 'daylight'];

// 레이아웃·구조 속성 — 테마 스코프의 .chat-* 규칙에 있으면 안 된다.
const LAYOUT_PROPS = new Set([
  'display', 'flex', 'flex-direction', 'flex-wrap', 'flex-shrink', 'flex-grow',
  'grid-template-columns', 'grid-template-rows', 'grid-row', 'grid-column',
  'min-width', 'max-width', 'min-height', 'max-height',
  'position', 'top', 'right', 'bottom', 'left', 'inset', 'z-index',
  'overflow', 'overflow-x', 'overflow-y',
  'word-wrap', 'overflow-wrap', 'word-break', 'white-space', 'text-overflow',
  'transform', 'align-items', 'justify-content', 'align-self', 'box-sizing',
]);

/** 모든 규칙을 { selector, media, decls } 로 평탄화한다 (중첩 1단계 @media만 지원). */
function rules() {
  const out = [];
  const re = /(@media[^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}|([^{}@][^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(CSS))) {
    if (m[1]) {
      const media = m[1].trim();
      const inner = /([^{}]+)\{([^{}]*)\}/g;
      let n;
      while ((n = inner.exec(m[2]))) {
        out.push({ selector: n[1].trim(), media, decls: parse(n[2]) });
      }
    } else {
      out.push({ selector: m[3].trim(), media: null, decls: parse(m[4]) });
    }
  }
  return out;
}

function parse(body) {
  const decls = new Map();
  for (const part of body.split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    decls.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  return decls;
}

const ALL = rules();

function themeChatRules(theme) {
  const prefix = `body.theme-${theme}`;
  return ALL.filter(
    (r) => r.selector.startsWith(prefix) && r.selector.slice(prefix.length).trim().startsWith('.chat'),
  );
}

/** 테마 접두어를 뗀 선택자 집합 */
function themeChatSelectors(theme) {
  const prefix = `body.theme-${theme}`;
  return new Set(
    themeChatRules(theme).map((r) => r.selector.slice(prefix.length).trim()),
  );
}

const BASE_CHAT = ALL.filter(
  (r) => !/body\.theme-/.test(r.selector) && /(^|[\s,])\.chat/.test(r.selector),
);

describe('채팅 CSS — 베이스/테마 분리 계약', () => {
  it('베이스에 채팅 레이아웃 규칙이 있다 (위음성 방지 — 최소 30개)', () => {
    expect(BASE_CHAT.length).toBeGreaterThan(30);
  });

  it.each(THEMES)('%s 스코프의 .chat-* 규칙에는 레이아웃 속성이 없다', (theme) => {
    const offenders = [];
    for (const r of themeChatRules(theme)) {
      for (const prop of r.decls.keys()) {
        if (LAYOUT_PROPS.has(prop)) offenders.push(`${r.selector} → ${prop}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('세 테마의 .chat-* 선택자 집합이 같다', () => {
    const sets = Object.fromEntries(THEMES.map((t) => [t, themeChatSelectors(t)]));
    const union = new Set(THEMES.flatMap((t) => [...sets[t]]));
    const report = {};
    for (const t of THEMES) {
      const missing = [...union].filter((s) => !sets[t].has(s)).sort();
      if (missing.length) report[t] = missing;
    }
    expect(report).toEqual({});
    expect(union.size).toBeGreaterThan(20);
  });

  it('도크 float 베이스 규칙(≤1180px)의 z-index가 오버레이 199보다 높다', () => {
    const float = BASE_CHAT.find(
      (r) => r.selector === '.chat-dock' && r.media && /1180px/.test(r.media),
    );
    expect(float).toBeDefined();
    expect(float.decls.get('position')).toBe('fixed');
    expect(Number(float.decls.get('z-index'))).toBeGreaterThan(199);
    // 세 테마 어디에도 도크 z-index를 다시 정하는 규칙이 없다.
    for (const t of THEMES) {
      const dup = themeChatRules(t).filter((r) => r.decls.has('z-index'));
      expect(dup, `${t}에 z-index 재정의`).toEqual([]);
    }
  });

  it('.chat-tab-topbar 베이스는 flex-wrap: wrap', () => {
    const topbar = BASE_CHAT.find((r) => r.selector === '.chat-tab-topbar' && !r.media);
    expect(topbar).toBeDefined();
    expect(topbar.decls.get('display')).toBe('flex');
    expect(topbar.decls.get('flex-wrap')).toBe('wrap');
  });

  it('새 상태 선택자는 베이스와 세 테마 모두에 있다', () => {
    const NEW = ['.chat-msg-status', '.chat-msg-retry', '.chat-new-badge', '.chat-send-error', '.chat-char-count'];
    const baseSelectors = new Set(BASE_CHAT.map((r) => r.selector));
    for (const sel of NEW) {
      expect(baseSelectors.has(sel), `베이스에 ${sel} 없음`).toBe(true);
      for (const t of THEMES) {
        expect(themeChatSelectors(t).has(sel), `${t}에 ${sel} 없음`).toBe(true);
      }
    }
  });
});

/** web/src(동화 버전 제외)의 JSX에서 쓰는 chat-* 클래스를 모은다. */
function jsxChatClasses() {
  const root = resolve(here, '..');
  const classes = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === '__tests__' || name === 'story') continue;
        walk(full);
      } else if (/\.jsx?$/.test(name)) {
        const src = readFileSync(full, 'utf-8');
        // 앞에 글자·하이픈·콜론이 붙은 것(wos-chat-dock-open, operation-chat-panel,
        // 소켓 이벤트 operation:chat-open)은 클래스가 아니다.
        for (const m of src.matchAll(/(?<![\w:-])chat-[a-z0-9-]+/g)) classes.add(m[0]);
      }
    }
  };
  walk(root);
  return classes;
}

describe('채팅 CSS — JSX 클래스 커버리지', () => {
  it('JSX가 쓰는 chat-* 클래스는 베이스 규칙이 있거나 세 테마 모두에 있다', () => {
    const used = jsxChatClasses();
    expect(used.size).toBeGreaterThan(30);
    const baseClasses = new Set();
    for (const r of BASE_CHAT) {
      for (const m of r.selector.matchAll(/\.(chat-[a-z0-9-]+)/g)) baseClasses.add(m[1]);
    }
    const themeClasses = THEMES.map((t) => {
      const set = new Set();
      for (const sel of themeChatSelectors(t)) {
        for (const m of sel.matchAll(/\.(chat-[a-z0-9-]+)/g)) set.add(m[1]);
      }
      return set;
    });
    // 상태 변형 클래스(--pending 등)는 부모 클래스가 덮는다 — 제외.
    const missing = [...used]
      .filter((c) => !/--/.test(c))
      .filter((c) => !baseClasses.has(c) && !themeClasses.every((set) => set.has(c)))
      .sort();
    expect(missing).toEqual([]);
  });
});
