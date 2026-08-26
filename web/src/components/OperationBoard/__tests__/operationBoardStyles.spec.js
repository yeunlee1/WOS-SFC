// 작전판 경고·안내 UI 가 실제로 스타일을 갖는지 style.css 원문으로 검증한다.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest 의 root 는 web/ 이지만 저장소 루트에서 실행하는 경우도 받아 준다.
const CSS_PATH = [
  resolve(process.cwd(), 'style.css'),
  resolve(process.cwd(), 'web/style.css'),
].find((candidate) => existsSync(candidate));
const css = readFileSync(CSS_PATH, 'utf8');

// 중괄호가 중첩되지 않는 말단 규칙만 뽑는다 — @media 안의 규칙도 이 방식으로 잡힌다.
function ruleBlocks(source) {
  const blocks = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(source);
  while (match) {
    blocks.push({ selector: match[1].trim(), body: match[2] });
    match = pattern.exec(source);
  }
  return blocks;
}

const blocks = ruleBlocks(css);

function blocksFor(className) {
  const selectorToken = new RegExp(`\\.${className}(?![\\w-])`);
  return blocks.filter((block) => selectorToken.test(block.selector));
}

// 해당 클래스를 언급하는 @media 블록의 조건들.
function mediaQueriesFor(className) {
  const found = [];
  const pattern = /@media([^{]+)\{/g;
  let match = pattern.exec(css);
  while (match) {
    // @media 블록의 끝을 중괄호 깊이로 찾는다.
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') depth -= 1;
      index += 1;
    }
    const inner = css.slice(match.index + match[0].length, index - 1);
    if (new RegExp(`\\.${className}(?![\\w-])`).test(inner)) {
      found.push(match[1].trim());
    }
    match = pattern.exec(css);
  }
  return found;
}

const WARNING_CLASSES = [
  'operation-board-hint',
  'operation-board-alert',
  'operation-board-error',
];

describe('작전판 경고 UI 스타일', () => {
  it.each(WARNING_CLASSES)('.%s 에 선언이 있다', (className) => {
    const own = blocksFor(className);

    expect(own.length).toBeGreaterThan(0);
    expect(own.some((block) => block.body.trim().length > 0)).toBe(true);
  });

  it.each(WARNING_CLASSES)(
    '.%s 는 새 색상값을 지어내지 않고 기존 토큰을 쓴다',
    (className) => {
      const own = blocksFor(className);
      const bodies = own.map((block) => block.body).join('\n');

      expect(bodies).toContain('var(--');
      // 기존 테마 토큰만 쓴다 — 하드코딩된 hex 색상을 새로 넣지 않는다.
      expect(bodies).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    },
  );

  it.each(WARNING_CLASSES)('.%s 는 고정 px 너비를 쓰지 않는다', (className) => {
    const bodies = blocksFor(className)
      .map((block) => block.body)
      .join('\n');

    expect(bodies).not.toMatch(/(^|[;\s])(min-|max-)?width\s*:\s*\d+px/);
  });

  it('경고는 본문 안내 문구와 다르게 보인다', () => {
    const alertBodies = blocksFor('operation-board-alert')
      .map((block) => block.body)
      .join('\n');
    const errorBodies = blocksFor('operation-board-error')
      .map((block) => block.body)
      .join('\n');

    // 회색 12px 텍스트로 묻히지 않도록 색과 배경을 따로 준다.
    for (const bodies of [alertBodies, errorBodies]) {
      expect(bodies).toMatch(/(^|[;\s])color\s*:/);
      expect(bodies).toMatch(/(^|[;\s])background\s*:/);
    }
  });

  it.each(WARNING_CLASSES)('.%s 가 768px·480px 에서 조정된다', (className) => {
    const queries = mediaQueriesFor(className).join(' | ');

    expect(queries).toContain('768px');
    expect(queries).toContain('480px');
  });
});
