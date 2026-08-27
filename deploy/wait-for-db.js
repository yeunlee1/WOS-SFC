// 역할 — 앱 기동 전에 MySQL 이 실제로 접속·질의 가능한 상태가 될 때까지 기다린다.
//
// TCP 포트 열림만 확인하면 안 된다. MySQL 공식 이미지는 초기화(데이터 디렉터리 생성,
// 계정·DB 생성) 도중에도 포트를 먼저 연다. 그 시점에 마이그레이션을 실행하면
// "Access denied" 나 "Unknown database" 로 터진다.
// 그래서 앱 계정으로 대상 DB 에 붙어 SELECT 1 이 성공할 때까지 재시도한다.
//
// mysql2 는 server 의 운영 의존성이라 최종 이미지에 이미 들어 있다(추가 설치 없음).
const mysql = require('mysql2/promise');

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USER;
const password = process.env.DATABASE_PASSWORD;
const database = process.env.DATABASE_NAME;
const timeoutSec = Number(process.env.DB_WAIT_TIMEOUT_SEC || 120);
const RETRY_INTERVAL_MS = 2000;

async function waitForDb() {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastError = null;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    let connection = null;
    try {
      connection = await mysql.createConnection({
        host,
        port,
        user,
        password,
        database,
        connectTimeout: 5000,
      });
      await connection.query('SELECT 1');
      await connection.end();
      console.log(`[wait-for-db] 준비 완료 — ${host}:${port}/${database} (시도 ${attempt}회)`);
      return;
    } catch (error) {
      lastError = error;
      if (connection) {
        // 실패한 연결을 정리한다. 정리 자체가 또 실패해도 재시도에는 영향이 없다.
        try {
          await connection.end();
        } catch (ignored) {
          void ignored;
        }
      }
      console.log(`[wait-for-db] 아직 준비 안 됨 (시도 ${attempt}회): ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
  }

  console.error(
    `[wait-for-db] ${timeoutSec}초 안에 DB 에 접속하지 못했습니다: ${lastError ? lastError.message : '원인 미상'}`,
  );
  process.exit(1);
}

void waitForDb();
