// SQL 파일 원문을 MySQL 드라이버에 하나씩 넘길 수 있는 실행 단위 문장으로 쪼갠다.
//
// 설계 원칙 — 이 함수는 "어디서 자를지"만 정하고 SQL 을 다시 쓰지 않는다.
// 주석도 지우지 않고 그대로 남긴다(`/*!...*/` 실행 가능 주석이 살아 있어야 하고,
// 마이그레이션 파일의 한국어 설명 주석이 실패 로그에 같이 찍혀야 원인을 찾기 쉽다).
// 주석·문자열 안의 세미콜론을 문장 구분자로 오인하지 않는 것이 유일한 목적이다.
//
// 한계 — 클라이언트 전용 지시자인 `DELIMITER` 는 지원하지 않는다.
// 본문에 세미콜론이 들어가는 트리거·프로시저를 마이그레이션에 넣지 말 것.

// 역슬래시 문자 하나. 소스에 직접 쓰면 편집 도구별 이스케이프 처리가 달라 깨진다.
const BACKSLASH = String.fromCharCode(92);

/** 문자열·주석 밖에 있는 세미콜론을 경계로 SQL 문장 목록을 만든다. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = '';
  // 현재 위치가 어떤 인용/주석 안인지를 나타낸다.
  let mode: 'code' | 'single' | 'double' | 'backtick' | 'line' | 'block' =
    'code';

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (mode === 'code') {
      // 줄 주석 시작 — MySQL 은 `--` 뒤에 공백(또는 줄끝)이 와야 주석으로 본다.
      if (ch === '-' && next === '-' && isCommentDashEnd(sql[i + 2])) {
        mode = 'line';
      } else if (ch === '#') {
        mode = 'line';
      } else if (ch === '/' && next === '*') {
        mode = 'block';
        buffer += ch;
        i += 1;
        buffer += next;
        continue;
      } else if (ch === "'") {
        mode = 'single';
      } else if (ch === '"') {
        mode = 'double';
      } else if (ch === '`') {
        mode = 'backtick';
      } else if (ch === ';') {
        pushStatement(statements, buffer);
        buffer = '';
        continue;
      }
      buffer += ch;
      continue;
    }

    if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
      }
      buffer += ch;
      continue;
    }

    if (mode === 'block') {
      buffer += ch;
      if (ch === '*' && next === '/') {
        buffer += next;
        i += 1;
        mode = 'code';
      }
      continue;
    }

    // 인용 문자열/식별자 안. 역슬래시 이스케이프와 따옴표 두 번 겹침을 처리한다.
    const quote = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
    if (ch === BACKSLASH && mode !== 'backtick' && next !== undefined) {
      buffer += ch + next;
      i += 1;
      continue;
    }
    if (ch === quote && next === quote) {
      buffer += ch + next;
      i += 1;
      continue;
    }
    if (ch === quote) {
      mode = 'code';
    }
    buffer += ch;
  }

  pushStatement(statements, buffer);
  return statements;
}

/** `--` 뒤에 오는 문자가 주석을 성립시키는지 판정한다. 줄 끝(undefined)도 성립. */
function isCommentDashEnd(ch: string | undefined): boolean {
  return (
    ch === undefined || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
  );
}

/** 주석과 공백을 걷어냈을 때 실행할 내용이 남는 조각만 목록에 넣는다. */
function pushStatement(statements: string[], raw: string): void {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return;
  }
  if (stripComments(trimmed).trim().length === 0) {
    return;
  }
  statements.push(trimmed);
}

/** 비어 있는 조각인지 판정하기 위해서만 쓰는 주석 제거. 실행 SQL 에는 쓰지 않는다. */
function stripComments(sql: string): string {
  let out = '';
  let mode: 'code' | 'single' | 'double' | 'backtick' | 'line' | 'block' =
    'code';

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (mode === 'code') {
      if (ch === '-' && next === '-' && isCommentDashEnd(sql[i + 2])) {
        mode = 'line';
        continue;
      }
      if (ch === '#') {
        mode = 'line';
        continue;
      }
      if (ch === '/' && next === '*') {
        // `/*!` 는 서버가 실행하는 주석이므로 내용이 있는 것으로 센다.
        if (sql[i + 2] === '!') {
          out += '!';
        }
        mode = 'block';
        i += 1;
        continue;
      }
      if (ch === "'") mode = 'single';
      else if (ch === '"') mode = 'double';
      else if (ch === '`') mode = 'backtick';
      out += ch;
      continue;
    }

    if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
        out += ch;
      }
      continue;
    }

    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        i += 1;
      }
      continue;
    }

    const quote = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
    if (ch === BACKSLASH && mode !== 'backtick' && next !== undefined) {
      out += ch + next;
      i += 1;
      continue;
    }
    if (ch === quote && next === quote) {
      out += ch + next;
      i += 1;
      continue;
    }
    if (ch === quote) {
      mode = 'code';
    }
    out += ch;
  }

  return out;
}
