# WOS SFC 전투 보조 — CLAUDE.md

> 📁 실행·환경변수·DB 준비 상세: [README.md](README.md) 참조.
> 설계 spec과 구현 plan 문서는 [docs/superpowers/](docs/superpowers/)에 있다.

## 프로젝트 개요

**WOS(Whiteout Survival) SFC 연맹 운영 보조 — 실시간 웹 애플리케이션**

동맹 SFC(참모총장) 역할 수행을 보조한다. 전투 카운트다운·랠리 그룹, 발송 타이밍 계산,
실시간 채팅과 번역, 공지·게시판, 작전 보드, TTS 음성 안내를 한 화면에서 제공한다.
과거 Electron 데스크탑 앱이었으나 React 웹 + NestJS 서버 구조로 전환되었다
(전환 계획 — docs/superpowers/plans/2026-04-16-react-web-conversion.md).

## 기술 스택

- **모노레포**: npm workspaces (`web`, `server`) — 루트 `package-lock.json` 하나로 의존성 고정
- **프론트엔드** (`web/`): React 18 + Vite, Zustand, Socket.IO Client, Vitest — JavaScript(JSX)
- **백엔드** (`server/`): NestJS 11, TypeORM + MySQL 8, Socket.IO, JWT(Passport), Jest — TypeScript
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk`, 번역 — 서버 전용), Google TTS API (음성 생성)
- **배포**: 웹 애플리케이션 (개발 포트 — 웹 5173, API 3001)

## 프로젝트 구조

```
wos-sfc-helper/
├── web/                      # 브라우저 UI (React 18 + Vite)
│   ├── vite.config.js        # 개발 프록시 — API_PATHS와 /socket.io를 :3001로 전달
│   ├── style.css             # 전체 스타일 (반응형 미디어쿼리 포함)
│   └── src/
│       ├── App.jsx           # 탭 전환, 테마, 소켓·인증 부트스트랩
│       ├── api/              # REST·Socket.IO 클라이언트
│       ├── store/            # Zustand 전역 상태
│       ├── hooks/ i18n/ utils/
│       └── components/
│           ├── Battle/           # 전투 탭 — 카운트다운, 랠리 타이머·그룹, 발송 계산, TTS 재생
│           ├── OperationBoard/   # 작전 보드 탭 — 실시간 협업 캔버스
│           ├── Community/        # 커뮤니티 탭 — 공지 핀보드, 연맹 공지, 게시판
│           ├── Chat/             # 채팅 탭·도크 — 실시간 채팅, 메시지 번역
│           └── AdminTab/ Auth/ Dashboard/ Layout/
├── server/                   # REST API + WebSocket 서버 (NestJS 11)
│   ├── migrations/           # 기존 DB에 적용하는 수동 SQL 패치 (초기 스키마 아님)
│   └── src/                  # 기능별 NestJS 모듈
│       ├── auth/ users/ me/ members/ admin/
│       ├── rallies/ rally-groups/         # 집결·랠리 그룹
│       ├── chat/ realtime/                # 채팅·Socket.IO 게이트웨이
│       ├── notices/ alliance-notices/ boards/ operation-boards/
│       ├── translate/ translations/      # Claude API 번역 (translate.service.ts)
│       └── tts/                          # Google TTS 생성·캐시
├── docs/superpowers/         # 설계 spec, 구현 plan
├── .github/                  # PR 템플릿, CI, 보안 자동화
├── .env.example              # 변수 이름과 기본값만 — server/.env로 복사해 사용
└── package.json              # workspace 루트 (build·test 스크립트)
```

## 개발 규칙

### 코드 스타일
- `web/`은 JavaScript(JSX) 함수 컴포넌트, `server/`는 TypeScript NestJS 모듈 구조를 따른다
- 기능은 컴포넌트 디렉토리(web)와 NestJS 모듈(server) 단위로 분리
- 주석은 한국어로 작성

### API 통신 패턴
- 웹 → 서버: REST(`web/src/api/`) + Socket.IO(채팅, 작전 보드, 접속자 표시)
- 개발 프록시: 새 API 경로를 추가하면 `web/vite.config.js`의 `API_PATHS`에도 등록할 것
- Claude API 호출은 **반드시 server의 translate 모듈에서** (API 키 보안) — 브라우저 직접 호출 금지

### 데이터 저장
- MySQL 8 + TypeORM 엔티티. 스키마는 엔티티가 정의한다
- `TYPEORM_SYNC=true`는 폐기 가능한 로컬 개발 DB 전용 — 운영 모드에서는 무시된다
- `server/migrations/`는 기존 DB 대상 수동 SQL 패치다. 빈 DB를 재현하는 초기 마이그레이션은 아직 없다

### UI / 반응형 디자인 (필수)
- **모든 UI 구현은 반드시 모바일 반응형으로 작성할 것** — 데스크톱 전용 금지
- 브레이크포인트: `768px` (모바일), `480px` (소형 모바일)
- 고정 px 너비 금지 → `min()`, `clamp()`, `%`, `vw` 사용
- 2열 이상 그리드는 `@media (max-width: 768px)` 에서 1열로 전환
- iOS Safari `100vh` 버그 대응: `height: 100dvh` 사용
- 새 컴포넌트 추가 시 Chrome DevTools 모바일 에뮬레이터(iPhone SE 375px)로 반드시 확인

### 보안
- `.env`, JWT 키, `SERVER_CODE`(가입 초대 코드), DB 자격 증명, 외부 API 키를 커밋하지 않는다
- 비밀값은 `server/.env`에만 보관. 브라우저 번들에 포함되는 `VITE_` 변수에는 절대 넣지 않는다
- HTTP·WebSocket CORS 허용 origin은 `WEB_ORIGIN`으로 제어한다 (운영 필수)

### 테스트
- 웹: Vitest — `npm --workspace web test -- --run`
- 서버: Jest — `npm --workspace server test -- --runInBand`
- 서버 e2e는 MySQL과 서버 환경변수가 필요하다 — DB 없는 CI에서는 실행되지 않는다

## 환경 설정

```powershell
# 의존성 설치 (저장소 루트에서, lockfile 기준)
npm ci

# 환경변수 준비 — 복사 후 빈 값 채우기
Copy-Item .env.example server/.env

# 개발 실행 (터미널 2개)
npm --workspace server run start:dev   # API — http://localhost:3001
npm --workspace web run dev            # 웹 UI — http://localhost:5173

# 테스트·빌드 (루트에서 두 workspace 모두)
npm test
npm run build
```

## 현재 기능 목록

| 탭 | 기능 | 상태 |
|----|------|------|
| 전투 | 카운트다운·랠리 타이머·랠리 그룹·발송 타이밍 계산·TTS 음성 안내 | 구현됨 |
| 작전 보드 | 실시간 협업 작전 캔버스 | 구현됨 |
| 커뮤니티 | 공지 핀보드·연맹 공지·게시판 | 구현됨 |
| 채팅 | 실시간 채팅·메시지 번역 (Claude API) | 구현됨 |
| 관리자 | 사용자 목록·역할·연맹 관리 | 구현됨 |

공통 — JWT 인증(가입 초대 코드 `SERVER_CODE` 필요), 다국어 i18n, 테마(frost/spring), 접속자 표시.

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
