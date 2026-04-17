# WOS SFC 전투 보조 — CLAUDE.md

> 📁 상세 구조 및 기능-파일 매핑: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참조

## 프로젝트 개요

**WOS(Whiteout Survival) SFC 보조 데스크탑 앱**

동맹 SFC(참모총장) 역할 수행을 보조하는 Electron 데스크탑 앱.
집결 타이머, 발송 타이밍 계산, 공지 핀보드, 번역기 기능 제공.

## 기술 스택

- **프레임워크**: Electron 34+
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk`)
- **언어**: JavaScript (Vanilla JS + HTML/CSS)
- **배포**: 로컬 데스크탑 앱

## 프로젝트 구조

```
wos-sfc-helper/
├── src/
│   ├── main.js          # Electron 메인 프로세스 (IPC 핸들러, Claude API 호출)
│   ├── preload.js       # 메인↔렌더러 브릿지 (contextBridge)
│   └── renderer/
│       ├── index.html   # 앱 UI
│       ├── style.css    # 전체 스타일
│       └── js/
│           ├── app.js          # 공통 유틸리티, 탭 전환
│           ├── rally-timer.js  # 탭1: 집결 타이머
│           ├── dispatch.js     # 탭2: 발송 타이밍 계산기
│           ├── noticeboard.js  # 탭3: 공지 핀보드
│           └── translator.js   # 탭4: 번역기 (Claude API 사용)
├── .env                 # ANTHROPIC_API_KEY (gitignore 필수!)
└── package.json
```

## 개발 규칙

### 코드 스타일
- Vanilla JS 사용 (빌드 도구 없음, 번들러 없음)
- 각 탭 기능은 독립적인 JS 파일로 분리
- 공통 유틸리티는 `app.js`에 전역 함수로 정의
- 주석은 한국어로 작성

### IPC 통신 패턴
- 렌더러 → 메인: `window.electronAPI.xxx()` (preload.js 경유)
- 메인 → 렌더러: `ipcMain.handle()` + `ipcRenderer.invoke()`
- Claude API 호출은 **반드시 main.js에서** (API 키 보안)

### 데이터 저장
- 현재: 메모리(세션 중만 유지)
- 개선 시: Electron `store` 또는 localStorage 활용 가능

### UI / 반응형 디자인 (필수)
- **모든 UI 구현은 반드시 모바일 반응형으로 작성할 것** — 데스크톱 전용 금지
- 브레이크포인트: `768px` (모바일), `480px` (소형 모바일)
- 고정 px 너비 금지 → `min()`, `clamp()`, `%`, `vw` 사용
- 2열 이상 그리드는 `@media (max-width: 768px)` 에서 1열로 전환
- iOS Safari `100vh` 버그 대응: `height: 100dvh` 사용
- 새 컴포넌트 추가 시 Chrome DevTools 모바일 에뮬레이터(iPhone SE 375px)로 반드시 확인

### 보안
- `contextIsolation: true`, `nodeIntegration: false` 유지
- API 키는 `.env`에만 보관, 렌더러에 절대 노출 금지
- `.env`는 `.gitignore`에 반드시 포함

## 환경 설정

```bash
# 실행
npm start

# 개발 모드 (inspect 포함)
npm run dev
```

## 현재 기능 목록

| 탭 | 기능 | 상태 |
|----|------|------|
| 집결 타이머 | 최대 6개 카운트다운 타이머 | 구현됨 |
| 발송 타이밍 | 상대 도착시각 기반 발송시각 계산 | 구현됨 |
| 공지 핀보드 | 디스코드/카톡/게임 공지 고정 | 구현됨 |
| 번역기 | Claude AI 한국어 번역 | 구현됨 |

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
