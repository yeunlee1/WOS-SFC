# WOS SFC 전투 보조

WOS SFC 연맹 운영을 위한 실시간 웹 애플리케이션입니다. 전투 카운트, 랠리 그룹, 채팅과 공지, 작전 보드, 번역과 TTS 기능을 한 화면에서 제공합니다.

## 기술 구성

| 경로                 | 역할                             | 주요 기술                                  |
| -------------------- | -------------------------------- | ------------------------------------------ |
| `web/`               | 브라우저 UI                      | React 18, Vite, Vitest, Socket.IO Client   |
| `server/`            | REST API와 WebSocket 서버        | NestJS 11, TypeORM, MySQL, Jest, Socket.IO |
| `server/migrations/` | 기존 DB에 적용하는 수동 SQL 패치 | MySQL SQL                                  |
| `docs/`              | 기능 설계와 구현 계획            | Markdown                                   |
| `.github/`           | PR 템플릿, CI, 보안 자동화       | GitHub Actions, Dependabot                 |

루트 `package-lock.json`이 두 npm workspace의 의존성을 함께 고정합니다. 설치 명령은 저장소 루트에서 실행하십시오.

## 요구 사항

- Node.js 20.19 이상 또는 지원되는 Node.js 22.12 이상과 npm.
- MySQL 8.x.
- 개발 서버용 포트 3001과 5173.

## 환경변수

루트 [.env.example](.env.example)은 변수 이름과 비밀이 아닌 기본값만 담습니다. 서버를 실행하기 전에 파일을 `server/.env`로 복사하고 빈 값을 채우십시오.

```powershell
Copy-Item .env.example server/.env
```

| 이름                 | 용도                                  | 필수 여부                                      |
| -------------------- | ------------------------------------- | ---------------------------------------------- |
| `NODE_ENV`           | 실행 환경 구분                        | `start:prod`가 `production`으로 강제           |
| `PORT`               | NestJS 포트                           | 선택, 기본값 3001                              |
| `WEB_ORIGIN`         | HTTP와 WebSocket CORS 허용 origin     | 운영 필수, 개발 기본값 `http://localhost:5173` |
| `DATABASE_HOST`      | MySQL 호스트                          | 필수                                           |
| `DATABASE_PORT`      | MySQL 포트                            | 선택, 기본값 3306                              |
| `DATABASE_USER`      | MySQL 사용자                          | 필수                                           |
| `DATABASE_PASSWORD`  | MySQL 비밀번호                        | 필수                                           |
| `DATABASE_NAME`      | MySQL 데이터베이스                    | 필수                                           |
| `TYPEORM_SYNC`       | 개발용 TypeORM 스키마 동기화          | 선택, 기본값 `false`                           |
| `JWT_SECRET`         | access·refresh JWT 서명 키            | 필수                                           |
| `SERVER_CODE`        | 저장소 밖에서 관리하는 가입 초대 코드 | 필수                                           |
| `ANTHROPIC_API_KEY`  | 번역 API                              | 번역 기능 사용 시 필수                         |
| `GOOGLE_TTS_API_KEY` | Google TTS 생성 API                   | TTS 생성 기능 사용 시 필수                     |
| `TTS_CACHE_DIR`      | 생성한 TTS 파일 보관 경로             | 선택                                           |
| `VITE_API_TARGET`    | Vite 개발 프록시 대상                 | 선택, 기본값 `http://localhost:3001`           |
| `VITE_API_URL`       | 브라우저 API 기준 URL                 | 선택, 기본값 `/`                               |

`VITE_API_TARGET`은 현재 `vite.config.js`가 `process.env`에서 읽습니다. 기본값을 바꿀 때는 Vite 실행 전에 셸 환경변수로 설정하십시오.

```powershell
$env:VITE_API_TARGET='http://localhost:3002'
npm --workspace web run dev
```

브라우저 코드에서 읽는 `VITE_API_URL`은 필요할 때 `web/.env.local`에 둘 수 있습니다. 비밀값은 `VITE_` 변수에 넣지 마십시오. Vite가 해당 값을 브라우저 번들에 포함합니다.

## 설치

```powershell
npm ci
```

`npm ci`는 루트 lockfile을 기준으로 `web`과 `server` workspace를 설치합니다.

## 데이터베이스 준비

MySQL 데이터베이스와 전용 사용자를 만든 뒤 `server/.env`에 접속 정보를 넣으십시오. 스키마는 마이그레이션 러너가 만듭니다.

```powershell
npm --workspace server run migrate
```

러너(`server/src/database/migrate.ts`)는 `server/migrations/*.sql`을 파일명 순으로 적용하고, `schema_migrations` 이력 테이블에 기록해 이미 적용한 파일은 건너뜁니다. 여러 번 실행해도 안전합니다.

| 파일 | 역할 |
| --- | --- |
| `000_initial_schema.sql` | 빈 데이터베이스에 엔티티 테이블을 생성 |
| `001_users_nullable_pii.sql` | `users`의 `birth_date`·`name`을 NULL 허용으로 변경 |
| `002_dev_accounts_camelcase_rename.sql` | 레거시 `dev_*` 계정 닉네임을 camelCase로 변경 |
| `003_messages_created_at_index.sql` | `messages.created_at` 인덱스 추가 |

> **이미 테이블이 있는 기존 DB에 그대로 돌리지 마십시오.** `000_initial_schema.sql`은 **빈 DB 기준**이고 `CREATE TABLE IF NOT EXISTS`를 쓰기 때문에, 테이블이 이미 있으면 **정의가 일치하는지 검사하지 않고 조용히 건너뜁니다.** 개발용 `wos_db`처럼 기존 DB를 계속 쓸 계획이라면 적용 전에 **현재 스키마와 이 파일을 직접 대조**하고, 백업과 예상 변경 범위를 확인하십시오.

폐기 가능한 로컬 개발 DB에서는 `TYPEORM_SYNC=true`로 엔티티 기반 테이블을 만들 수도 있습니다. 운영 모드(`NODE_ENV=production`)에서는 애플리케이션이 이 설정을 무시하고 동기화를 끄므로, 운영 스키마는 위 마이그레이션이 유일한 생성 수단입니다.

## 개발 실행

터미널 두 개에서 서버와 웹을 각각 실행하십시오.

```powershell
npm --workspace server run start:dev
```

```powershell
npm --workspace web run dev
```

- 웹 UI는 `http://localhost:5173`에서 열립니다.
- API는 `http://localhost:3001`을 사용합니다.

## 테스트와 빌드

```powershell
npm --workspace web test -- --run
npm --workspace web run build
npm --workspace server test -- --runInBand
npm --workspace server run build
```

서버 e2e 테스트는 `AppModule`을 시작하므로 MySQL과 서버 환경변수가 필요합니다. CI는 DB가 없는 환경에서 e2e를 실행하지 않습니다. 로컬 환경을 준비한 경우 다음 명령으로 확인하십시오.

```powershell
npm --workspace server run test:e2e -- --runInBand --forceExit
```

## Docker 배포

호스팅 업체에 종속되지 않는 컨테이너 구성입니다. VPS 한 대에 Docker 와 Docker Compose 만 있으면 그대로 동작합니다.

### 구성

| 서비스  | 이미지            | 역할                                                    |
| ------- | ----------------- | ------------------------------------------------------- |
| `proxy` | `caddy:2-alpine`  | TLS 종단, HTTP·WebSocket 리버스 프록시                  |
| `app`   | 저장소의 `Dockerfile` | NestJS API + `web/dist` 정적 서빙 (같은 origin)     |
| `db`    | `mysql:8.4`       | 데이터베이스                                            |

웹은 별도 컨테이너가 아닙니다. `server/src/app.module.ts`의 `ServeStaticModule`이 `web/dist`를 직접 서빙하므로 API 와 화면이 같은 origin 을 씁니다.

### 마이그레이션은 자동으로 적용됩니다

컨테이너가 뜰 때 `deploy/entrypoint.sh` 가 아래 순서로 실행합니다.

1. `deploy/wait-for-db.js` — 앱 계정으로 대상 DB 에 실제로 `SELECT 1` 이 될 때까지 기다립니다. (포트만 열린 초기화 중간 상태에서 마이그레이션이 터지는 것을 막습니다.)
2. `npm run migrate` — `server/migrations/*.sql` 을 파일명 순으로 적용합니다. `schema_migrations` 이력 테이블로 이미 적용한 파일은 건너뛰므로 재기동해도 안전합니다.
3. 앱 프로세스 시작.

**2단계가 실패하면 앱은 뜨지 않습니다.** 스키마가 어긋난 채 절반만 동작하는 상태를 막기 위한 의도된 동작입니다. 실패 원인은 `docker compose logs app` 에서 확인하십시오.

`000_initial_schema.sql` 이 빈 데이터베이스에 테이블을 만들어 주므로, 새 볼륨에 처음 배포할 때 별도 준비가 필요 없습니다. 운영 모드에서는 `TYPEORM_SYNC` 가 무시되어 앱이 테이블을 만들지 않으므로 이 경로가 유일한 스키마 생성 수단입니다.

> **기존 DB를 그대로 옮겨 쓸 때는 주의하십시오.** `000_initial_schema.sql` 은 빈 DB 기준이고 `CREATE TABLE IF NOT EXISTS` 라, 테이블이 이미 있으면 **정의가 같은지 검사하지 않고 건너뜁니다.** 기존 덤프를 `db` 컨테이너에 복원해 쓸 계획이면 복원 뒤 스키마를 직접 대조하십시오. 컬럼이 하나 부족해도 마이그레이션은 성공으로 끝나고, 문제는 런타임 쿼리에서 처음 드러납니다.

실행할 명령을 바꾸려면 `.env` 의 `MIGRATE_CMD` 를 쓰십시오. 마이그레이션 없이 띄워야 하면 `MIGRATE_CMD=true` 로 건너뛸 수 있습니다.

### 1. 환경변수 준비

```bash
cp .env.example .env
```

`.env`를 열어 빈 값을 채웁니다. 최소한 아래가 필요합니다.

`DATABASE_ROOT_PASSWORD`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`, `JWT_SECRET`, `SERVER_CODE`, `WEB_ORIGIN`

값에는 `$` `#` 따옴표 공백을 넣지 마십시오(compose 치환에서 깨집니다). `JWT_SECRET` 은 32자 이상이어야 하며(`openssl rand -hex 32`), 짧거나 `SERVER_CODE` 가 비어 있으면 앱이 부팅을 거부합니다.

`GOOGLE_TTS_API_KEY`(TTS 생성)와 `ANTHROPIC_API_KEY`(번역)는 해당 기능을 쓸 때만 채웁니다.

> `WEB_ORIGIN` 은 **브라우저가 실제로 여는 주소와 정확히 같아야 합니다**(스킴·호스트·포트 모두). 이 값은 HTTP CORS 뿐 아니라 WebSocket 핸드셰이크 검사에도 그대로 쓰이므로, 어긋나면 화면은 떠도 실시간 카운트다운이 붙지 않습니다. `NODE_ENV=production` 에서 값이 비면 앱이 부팅 자체를 거부합니다. 서버가 부팅 시 끝 슬래시와 경로를 잘라내고, 값에 `localhost` 가 남아 있으면 `.env.example` 자리표시자가 그대로 들어온 것으로 보고 경고를 남깁니다 — `docker compose logs app | grep WEB_ORIGIN` 으로 확인하십시오.

### 2-A. 도메인이 없는 경우

> **평문 HTTP 로는 쓸 수 없습니다 — 로그인은 물론 화면도 뜨지 않습니다.**
> `server/src/auth/auth.controller.ts` 의 `cookieOptions` 가 `NODE_ENV=production` 에서 인증 쿠키에 `secure` 를 붙이므로 `http://<서버 IP>` 에서는 브라우저가 쿠키를 버립니다. 그 위에 `server/src/main.ts` 의 `helmet()` 기본 CSP 가 `upgrade-insecure-requests` 를 내보내, 브라우저가 스크립트·API 요청을 https 로 승격하고 443 이 닫혀 있으면 빈 화면만 남습니다.
> (`http://localhost` 는 브라우저가 보안 컨텍스트로 취급해 예외지만, 원격 IP 는 해당하지 않습니다.)

그래서 도메인이 없어도 **HTTPS 를 켭니다.** 두 가지 방법이 있습니다.

**방법 1 (권장) — IP 기반 무료 도메인으로 진짜 인증서 받기**

`sslip.io` 와 `nip.io` 는 IP 를 그대로 이름으로 되돌려주는 공개 DNS 입니다. 도메인을 사지 않고도 Let's Encrypt 인증서를 받을 수 있습니다. 설정 방법은 2-B 와 완전히 같고 값만 다릅니다.

```
# 서버 IP 가 203.0.113.10 이라면
SITE_ADDRESS=203.0.113.10.sslip.io
WEB_ORIGIN=https://203.0.113.10.sslip.io
```

- `SITE_ADDRESS` 에 **IP 를 직접 넣지 마십시오.** Caddy 가 공개 인증서 대신 자체서명 인증서를 만들어 브라우저 경고가 뜹니다.
- Let's Encrypt 발급 한도는 `sslip.io` 도메인 전체가 공유합니다. `docker compose logs proxy` 에 `too many certificates already issued` 가 보이면 `nip.io` 로 바꿔 다시 띄우십시오(`SITE_ADDRESS=203.0.113.10.nip.io`, `WEB_ORIGIN` 도 함께). 연 1만 원대 도메인을 하나 사면 이 문제 자체가 사라집니다.

**방법 2 — Caddy 자체 서명 인증서**

인터넷에서 80·443 이 열리지 않는 폐쇄망이라면 `deploy/Caddyfile` 의 사이트 블록 안에 `tls internal` 한 줄을 넣습니다. 브라우저에 경고가 뜨고 사용자가 매번 예외를 승인해야 하지만, 연결 자체는 HTTPS 라 로그인은 동작합니다.

**기동 확인만 할 때**

`SITE_ADDRESS` 를 비우면 Caddy 가 `:80` 으로 뜹니다. 브라우저에서는 위 이유로 동작하지 않으므로 `docker compose ps` 의 `healthy` 와 `curl http://<서버 IP>/time` 으로만 확인하고, 확인이 끝나면 방법 1 로 바꾸십시오.

### 2-B. 도메인이 있는 경우 (자동 HTTPS)

도메인의 A(또는 AAAA) 레코드가 서버를 가리키게 하고, 방화벽에서 80·443 을 엽니다. 그다음 `.env`에 아래를 넣습니다.

```
SITE_ADDRESS=sfc.example.com
WEB_ORIGIN=https://sfc.example.com
```

```bash
docker compose up -d --build
```

Caddy 가 Let's Encrypt 인증서를 자동 발급하고 `80 → 443` 리다이렉트까지 겁니다. 별도 인증서 작업이 없습니다.

### 3. 상태 확인

```bash
docker compose ps
docker compose logs -f app
```

`app` 이 `healthy` 가 되면 정상입니다. 헬스체크는 `/time` 응답만 봅니다 — HTTP 서버가 살아 있다는 뜻이지 DB 연결까지 보증하지는 않습니다. DB 문제는 `docker compose logs app` 에서 확인하십시오. 마이그레이션이 적용됐는지는 `docker compose logs app | grep "\[migrate\]"` 로 봅니다(첫 배포면 `000`~`004` 다섯 파일이 `적용` 으로 찍힙니다).

### 첫 배포 체크리스트

1. **서버 시계** — `timedatectl status` 에서 `System clock synchronized: yes` 를 확인합니다. 헤더의 게임 UTC 시각은 이 시계를 그대로 보여줍니다.
2. **최소 사양** — RAM 2GB 이상. 1GB 라면 빌드 전에 스왑을 만듭니다.
   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   ```
3. **TTS 캐시 옮기기** — 개발 PC 의 `server/tts-cache`(mp3 796개 + `cache.meta.json`)를 통째로 옮깁니다. **`cache.meta.json` 을 빠뜨리면 첫 부팅에서 mp3 가 전부 삭제되고**, `GOOGLE_TTS_API_KEY` 가 있으면 재생성에 27분, 없으면 음성이 영영 나오지 않습니다.
   ```bash
   # 개발 PC 에서
   tar czf tts-cache.tgz -C server tts-cache
   scp tts-cache.tgz user@서버:/tmp/
   # 서버에서 — 컨테이너를 올리기 전에. 소유권은 이미지의 node 사용자(uid 1000)로 맞춥니다.
   docker volume create wos-sfc-helper_tts-cache
   docker run --rm -v wos-sfc-helper_tts-cache:/data -v /tmp:/src alpine sh -c 'tar xzf /src/tts-cache.tgz -C /data --strip-components=1 && chown -R 1000:1000 /data'
   ```
   옮길 캐시가 없으면 `GOOGLE_TTS_API_KEY` 를 채우고 첫 기동 뒤 `docker compose logs app | grep TTS` 로 사전 생성 완료를 기다립니다.
4. **첫 관리자 만들기** — 화면에서 가입한 뒤 DB 에서 역할을 올립니다. `developer` 역할은 API 로 부여할 수 없습니다.
   ```bash
   docker compose exec db mysql -u root -p"$DATABASE_ROOT_PASSWORD" "$DATABASE_NAME" -e "UPDATE users SET role='developer' WHERE nickname='<닉네임>'"
   ```
   브라우저를 새로고침하면 소켓이 재접속하며 새 역할이 반영됩니다.
5. **프록시 단 수 확인** — 아래 "프록시 단 수 확인" 절대로 `[trust proxy 진단]` 로그를 봅니다.
6. **백업 리허설** — 아래 "볼륨과 백업" 의 덤프와 복원을 한 번 실행해 절차가 동작하는지 확인합니다.

### 프록시 단 수 확인 — `TRUST_PROXY_HOPS`

**배포 직후 반드시 한 번 확인하십시오.** 이 값이 틀리면 요청 한도가 잘못 걸리고, 방향에 따라 보안 구멍이 됩니다.

앱은 요청 한도를 "누가 보냈는가"로 셉니다. 프록시 뒤에서는 앱이 보는 상대가 항상 프록시라 진짜 클라이언트 주소는 `X-Forwarded-For` 헤더에만 남습니다. `TRUST_PROXY_HOPS` 는 그 헤더에서 **뒤에서 몇 번째까지 믿을 것인가**이고, **실제 프록시 단 수와 정확히 같아야 합니다.**

| 상태 | 결과 |
| --- | --- |
| 너무 **작다** | 접속자 전원의 IP 가 프록시 주소 하나로 잡힙니다. 동시 접속 100명이 로그인·토큰갱신 한도를 **한 버킷으로 공유**해, 한 명이 한도를 채우면 나머지가 429 로 막히고 작전 중 강제 로그아웃됩니다. |
| 너무 **크다** | 클라이언트가 직접 넣은 `X-Forwarded-For` 항목까지 신뢰합니다. 헤더 한 줄로 요청마다 새 IP 를 지어내 한도를 **무제한 우회**합니다. 특히 **로그인 무차별 대입 방어가 통째로 무력화됩니다** — 계정 단위 게이트가 "이 계정에 이 IP 가 시도한 적 있는가" 기록에 의존하는데, 매 요청이 "처음 보는 IP" 가 되어 첫 시도가 계속 통과합니다. |

**이 compose 구성에서는 1입니다.** 브라우저 → Caddy → 앱 으로 앱 앞의 프록시가 정확히 한 단입니다.

#### 값 확인 방법

서버가 부팅 후 **첫 5건**의 실제 요청에 대해 `X-Forwarded-For` 체인과 `req.ip`, 현재 홉 수, 권장 값을 **서버 로그에만** 남깁니다. HTTP 응답으로는 아무것도 나가지 않습니다.

```bash
docker compose logs app | grep "trust proxy"
```

`체인 길이` 값을 그대로 `TRUST_PROXY_HOPS` 에 넣으면 됩니다. 판정이 `정상` 이면 그대로 두십시오. 표본 5건을 다 채우면 진단이 멈추므로, 다시 재려면 `docker compose restart app` 하십시오.

> 컨테이너 헬스체크는 루프백에서 `X-Forwarded-For` 없이 앱에 직접 붙으므로 이 표본을 잡아먹지 않습니다(프록시를 거치지 않습니다).

#### 앞에 CDN 을 두는 경우

Cloudflare 같은 CDN 을 한 단 더 두면 `TRUST_PROXY_HOPS=2` 가 됩니다. **그런데 홉 수만 올려서는 안 됩니다.**

Caddy 는 신뢰하지 않는 상대가 보낸 `X-Forwarded-For` 를 **기본적으로 버리고 새로 씁니다**(위조 방지가 목적입니다). 그대로 두면 Caddy 가 CDN 의 XFF 를 버려 **CDN 의 IP 가 클라이언트로 기록되고 진짜 클라이언트 IP 는 영구히 유실됩니다.** 이 상태는 체인 길이가 1이라 진단 로그도 `정상` 으로 판정하므로 잡히지 않습니다.

`deploy/Caddyfile` 상단의 `trusted_proxies` 블록 주석을 풀고 CDN 의 실제 IP 대역을 넣은 뒤, `TRUST_PROXY_HOPS=2` 로 올리십시오.

### 운영 런북

**작전 중 배포 금지.** 재배포하면 진행 중인 카운트다운·집결·라이브 작전판이 전부 끊깁니다. 배포 전에 `docker compose logs app | grep negotiateStartedAt` 로 최근 카운트다운이 없음을 확인하십시오.

**갱신 배포는 2단계로.** 빌드가 실패해도 기존 컨테이너는 살아 있습니다.

```bash
git pull
docker compose build --pull app
docker compose up -d
docker compose ps                     # app 이 healthy 인지
docker compose logs app | tail -50    # 마이그레이션·부팅 경고
```

롤백은 `git checkout <이전 태그>` 뒤 같은 두 명령입니다. 마이그레이션은 되돌리지 않으므로, 스키마를 바꾼 배포는 롤백 전에 DB 백업이 있는지 확인하십시오.

**마이그레이션 파일은 수정하지 않습니다.** 적용된 `server/migrations/*.sql` 을 한 글자라도 고치면(주석 포함) 체크섬 불일치로 다음 기동이 거부됩니다. 변경은 항상 새 번호 파일로 추가합니다.

**비밀번호 초기화.** 가입에 이메일이 없어 사용자가 스스로 복구할 수 없습니다. 운영자가 해시를 만들어 넣습니다.

```bash
docker compose exec app node -e "require('bcrypt').hash(process.argv[1],12).then(console.log)" '새비밀번호'
docker compose exec db mysql -u root -p"$DATABASE_ROOT_PASSWORD" "$DATABASE_NAME" -e "UPDATE users SET password_hash='<위 해시>' WHERE nickname='<닉네임>'"
```

**문구·음성 변경 배포.** `GOOGLE_TTS_API_KEY` 가 있어야 바뀐 mp3 가 재생성됩니다. 브라우저 캐시 때문에 최대 1시간 옛 음성이 섞입니다. 컨테이너에서 미리 만들려면 `docker compose exec app npm run tts:generate:prod` 를 실행합니다.

**한 계정은 기기 10개까지.** refresh 토큰이 기기별로 저장되며 11번째 로그인부터 가장 오래된 기기가 로그아웃됩니다. 로그아웃은 그 기기의 세션만 지웁니다.

**로그.** 컨테이너 로그는 20MB × 5개로 회전합니다. `docker compose logs --since 1h app` 처럼 기간을 잘라 보십시오. Caddy 접근 로그는 `docker compose logs proxy` 에 JSON 으로 남습니다.

### 볼륨과 백업

**볼륨을 붙이지 않고 배포하면 컨테이너를 다시 만들 때 아래가 전부 사라집니다.**

| 볼륨          | 컨테이너 경로            | 사라지면                                                        |
| ------------- | ------------------------ | --------------------------------------------------------------- |
| `mysql-data`  | `/var/lib/mysql`         | 계정·채팅·공지·집결 그룹·작전판이 전부 소실 (복구 불가)         |
| `uploads`     | `/app/uploads`           | 게시판 업로드 이미지가 전부 깨짐                                 |
| `tts-cache`   | `/app/server/tts-cache`  | mp3 796개 재생성에 약 27분. 그동안 카운트다운 음성이 나오지 않음 |
| `caddy-data`  | `/data`                  | TLS 인증서 재발급. 반복하면 Let's Encrypt 발급 한도에 걸림       |

백업은 볼륨을 tar 로 떠서 보관합니다.

```bash
# DB 는 파일 복사가 아니라 논리 덤프를 권장합니다 (실행 중에도 안전)
docker compose exec db sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"' > backup-db.sql

# 업로드 이미지와 TTS 캐시
docker run --rm -v wos-sfc-helper_uploads:/data -v "$PWD":/backup alpine tar czf /backup/backup-uploads.tar.gz -C /data .
docker run --rm -v wos-sfc-helper_tts-cache:/data -v "$PWD":/backup alpine tar czf /backup/backup-tts-cache.tar.gz -C /data .
```

볼륨 이름 앞에 붙는 `wos-sfc-helper_` 는 compose 프로젝트 이름입니다. `docker volume ls` 로 실제 이름을 확인하십시오.

복구는 반대로 합니다.

```bash
# DB
docker compose exec -T db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < backup-db.sql
# 볼륨
docker run --rm -v wos-sfc-helper_tts-cache:/data -v "$PWD":/backup alpine tar xzf /backup/backup-tts-cache.tar.gz -C /data
```

**매일 자동 덤프 (crontab -e).** 04:00 에 DB 를 덤프하고 7일치만 남깁니다. 저장소 경로는 실제 위치로 바꾸십시오.

```
0 4 * * * cd /opt/wos-sfc-helper && docker compose exec -T db sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"' | gzip > /var/backups/wos-db-$(date +\%F).sql.gz && find /var/backups -name 'wos-db-*.sql.gz' -mtime +7 -delete
```

**VPS 밖으로 복사하지 않으면 디스크 장애 한 번에 전부 잃습니다.** `scp` 나 `rclone` 으로 덤프를 매일 외부(다른 PC, 오브젝트 스토리지)에 복사하십시오. 첫 배포 직후 빈 DB 에 한 번 복원해 절차가 실제로 동작하는지 확인하십시오.

### 갱신 배포

위 "운영 런북" 의 2단계 절차(`build --pull app` → `up -d`)를 따릅니다. `app` 컨테이너만 새로 만들어지고 볼륨은 그대로 유지되므로 TTS 캐시가 살아 있어 재생성 대기 없이 바로 음성이 나옵니다. 작전 중에는 배포하지 마십시오.

### 포트를 바꿔 띄우기

호스트의 80·443 이 이미 사용 중이면 `.env` 에서 바꿉니다. 단 자동 HTTPS 는 80·443 이 있어야 동작하므로, 포트를 바꾼 상태에서는 Let's Encrypt 발급이 되지 않습니다. 이 구성은 로컬 검증용(`SITE_ADDRESS=localhost` 로 Caddy 자체서명)이나 폐쇄망(방법 2)에서만 쓰십시오. 평문 HTTP 로는 브라우저에서 동작하지 않습니다.

```
HTTP_PORT=18080
HTTPS_PORT=18443
```

### PaaS(Fly · Railway · Render)에 올릴 때

`Dockerfile` 은 그대로 쓸 수 있지만 **`docker-compose.yml` 은 쓸 수 없습니다.** 세 곳 모두 compose 를 실행하지 않고 서비스를 하나씩 따로 정의합니다. 옮길 때 달라지는 점은 아래와 같습니다.

- **프록시 컨테이너가 필요 없습니다.** 세 곳 모두 플랫폼 라우터가 TLS 를 종단합니다. `proxy` 서비스를 빼고 앱을 직접 노출하십시오. 이때도 앱 앞의 프록시는 여전히 한 단(플랫폼 라우터)이라 `TRUST_PROXY_HOPS=1` 이 유지될 가능성이 높지만, 플랫폼마다 다르므로 배포 후 실제 `X-Forwarded-For` 를 확인해 정하십시오.
- **포트는 플랫폼이 주입합니다.** 앱이 `process.env.PORT` 를 읽으므로(`server/src/main.ts`) 추가 작업이 없습니다.
- **MySQL 을 따로 마련해야 합니다.** Railway 는 관리형 MySQL 을 제공합니다. Render 는 PostgreSQL 만 제공하고 Fly 는 관리형 MySQL 이 없으므로, 외부 관리형 MySQL 을 붙이거나 DB 를 별도 서비스로 직접 운영해야 합니다.
- **영속 디스크가 앱 서비스당 하나인 경우가 많습니다.** 이 앱은 앱 쪽에만 영속 경로가 둘(`/app/uploads`, `/app/server/tts-cache`)입니다. TTS 캐시는 `TTS_CACHE_DIR` 로 옮길 수 있지만, **업로드 경로는 코드에 고정되어 있습니다**(`server/src/storage-paths.ts` 의 `UPLOAD_ROOT` = 저장소 루트 기준 `uploads`). 디스크 하나만 붙일 수 있는 플랫폼에서는 업로드 경로를 환경변수로 바꿀 수 있게 코드를 고치거나, 디스크를 `/app/uploads` 에 붙이고 `TTS_CACHE_DIR=/app/uploads/tts-cache` 로 한 디스크 안에 함께 두는 방법을 쓰십시오.

## 보안

- `.env`, JWT 키, 회원가입 코드, DB 자격 증명, 외부 API 키를 커밋하지 마십시오.
- 과거 빠른 로그인에 쓰인 레거시 개발 계정은 인증 경로에서 격리됩니다. 다시 사용하려면 DB 자격 증명을 먼저 회전한 뒤 격리 목록을 검토하십시오.
- 의존성을 바꾼 PR에서는 `npm audit` 결과와 인증·권한·개인정보 영향을 확인하십시오.
- 취약점 세부, 인증정보, 악용 절차를 공개 Issue에 올리지 마십시오.

현재 전용 보안 메일과 GitHub 비공개 취약점 신고 기능은 설정되어 있지 않습니다. 민감한 문제는 저장소 소유자 [@yeunlee1](https://github.com/yeunlee1)에게 GitHub 프로필의 비공개 연락 수단으로 먼저 전달하십시오. 비공개 연락 수단이 없으면 취약점 세부를 제외한 연락 요청만 Issue에 남기십시오.

## 라이선스

이 공개 저장소에는 아직 별도 `LICENSE` 파일이 없습니다. 사용·배포·재배포 권한은 저장소 소유자에게 확인하십시오.
