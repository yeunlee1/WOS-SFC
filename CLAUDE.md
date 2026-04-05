# WOS SFC 전투 보조 — CLAUDE.md

## 프로젝트 개요

**WOS(Whiteout Survival) SFC 보조 데스크탑 앱**

동맹 SFC(참모총장) 역할 수행을 보조하는 Electron 데스크탑 앱.
집결 타이머, 발송 타이밍 계산, 공지 핀보드, 번역기 기능 제공.

## bkit Level: Dynamic

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
├── docs/                # PDCA 문서
│   ├── 01-plan/
│   ├── 02-design/
│   ├── 03-analysis/
│   └── 04-report/
├── .bkit/               # bkit 상태 관리
│   ├── state/
│   ├── runtime/
│   └── snapshots/
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
- 현재: 메모리(세션 중만 유지) + localStorage 없음
- 개선 시: Electron `store` 또는 localStorage 활용 가능

### 보안
- `contextIsolation: true`, `nodeIntegration: false` 유지
- API 키는 `.env`에만 보관, 렌더러에 절대 노출 금지
- `.env`는 `.gitignore`에 반드시 포함

## PDCA 워크플로우

새 기능 개발 시:
1. `/pdca plan {기능명}` — 계획 문서 작성
2. `/pdca design {기능명}` — 설계 문서 작성
3. 구현 후 `/pdca analyze {기능명}` — 갭 분석
4. 갭 90%+ → `/pdca report {기능명}` — 완료 보고서

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
