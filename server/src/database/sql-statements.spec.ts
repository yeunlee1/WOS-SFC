// SQL 파일을 개별 문장으로 쪼개는 분할기의 계약 테스트.
import { splitSqlStatements } from './sql-statements';

describe('splitSqlStatements', () => {
  it('세미콜론으로 문장을 나눈다', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
  });

  it('마지막 세미콜론이 없어도 문장을 잃지 않는다', () => {
    expect(splitSqlStatements('SELECT 1;\nSELECT 2')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
  });

  it('빈 입력과 주석만 있는 입력은 문장을 만들지 않는다', () => {
    expect(splitSqlStatements('')).toEqual([]);
    expect(splitSqlStatements('   \n\t ')).toEqual([]);
    expect(splitSqlStatements('-- 설명만 있는 파일\n-- 두 번째 줄\n')).toEqual(
      [],
    );
    expect(splitSqlStatements('/* 블록 주석만 */\n')).toEqual([]);
  });

  it('작은따옴표 문자열 안의 세미콜론으로는 나누지 않는다', () => {
    expect(
      splitSqlStatements("UPDATE t SET s='a;b' WHERE id=1; SELECT 2;"),
    ).toEqual(["UPDATE t SET s='a;b' WHERE id=1", 'SELECT 2']);
  });

  it('두 번 겹친 따옴표와 역슬래시 이스케이프를 문자열 종료로 보지 않는다', () => {
    expect(splitSqlStatements("SELECT 'a''b;c'; SELECT 2")).toEqual([
      "SELECT 'a''b;c'",
      'SELECT 2',
    ]);
    // 역슬래시 리터럴은 편집 도구별 이스케이프 처리가 달라 코드 포인트로 만든다.
    const bs = String.fromCharCode(92);
    expect(splitSqlStatements(`SELECT 'a${bs}'b;c'; SELECT 2`)).toEqual([
      `SELECT 'a${bs}'b;c'`,
      'SELECT 2',
    ]);
  });

  it('큰따옴표와 백틱 식별자 안의 세미콜론도 무시한다', () => {
    expect(splitSqlStatements('SELECT "a;b"; SELECT `c;d`')).toEqual([
      'SELECT "a;b"',
      'SELECT `c;d`',
    ]);
  });

  it('줄 주석 안의 세미콜론으로 나누지 않는다', () => {
    expect(splitSqlStatements('-- 주석 안 세미콜론; 무시\nSELECT 1;')).toEqual([
      '-- 주석 안 세미콜론; 무시\nSELECT 1',
    ]);
    expect(splitSqlStatements('# 해시 주석; 무시\nSELECT 1;')).toEqual([
      '# 해시 주석; 무시\nSELECT 1',
    ]);
  });

  it('블록 주석 안의 세미콜론으로 나누지 않고 원문을 보존한다', () => {
    expect(splitSqlStatements('/* a;b */ SELECT 1; SELECT 2')).toEqual([
      '/* a;b */ SELECT 1',
      'SELECT 2',
    ]);
  });

  it('MySQL 규칙대로 공백이 따라오지 않는 이중 하이픈은 주석이 아니다', () => {
    expect(splitSqlStatements('SELECT 1--2;')).toEqual(['SELECT 1--2']);
  });

  it('실행 가능한 주석(/*! */)을 지우지 않는다', () => {
    expect(splitSqlStatements('/*!40101 SET x=1 */;')).toEqual([
      '/*!40101 SET x=1 */',
    ]);
  });

  it('세미콜론이 연달아 나와도 빈 문장을 만들지 않는다', () => {
    expect(splitSqlStatements('SELECT 1;;\n;SELECT 2;')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
  });
});
