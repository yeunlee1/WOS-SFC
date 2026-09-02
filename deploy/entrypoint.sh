#!/bin/sh
# 역할 — 컨테이너 기동 시 DB 준비를 기다리고 마이그레이션을 적용한 뒤 앱 프로세스를 실행한다.
#
# set -e 가 핵심이다. 대기나 마이그레이션이 실패하면 exec 에 도달하지 못하고
# 컨테이너가 그대로 죽는다. 즉 "마이그레이션이 성공해야만 앱이 뜬다".
# 스키마가 어긋난 채 앱이 올라와 절반만 동작하는 상태를 만들지 않기 위한 것이다.
set -eu

# 마이그레이션 실행 명령.
# server/package.json 에 실제로 존재하는 스크립트 이름을 확인해 `migrate` 로 맞췄다
# ("migrate": "node --env-file-if-exists=.env dist/database/migrate.js").
# 러너(server/src/database/migrate.ts)는 migrations 디렉터리를
# join(__dirname, '..', '..', 'migrations') 로 찾는다. dist/database 에서 실행되므로
# /app/server/migrations 가 되고, Dockerfile 이 그 경로에 SQL 을 복사해 둔다.
# 파일명 순으로 적용하고 schema_migrations 이력으로 이미 적용한 것은 건너뛰므로
# 재기동해도 안전하다(멱등).
# - 스크립트 이름이 바뀌면 MIGRATE_CMD 만 바꾼다.
# - 마이그레이션 없이 띄워야 하면 MIGRATE_CMD=true 를 준다(셸 내장 no-op).
#   이때 스키마는 다른 방법으로 준비되어 있어야 한다.
MIGRATE_CMD="${MIGRATE_CMD:-npm run migrate}"

echo "[entrypoint] DB 준비 대기 — ${DATABASE_HOST:-127.0.0.1}:${DATABASE_PORT:-3306}"
node /app/deploy/wait-for-db.js

echo "[entrypoint] 마이그레이션 실행 — ${MIGRATE_CMD}"
# cwd 가 /app/server 라 server/package.json 의 스크립트가 바로 잡힌다.
sh -c "${MIGRATE_CMD}"

echo "[entrypoint] 앱 시작 — $*"
exec "$@"
