# WOS SFC 전투 보조 — CLAUDE.md

> 📁 실행·환경변수·DB 준비·Docker 배포·운영 런북 상세: [README.md](README.md) 참조.
> 설계 spec은 [docs/superpowers/specs/](docs/superpowers/specs/), 구현 plan은 [docs/superpowers/plans/](docs/superpowers/plans/)에 있다.

## 프로젝트 개요

**WOS(Whiteout Survival) SFC 연맹 운영 보조 — 실시간 웹 애플리케이션**

동맹 SFC(참모총장) 역할 수행을 보조한다. 실시간 공유 카운트다운·개인 행군 시간·집결 그룹,
실시간 채팅과 번역, 공지·게시판, 작전 보드, TTS 음성 안내를 한 화면에서 제공한다.
과거 Electron 데스크탑 앱이었으나 React 웹 + NestJS 서버 구조로 전환되었다
(전환 계획 — docs/superpowers/plans/2026-04-16-react-web-conversion.md).
2026-09-02에 Docker 배포 준비가, 09-03에 동화 버전 UI(`/story`)가 master에 병합되었다.

## 기술 스택

- **모노레포**: npm workspaces (`web`, `server`) — 루트 `package-lock.json` 하나로 의존성 고정. Node 20.19 이상 또는 22.12 이상
- **프론트엔드** (`web/`): React 18 + Vite, Zustand, Socket.IO Client, Vitest — JavaScript(JSX)
- **백엔드** (`server/`): NestJS 11, TypeORM 0.3 + MySQL 8, Socket.IO, JWT(Passport), Jest — TypeScript
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk`, 번역 — 서버 전용), Google Cloud TTS (카운트다운 음성 mp3를 서버가 사전 생성·캐시 — 서버 전용)
- **배포**: Docker Compose — `app`(NestJS가 `web/dist`까지 정적 서빙, 같은 origin) + `db`(mysql:8.4) + `proxy`(Caddy, 자동 HTTPS). 개발 포트 — 웹 5173, API 3001

## 프로젝트 구조

```
wos-sfc-helper/
├── web/                      # 브라우저 UI (React 18 + Vite)
│   ├── vite.config.js        # 개발 프록시 — API_PATHS와 /socket.io를 :3001로 전달
│   ├── style.css             # 기존 앱 스타일 (반응형 미디어쿼리 포함) — App.jsx만 import
│   ├── DESIGN.md             # daylight 팔레트의 근거로 쓴 Linear 디자인 추출본 — 이 프로젝트의 토큰 정의가 아님
│   └── src/
│       ├── main.jsx entry.js # 경로가 /story면 story/StoryApp, 아니면 App을 lazy 로드
│       ├── App.jsx           # 기존 앱 — 탭 전환, 테마, 소켓·인증 부트스트랩
│       ├── story/            # 동화 버전 UI(/story) — 자체 story.css, 기존 컴포넌트 재사용
│       ├── api/ store/ hooks/ i18n/ utils/ clockSync.js
│       └── components/
│           ├── Battle/           # 전투 탭 — 카운트다운, 개인 행군 시간, 집결 그룹, TTS 재생
│           ├── OperationBoard/   # 작전 보드 탭 — 실시간 협업 캔버스
│           ├── Community/        # 커뮤니티 탭 — 공지 핀보드, 연맹 공지, 게시판
│           ├── Chat/             # 채팅 탭·도크 — 실시간 채팅, 메시지 번역
│           └── AdminTab/ Auth/ Dashboard/ Layout/
├── server/                   # REST API + WebSocket 서버 (NestJS 11)
│   ├── migrations/           # 000 초기 스키마 + 번호순 SQL 패치 — migrate 러너가 적용
│   └── src/
│       ├── main.ts production.ts   # 부팅 — production.ts는 NODE_ENV=production 강제 후 main 로드
│       ├── static-serving.ts       # /uploads와 web/dist 정적 서빙 등록 (등록 순서 중요)
│       ├── storage-paths.ts        # 업로드 경로(UPLOAD_ROOT)
│       ├── common/                 # boot-config(부팅 검증), trust-proxy, rate-limit, login-throttle
│       ├── database/               # migrate.ts — server/migrations/*.sql 러너
│       ├── auth/ users/ me/ members/ admin/
│       ├── rallies/ rally-groups/         # 집결·랠리 그룹
│       ├── chat/ realtime/                # 채팅·Socket.IO 게이트웨이
│       ├── notices/ alliance-notices/ boards/ operation-boards/
│       ├── translate/ translations/      # Claude API 번역 (translate.service.ts)·번역 캐시
│       └── tts/                          # Google TTS 생성·캐시·/tts-audio 서빙
├── deploy/                   # Caddyfile, entrypoint.sh(DB 대기 → 마이그레이션 → 앱), wait-for-db.js
├── Dockerfile                # 멀티스테이지 — 서버·웹 빌드를 한 이미지로
├── docker-compose.yml        # app + db + proxy, 루트 .env를 읽음
├── skills-lock.json          # 디자인 작업에 쓴 외부 스킬 4개의 출처·해시 기록
├── docs/superpowers/         # specs/ 설계, plans/ 구현 계획
├── docs/design/              # frost-protocol UI 디자인 레퍼런스
├── .github/                  # PR 템플릿, CI(test.yml·codeql.yml), dependabot
├── .env.example              # 변수 이름과 기본값만 — 로컬은 server/.env, Docker는 루트 .env로 복사
└── package.json              # workspace 루트 (build·test·test:server·test:web)
```

## 개발 규칙

### 코드 스타일
- `web/`은 JavaScript(JSX) 함수 컴포넌트, `server/`는 TypeScript NestJS 모듈 구조를 따른다
- 기능은 컴포넌트 디렉토리(web)와 NestJS 모듈(server) 단위로 분리
- 주석은 한국어로 작성

### API 통신 패턴
- 웹 → 서버: REST(`web/src/api/`) + Socket.IO(채팅, 작전 보드, 접속자 표시, 카운트다운, 시계 동기화)
- 새 API 경로 접두어를 추가하면 두 곳에 등록할 것 — `web/vite.config.js`의 `API_PATHS`(개발 프록시)와 `server/src/static-serving.ts`의 `STATIC_EXCLUDED_ROUTES`(운영에서 index.html 폴백이 가로채지 않게)
- Claude API 호출은 **반드시 server의 translate 모듈에서**, Google TTS 호출은 **반드시 server의 tts 모듈에서** (API 키 보안) — 브라우저 직접 호출 금지. 웹은 `/tts-audio`의 mp3만 재생한다

### 데이터 저장
- MySQL 8 + TypeORM 엔티티. 운영 스키마는 `server/migrations/*.sql`을 마이그레이션 러너(`server/src/database/migrate.ts`)로 적용해 만든다. `000_initial_schema.sql`이 빈 DB에 테이블을 만들고, 컨테이너는 기동 시 자동 적용한다. 로컬 소스에서는 `npm --workspace server run migrate:dev`(ts-node), 빌드된 dist에서는 `run migrate`
- 적용된 마이그레이션 파일은 수정하지 않는다(체크섬 불일치로 기동 거부). 스키마 변경은 새 번호 파일로 추가하고 엔티티와 함께 맞춘다
- `TYPEORM_SYNC=true`는 폐기 가능한 로컬 개발 DB 전용 — 운영 모드(`NODE_ENV=production`)에서는 무시된다

### 동화 버전 (`/story`)
- `web/src/entry.js`의 `resolveEntry`가 경로를 보고 `main.jsx`에서 `App` 또는 `story/StoryApp`을 lazy 로드한다. 같은 서버·로그인·실시간 데이터를 쓴다
- 두 앱은 서로의 CSS를 로드하지 않는다 — `style.css`는 `App.jsx`만, `story.css`는 `StoryApp.jsx`만 import한다. 기존 앱 컴포넌트를 재사용할 때 스타일은 `story.css`에 새로 입힌다

### 배포·부팅
- production에서 `WEB_ORIGIN`·`JWT_SECRET`(32자 이상)·`SERVER_CODE`가 비면 부팅을 거부한다(`server/src/common/boot-config.ts`). `WEB_ORIGIN`은 브라우저가 실제로 여는 주소와 정확히 같아야 한다(HTTP CORS와 소켓 핸드셰이크 둘 다 검사)
- 컨테이너 기동 순서는 `deploy/entrypoint.sh` — DB 대기 → 마이그레이션 → 앱. 마이그레이션이 실패하면 앱이 뜨지 않는다
- 첫 배포 체크리스트·백업·갱신 배포·프록시 단 수(`TRUST_PROXY_HOPS`)는 README "Docker 배포" 절을 따른다

### UI / 반응형 디자인 (필수)
- **모든 UI 구현은 반드시 모바일 반응형으로 작성할 것** — 데스크톱 전용 금지
- 브레이크포인트: `768px` (모바일), `480px` (소형 모바일)
- 고정 px 너비 금지 → `min()`, `clamp()`, `%`, `vw` 사용
- 2열 이상 그리드는 `@media (max-width: 768px)` 에서 1열로 전환
- iOS Safari `100vh` 버그 대응: `height: 100dvh` 사용
- 새 컴포넌트 추가 시 Chrome DevTools 모바일 에뮬레이터(iPhone SE 375px)로 반드시 확인

### 보안
- `.env`, JWT 키, `SERVER_CODE`(가입 초대 코드), DB 자격 증명, 외부 API 키를 커밋하지 않는다
- 비밀값은 `server/.env`(로컬)와 루트 `.env`(Docker)에만 보관. 브라우저 번들에 포함되는 `VITE_` 변수에는 절대 넣지 않는다
- HTTP·WebSocket CORS 허용 origin은 `WEB_ORIGIN`으로 제어한다 (운영 필수)

### 테스트
- 웹: Vitest — `npm --workspace web test -- --run`
- 서버: Jest — `npm --workspace server test -- --runInBand`
- 서버 e2e는 MySQL과 서버 환경변수가 필요하다 — DB 없는 CI에서는 실행되지 않는다
- CI(`.github/workflows/test.yml`)는 master 대상 PR마다 Node 22에서 web·server 각각 테스트+빌드를 돌린다. 문서만 고친 PR도 돈다(required check)

## 환경 설정

```powershell
# 의존성 설치 (저장소 루트에서, lockfile 기준)
npm ci

# 환경변수 준비 — 복사 후 빈 값 채우기
Copy-Item .env.example server/.env

# DB 스키마 — server/migrations/*.sql 적용 (여러 번 실행해도 안전, 빌드 없이 ts-node로 실행)
npm --workspace server run migrate:dev

# 개발 실행 (터미널 2개)
npm --workspace server run start:dev   # API — http://localhost:3001
npm --workspace web run dev            # 웹 UI — http://localhost:5173 (동화 버전은 /story)

# 테스트·빌드 (루트에서 두 workspace 모두)
npm test
npm run build

# Docker 배포 — 루트 .env 준비 후 (상세는 README)
docker compose up -d --build
```

## 현재 기능 목록

| 탭 | 기능 | 상태 |
|----|------|------|
| 전투 | 실시간 공유 카운트다운(TTS 음성 안내)·개인 행군 시간·집결 그룹(최대 6개) | 구현됨 |
| 작전 보드 | 실시간 협업 작전 캔버스 — 저장본 목록, 참가자, 보드 채팅 패널 | 구현됨 |
| 커뮤니티 | 공지 핀보드·연맹 공지·연맹별 게시판(이미지 업로드)·게시글 번역 | 구현됨 |
| 채팅 | 실시간 채팅·메시지 번역 (Claude API)·다른 탭에서 여는 채팅 도크 | 구현됨 |
| 관리자 | 사용자 목록·역할·연맹 리더 지정·차단 (`developer` 역할만 탭 표시) | 구현됨 |
| 동화 버전 | `/story` — 같은 기능을 수채화 그림책 UI로. 입구·전투현황·커뮤니티는 새 껍데기, 작전판·채팅·관리자는 기존 컴포넌트 | 구현됨 |

공통 — JWT 인증(가입 초대 코드 `SERVER_CODE` 필요, 기기별 refresh 토큰), 다국어 i18n(ko/en/ja/zh), 테마(frost/spring/daylight — 목록은 `web/src/store/index.js`의 `THEMES`), 접속자 표시.

## Superpowers 워크플로우

> **CRITICAL**: 이 프로젝트는 Superpowers MCP를 사용한다.
> **대화 시작 즉시** Skill 도구로 `using-superpowers` 스킬을 호출할 것 — 예외 없음.

### 필수 규칙
- **매 대화 첫 번째 행동**: `Skill({ skill: "using-superpowers" })` 호출
- 작업에 1%라도 적용될 스킬이 있으면 반드시 해당 스킬을 invoke할 것
- 스킬은 행동 전에 확인, 행동 후가 아님
- 스킬 없이 구현부터 시작하는 것은 금지

### 작업별 스킬 매핑

| 작업 유형 | 사용 스킬 순서 |
|-----------|---------------|
| 새 기능 개발 | `brainstorming` → `writing-plans` → `test-driven-development` |
| 버그 수정 | `systematic-debugging` → `verification-before-completion` |
| 독립적 작업 다수 | `dispatching-parallel-agents` 또는 `subagent-driven-development` |
| 완료 전 | `verification-before-completion` |
| PR/머지 전 | `requesting-code-review` → `finishing-a-development-branch` |

### 스킬 우선순위
1. 프로세스 스킬 먼저 (brainstorming, debugging)
2. 구현 스킬 나중에
