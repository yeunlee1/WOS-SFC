// server/migrations/*.sql 을 파일명 순으로 적용하는 마이그레이션 러너.
//
// 왜 TypeORM 내장 마이그레이션을 쓰지 않는가 (검토 결과):
//   - TypeORM 0.3 의 migration:run 은 마이그레이션을 TS/JS 클래스로 요구한다. 지금 있는
//     001~003 은 리뷰를 거친 .sql 원문이라 전부 클래스로 옮겨 적어야 하고, 그 과정에서
//     내용이 바뀔 위험이 생긴다. 클래스 안에서 파일을 읽어 실행하게 만들면 결국 여기
//     있는 것과 같은 러너를 TypeORM 껍데기 안에 다시 쓰는 셈이다.
//   - CLI 실행에 별도 DataSource 파일과 (TS로 둘 경우) ts-node 가 필요하다. 운영 이미지는
//     devDependencies 를 빼고 만들므로 ts-node 가 없다.
//   - 결정적으로 TypeORM 은 마이그레이션 실행에 잠금을 걸지 않는다. 컨테이너가 두 개
//     동시에 뜨면 같은 DDL 이 두 번 실행된다. MySQL DDL 은 암묵적 커밋이라 TypeORM 이
//     거는 트랜잭션으로도 막히지 않는다. 여기서는 GET_LOCK 으로 직렬화한다.
//   그래서 이미 의존성에 있는 mysql2 만으로 이 파일 하나를 두는 쪽을 택했다.
//
// 동작:
//   1. 대상 DB에 접속한다. DB가 없으면(ER_BAD_DB_ERROR) 만들고 다시 붙는다.
//   2. GET_LOCK 으로 이 DB에 대한 마이그레이션 실행을 한 번에 하나로 직렬화한다.
//   3. schema_migrations 이력 테이블을 만들고, 이미 적용된 파일은 건너뛴다(멱등).
//   4. 남은 파일을 파일명 오름차순으로 문장 단위 실행하고 이력에 기록한다.
//
// 한계:
//   MySQL 의 DDL 은 암묵적 커밋이라 파일 하나가 중간에 실패하면 앞선 문장은 되돌아가지
//   않는다. 실패 지점이 로그에 파일명·문장 번호로 찍히므로 손으로 정리한 뒤 다시 돌린다.
//   각 마이그레이션 문장을 되도록 멱등하게 쓰는 이유가 이것이다.
import { createHash } from 'crypto';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import mysql from 'mysql2/promise';
import { splitSqlStatements } from './sql-statements';

/** 이력 테이블 이름. 마이그레이션 파일이 만드는 업무 테이블과 겹치지 않는다. */
const HISTORY_TABLE = 'schema_migrations';

/** 다른 컨테이너가 잠금을 쥐고 있을 때 기다리는 시간(초). */
const DEFAULT_LOCK_TIMEOUT_SECONDS = 120;

interface MigrationFile {
  filename: string;
  sql: string;
  checksum: string;
}

/** migrations 디렉터리 경로를 정한다. src 에서 ts-node 로 돌리든 dist 에서 돌리든 같은 곳을 가리킨다. */
function resolveMigrationsDir(): string {
  const override = process.env.MIGRATIONS_DIR;
  if (override) {
    return resolve(override);
  }
  // src/database → server, dist/database → server. 둘 다 두 단계 위가 server 루트다.
  return join(__dirname, '..', '..', 'migrations');
}

/** .sql 파일을 파일명 오름차순으로 읽어 체크섬과 함께 돌려준다. */
function loadMigrationFiles(dir: string): MigrationFile[] {
  if (!existsSync(dir)) {
    throw new Error(`마이그레이션 디렉터리가 없다: ${dir}`);
  }
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort()
    .map((filename) => {
      const sql = readFileSync(join(dir, filename), 'utf8');
      return {
        filename,
        sql,
        checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
      };
    });
}

/** 환경변수에서 접속 정보를 읽는다. 이름은 server/src/app.module.ts 와 같은 것을 쓴다. */
function readConnectionConfig() {
  const database = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USER;
  if (!database || !user) {
    throw new Error(
      'DATABASE_NAME 과 DATABASE_USER 가 필요하다. server/.env 또는 컨테이너 환경변수를 확인할 것.',
    );
  }
  return {
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user,
    password: process.env.DATABASE_PASSWORD || '',
    database,
    // 마이그레이션 파일에 한국어 기본값('공지', '집결')이 들어 있어 접속 문자셋을 고정한다.
    charset: 'utf8mb4',
    // 문장은 splitSqlStatements 로 직접 쪼개 하나씩 보낸다. 여러 문장 동시 전송은 켜지 않는다.
    multipleStatements: false,
  };
}

/** 대상 DB에 붙는다. DB가 아직 없으면 만들고 다시 붙는다. */
async function connect(): Promise<mysql.Connection> {
  const config = readConnectionConfig();
  try {
    return await mysql.createConnection(config);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'ER_BAD_DB_ERROR') {
      throw error;
    }
    // 컨테이너 첫 기동에서 DB 자체가 없을 수 있다. 운영 DB와 같은 정렬 규칙으로 만든다.
    const { database, ...withoutDatabase } = config;
    const bootstrap = await mysql.createConnection(withoutDatabase);
    try {
      await bootstrap.query(
        `CREATE DATABASE IF NOT EXISTS \`${escapeIdentifier(database)}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      console.log(`[migrate] 데이터베이스 생성: ${database}`);
    } finally {
      await bootstrap.end();
    }
    return await mysql.createConnection(config);
  }
}

/** 식별자에 백틱이 섞여 들어오는 것을 막는다. */
function escapeIdentifier(name: string): string {
  if (!/^[A-Za-z0-9_$]+$/.test(name)) {
    throw new Error(`데이터베이스 이름에 허용되지 않는 문자가 있다: ${name}`);
  }
  return name;
}

/** 같은 DB에 대해 러너가 동시에 두 개 돌지 않도록 잠근다. */
async function acquireLock(
  connection: mysql.Connection,
  database: string,
): Promise<string> {
  // 잠금 이름은 MySQL 8 에서 64자 제한이라 DB 이름을 해시로 줄인다.
  const lockName = `wos_sfc_migrate_${createHash('sha256').update(database).digest('hex').slice(0, 32)}`;
  const timeout = Number(
    process.env.MIGRATE_LOCK_TIMEOUT_SECONDS || DEFAULT_LOCK_TIMEOUT_SECONDS,
  );
  const [rows] = await connection.query<
    (mysql.RowDataPacket & { acquired: number | null })[]
  >('SELECT GET_LOCK(?, ?) AS acquired', [lockName, timeout]);
  const acquired = rows[0]?.acquired;
  if (acquired !== 1) {
    throw new Error(
      `마이그레이션 잠금을 얻지 못했다(${timeout}초 대기). 다른 인스턴스가 실행 중일 수 있다: ${lockName}`,
    );
  }
  return lockName;
}

/** 이력 테이블을 만든다. 이미 있으면 아무것도 하지 않는다. */
async function ensureHistoryTable(connection: mysql.Connection): Promise<void> {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS \`${HISTORY_TABLE}\` (
      \`filename\` varchar(255) NOT NULL,
      \`checksum\` char(64) NOT NULL,
      \`applied_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      \`duration_ms\` int NOT NULL,
      PRIMARY KEY (\`filename\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
}

/** 이미 적용된 파일명 → 체크섬 표를 읽는다. */
async function readApplied(
  connection: mysql.Connection,
): Promise<Map<string, string>> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT filename, checksum FROM \`${HISTORY_TABLE}\``,
  );
  return new Map(
    rows.map((row) => [row.filename as string, row.checksum as string]),
  );
}

/** 파일 하나를 문장 단위로 실행하고 이력에 남긴다. */
async function applyMigration(
  connection: mysql.Connection,
  migration: MigrationFile,
): Promise<void> {
  const statements = splitSqlStatements(migration.sql);
  const startedAt = Date.now();
  for (let index = 0; index < statements.length; index += 1) {
    try {
      await connection.query(statements[index]);
    } catch (error) {
      // 002 처럼 START TRANSACTION 을 쓰는 파일이 중간에 실패하면 열린 트랜잭션을 되돌린다.
      // 트랜잭션이 없으면 무해하다. DDL 은 암묵적 커밋이라 이것으로 되돌아가지 않는다.
      await connection.query('ROLLBACK').catch(() => {});
      const message = (error as Error).message;
      throw new Error(
        `${migration.filename} 의 ${index + 1}번째 문장에서 실패했다: ${message}\n--- 실패한 문장 ---\n${statements[index]}`,
      );
    }
  }
  const durationMs = Date.now() - startedAt;
  await connection.query(
    `INSERT INTO \`${HISTORY_TABLE}\` (filename, checksum, duration_ms) VALUES (?, ?, ?)`,
    [migration.filename, migration.checksum, durationMs],
  );
  console.log(
    `[migrate] 적용: ${migration.filename} (문장 ${statements.length}개, ${durationMs}ms)`,
  );
}

async function main(): Promise<void> {
  const dir = resolveMigrationsDir();
  const migrations = loadMigrationFiles(dir);
  console.log(`[migrate] 디렉터리: ${dir}`);
  console.log(`[migrate] 대상 파일 ${migrations.length}개`);

  const connection = await connect();
  let lockName: string | null = null;
  try {
    lockName = await acquireLock(
      connection,
      process.env.DATABASE_NAME as string,
    );
    await ensureHistoryTable(connection);
    const applied = await readApplied(connection);

    let appliedCount = 0;
    let skippedCount = 0;
    for (const migration of migrations) {
      const recorded = applied.get(migration.filename);
      if (recorded !== undefined) {
        if (recorded !== migration.checksum) {
          throw new Error(
            `${migration.filename} 은 이미 적용됐는데 파일 내용이 바뀌었다.\n` +
              `  기록된 체크섬 ${recorded}\n  현재 파일 체크섬 ${migration.checksum}\n` +
              `  이미 적용된 마이그레이션은 수정하지 말고 새 파일을 추가할 것. ` +
              `내용 변경이 의도된 것이라면 ${HISTORY_TABLE} 의 해당 행을 정리한 뒤 다시 실행할 것.`,
          );
        }
        skippedCount += 1;
        console.log(`[migrate] 건너뜀(이미 적용): ${migration.filename}`);
        continue;
      }
      await applyMigration(connection, migration);
      appliedCount += 1;
    }
    console.log(
      `[migrate] 완료 — 적용 ${appliedCount}개, 건너뜀 ${skippedCount}개, 전체 ${migrations.length}개`,
    );
  } finally {
    // 잠금 해제나 연결 종료가 실패해도 원래 오류를 덮지 않는다.
    if (lockName) {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } catch (releaseError) {
        console.warn(`[migrate] 잠금 해제 실패(무시): ${(releaseError as Error).message}`);
      }
    }
    await connection.end().catch(() => {});
  }
}

main().catch((error: Error) => {
  console.error(`[migrate] 실패: ${error.message}`);
  process.exit(1);
});
