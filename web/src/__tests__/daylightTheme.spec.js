// daylightTheme.spec.js — daylight(백야) 라이트 스킨의 CSS 계약 가드.
//
// 검증 목적:
//  1) body.theme-daylight 토큰 블록이 존재하고, frost가 정의하는 토큰을 하나도 빠뜨리지 않는다
//     (빠지면 :root의 spring-핑크 기본값으로 새어 "절반만 입혀진 테마"가 된다)
//  2) frost 스코프에만 존재하고 베이스 규칙이 없는 클래스는 daylight 스코프에도 반드시 존재한다
//     (베이스가 없으므로 daylight가 직접 칠하지 않으면 그 컴포넌트는 무스타일로 렌더된다)
//  3) daylight는 라이트 테마다 — 배경 밝기 하한, 텍스트/액센트 WCAG AA 명암비
//  4) frost/spring 팔레트 회귀 가드 (daylight 추가로 기존 테마 색이 바뀌지 않았는지)
//
// [한계] 이 테스트는 style.css의 "선언 존재"와 "색 값의 수학적 명암비"만 보증한다.
//        실제 브라우저 렌더 결과(레이어 겹침, 배경 이미지 위 텍스트 등)는 보증하지 못한다.
//        런타임 확인은 agent-browser 스크린샷으로 별도 수행했다.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../style.css');
const RAW = readFileSync(cssPath, 'utf-8');
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, ''); // 주석 제거 — 주석 문구로 인한 위양성 차단

/** `body.theme-<name> {` 단일 토큰 블록의 본문을 뽑는다 (셀렉터가 정확히 그것 하나일 때만). */
function tokenBlock(name) {
  // 정규식 조립 대신 문자열 탐색 — 이스케이프 실수로 조용히 null이 되는 것을 막는다.
  const needle = `body.theme-${name} {`;
  const at = CSS.indexOf(needle);
  if (at === -1) return null;
  const open = at + needle.length;
  const close = CSS.indexOf('}', open);
  if (close === -1) return null;
  const body = CSS.slice(open, close);
  // 블록 안에 중첩 중괄호가 있으면 셀렉터를 잘못 잡은 것 — 계약 위반으로 본다.
  if (body.includes('{')) return null;
  return body;
}

/** 블록 본문에서 `--토큰: 값;` 을 Map으로 뽑는다. */
function tokensOf(body) {
  const out = new Map();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

/** 셀렉터에 등장하는 클래스 집합을 스코프별로 모은다. */
function classIndex() {
  const frost = new Set();
  const daylight = new Set();
  const base = new Set();
  for (const m of CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@')) continue;
    for (const part of sel.split(',')) {
      const p = part.trim();
      const classes = [...p.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((c) => c[1]);
      if (p.includes('body.theme-frost')) {
        classes.forEach((c) => c !== 'theme-frost' && frost.add(c));
      } else if (p.includes('body.theme-daylight')) {
        classes.forEach((c) => c !== 'theme-daylight' && daylight.add(c));
      } else if (/body\.theme-[a-z]/.test(p)) {
        /* spring 등 다른 테마 스코프 — 베이스 아님 */
      } else {
        classes.forEach((c) => base.add(c));
      }
    }
  }
  return { frost, daylight, base };
}

/* ── WCAG 상대휘도 / 명암비 ── */
function hexToRgb(hex) {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('daylight 스킨 — CSS 토큰 계약', () => {
  it('body.theme-daylight 토큰 블록이 존재한다', () => {
    expect(tokenBlock('daylight')).not.toBeNull();
  });

  it('frost가 정의하는 토큰을 daylight도 전부 정의한다 (spring 기본값 누수 차단)', () => {
    const frost = tokensOf(tokenBlock('frost'));
    const daylight = tokensOf(tokenBlock('daylight'));
    const missing = [...frost.keys()].filter((k) => !daylight.has(k));
    expect(missing).toEqual([]);
  });

  it('연맹 색 토큰(kor/nsl/jky/gpx/ufo)을 daylight가 직접 정의한다', () => {
    const daylight = tokensOf(tokenBlock('daylight'));
    for (const k of ['--kor', '--nsl', '--jky', '--gpx', '--ufo']) {
      expect(daylight.has(k), `${k} 미정의`).toBe(true);
    }
  });
});

describe('daylight 스킨 — 컴포넌트 커버리지 계약', () => {
  it('베이스 규칙 없이 frost 스코프에만 있던 클래스는 daylight 스코프에도 있다', () => {
    const { frost, daylight, base } = classIndex();
    const needsDaylight = [...frost].filter((c) => !base.has(c));
    // 계약이 실제로 무언가를 검사하고 있는지 자체 확인 (0개면 위음성)
    expect(needsDaylight.length).toBeGreaterThan(20);
    const uncovered = needsDaylight.filter((c) => !daylight.has(c)).sort();
    expect(uncovered).toEqual([]);
  });
});

describe('daylight 스킨 — 라이트 모드 + WCAG AA 명암비', () => {
  const t = () => tokensOf(tokenBlock('daylight'));

  it('배경은 밝다 — --bg-page 상대휘도 0.80 이상', () => {
    const bg = t().get('--bg-page');
    expect(bg).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(luminance(bg)).toBeGreaterThan(0.8);
  });

  it('본문 텍스트 --text-1 / --text-2 는 배경 대비 4.5:1 이상 (AA 본문)', () => {
    const d = t();
    const bg = d.get('--bg-page');
    expect(contrast(d.get('--text-1'), bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(d.get('--text-2'), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('보조 텍스트 --text-3 는 배경 대비 3:1 이상 (AA 큰 글자/비텍스트)', () => {
    const d = t();
    expect(contrast(d.get('--text-3'), d.get('--bg-page'))).toBeGreaterThanOrEqual(3);
  });

  it('액센트 위 흰 글자(주요 버튼)는 4.5:1 이상', () => {
    const d = t();
    expect(contrast('#ffffff', d.get('--accent'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', d.get('--accent-hover'))).toBeGreaterThanOrEqual(4.5);
  });

  it('시맨틱 색(green/orange/red)은 배경 대비 4.5:1 이상 — 상태 글자 가독성', () => {
    const d = t();
    const bg = d.get('--bg-page');
    for (const k of ['--green', '--orange', '--red']) {
      expect(contrast(d.get(k), bg), `${k} 명암비 부족`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('카드 배경 위에서도 본문 텍스트가 4.5:1 이상', () => {
    const d = t();
    expect(contrast(d.get('--text-1'), d.get('--bg-card'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(d.get('--text-2'), d.get('--bg-card'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('기존 테마 회귀 가드 — daylight 추가로 frost/spring 팔레트가 바뀌지 않았다', () => {
  it('frost 핵심 토큰 유지', () => {
    const f = tokensOf(tokenBlock('frost'));
    expect(f.get('--bg-page')).toBe('#04060d');
    expect(f.get('--accent')).toBe('#7cdcff');
    expect(f.get('--text-1')).toBe('#eaf6ff');
  });

  it('spring 핵심 토큰 유지', () => {
    const s = tokensOf(tokenBlock('spring'));
    expect(s.get('--bg-page')).toBe('#1a0a14');
    expect(s.get('--accent')).toBe('#ff6b9d');
    expect(s.get('--text-1')).toBe('#fff0f5');
  });

  // 실제로 한 번 밟은 함정: daylight에 넣으려던 작전판 토큰이 spring 블록에 들어가
  // spring의 작전판 캔버스가 흰색이 될 뻔했다. 토큰 값 몇 개만 보는 가드로는 못 잡는다.
  it('daylight 전용 토큰(--op-canvas-bg/--op-grid)이 frost·spring으로 새지 않았다', () => {
    const d = tokensOf(tokenBlock('daylight'));
    expect(d.has('--op-canvas-bg')).toBe(true);
    expect(d.has('--op-grid')).toBe(true);
    for (const other of ['frost', 'spring']) {
      const o = tokensOf(tokenBlock(other));
      expect(o.has('--op-canvas-bg'), `${other}에 --op-canvas-bg 누수`).toBe(false);
      expect(o.has('--op-grid'), `${other}에 --op-grid 누수`).toBe(false);
    }
  });

  it('frost/spring 토큰 개수가 기준치에서 늘지 않았다 (다른 테마 블록 오염 감지)', () => {
    // 기준: 2026-08-27 daylight 추가 직전 실측값. 늘었다면 daylight용 선언이
    // 잘못된 블록에 들어갔을 가능성이 높으니 diff를 확인할 것.
    expect(tokensOf(tokenBlock('frost')).size).toBe(45);
    expect(tokensOf(tokenBlock('spring')).size).toBe(52);
  });
});
