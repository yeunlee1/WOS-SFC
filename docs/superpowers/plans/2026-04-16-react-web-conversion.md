# React 웹앱 전환 — Electron → React+Vite+Zustand

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron 데스크탑 앱을 React+Vite 웹앱으로 전환한다. 기존 NestJS 서버를 그대로 사용하고, Electron 렌더러(`src/renderer/`)의 모든 기능을 `web/` 디렉터리 아래 React 컴포넌트로 재구현한다.

**Architecture:**
- 프론트엔드: React 18 + Vite + Zustand (상태) + socket.io-client (실시간)
- 백엔드: 기존 NestJS 서버 (`server/`) 재사용 — `ServeStaticModule`로 빌드된 웹앱 서빙
- 인증: JWT (`localStorage`), 소켓 auth 헤더
- 번역: 3단계 캐시 (로컬 localStorage → 서버 DB → Claude API)

**Tech Stack:** React 18, Vite, Zustand, socket.io-client, @anthropic-ai/sdk (서버), NestJS

**브랜치:** `feature/react-web` → `KRI/adoring-shannon` (현재 작업 브랜치)

---

## 파일 구조

```
web/
├── index.html
├── vite.config.js
├── package.json
└── src/
    ├── main.jsx                      ✅ 완료
    ├── App.jsx                       ✅ 완료
    ├── api/
    │   └── index.js                  ✅ 완료 (fetch helper, socket 싱글톤, 번역 유틸)
    ├── store/
    │   └── index.js                  ✅ 완료 (Zustand store)
    ├── i18n/
    │   └── index.jsx                 ✅ 완료 (ko/en/ja/zh UI 텍스트 + Context)
    ├── hooks/
    │   └── useSocket.js              ✅ 완료 (소켓 이벤트 → store 갱신)
    └── components/
        ├── Auth/
        │   └── AuthModal.jsx         ✅ 완료 (로그인/회원가입/devLogin)
        ├── Layout/
        │   └── Header.jsx            ✅ 완료 (세계시계 UTC, 유저 배지, 탭 네비)
        ├── Dashboard/
        │   └── OnlineList.jsx        ✅ 완료 (접속 중 유저 목록)
        ├── Battle/
        │   ├── BattleTab.jsx         ✅ 완료 (컨테이너)
        │   ├── RallyTimer.jsx        ✅ 완료 (200ms interval, 비프음, 최대 6개)
        │   ├── Countdown.jsx         ✅ 완료 (공유 카운트다운, Web Speech TTS)
        │   └── Dispatch.jsx          ✅ 완료 (도착 시각 역산, members store 구독)
        ├── Community/
        │   ├── CommunityTab.jsx      ✅ 완료 (서브탭 네비)
        │   ├── Noticeboard.jsx       ✅ 완료 (list/write/detail, 3단계 번역)
        │   └── Board.jsx             ✅ 완료 (연맹 게시판, 병렬 비동기 번역)
        └── Chat/
            └── ChatTab.jsx           ⬜ 미완료
```

---

## 서버 변경사항

| 파일 | 내용 | 상태 |
|------|------|------|
| `server/src/members/member.entity.ts` | `normalSeconds`, `petSeconds` 컬럼 추가 | ✅ 완료 |
| `server/src/translate/` | TranslateModule 신규 생성 | ✅ 완료 |
| `server/src/app.module.ts` | `ServeStaticModule(web/dist/)` + `TranslateModule` 등록 | ✅ 완료 |

---

## Task 1: 프로젝트 기반 구조

- [x] Vite + React + Zustand 프로젝트 초기화 (`web/`)
- [x] `vite.config.js`: API 경로 → `localhost:3001` 프록시
- [x] `web/src/api/index.js`: fetch helper + socket.io 싱글톤 + 번역 유틸
- [x] `web/src/store/index.js`: Zustand store (user, token, timeOffset, notices, rallies, members, onlineUsers, boards, countdown)
- [x] `web/src/i18n/index.jsx`: ko/en/ja/zh UI 텍스트 + React Context + 번역 캐시
- [x] `web/src/hooks/useSocket.js`: 소켓 이벤트 → store 갱신
- [x] `web/src/App.jsx`: auth gate + 탭 라우팅
- [x] `web/src/main.jsx`: ReactDOM.render + I18nProvider

---

## Task 2: 공통 레이아웃 컴포넌트

- [x] `AuthModal.jsx` — 로그인 / 회원가입 / devLogin 폼
- [x] `Header.jsx` — 세계시계(UTC), 유저 배지(role/alliance), 탭 네비게이션
- [x] `OnlineList.jsx` — `store.onlineUsers` 구독, 접속 중 유저 목록

---

## Task 3: BattleTab 컴포넌트 그룹

**참고 원본:** `src/renderer/js/rally-timer.js`, `countdown.js`, `dispatch.js`

- [x] `Battle/BattleTab.jsx` — RallyTimer + Countdown + Dispatch 세로 배치 컨테이너
- [x] `Battle/RallyTimer.jsx`
  - [x] `store.rallies` 구독
  - [x] 200ms interval → `tickMap(Map<id, {remainMs, ratio}>)` 로컬 state
  - [x] `endTimeUTC` 기반: `Date.now() + timeOffset`
  - [x] 색상: ratio > 0.5 정상 / 0.2~0.5 warning / < 0.2 danger
  - [x] 종료: `playBeep` 3번 (`api/index.js` import)
  - [x] 최대 6개 제한
- [x] `Battle/Countdown.jsx`
  - [x] `store.countdown` 구독 (`{ active, startedAt, totalSeconds }`)
  - [x] TTS: Web Speech API — `VOICE_PREF`, `getBestVoice`, `speak` 로직
  - [x] 관리자/개발자만 제어 버튼 표시 (`user.role` 체크)
  - [x] `getSocket().emit('countdown:start', seconds)` / `'countdown:stop'`
- [x] `Battle/Dispatch.jsx`
  - [x] `store.members` 구독 (`{ id, name, normalSeconds, petSeconds }`)
  - [x] 도착 시각 입력 → 각 집결원별 발송 시각 역산
  - [x] 삭제: `api.deleteMember(member.id)`

---

## Task 4: CommunityTab 컴포넌트 그룹

**참고 원본:** `src/renderer/js/noticeboard.js`, `community.js`

- [x] `Community/CommunityTab.jsx`
  - [x] 서브탭 상태: `'notices' | 'board-KOR' | 'board-NSL' | 'board-JKY' | 'board-GPX' | 'board-UFO'`
  - [x] `<Noticeboard />` + `<Board alliance={...} />` x5 조건부 렌더
- [x] `Community/Noticeboard.jsx`
  - [x] view: `'list' | 'write' | 'detail'` 로컬 state
  - [x] `store.notices` 구독
  - [x] 번역 3단계: 로컬 캐시 → `api.getTranslation` → `api.translate`
  - [x] 소스 아이콘: discord/kakao/game
  - [x] 관리자만 삭제 버튼 표시
- [x] `Community/Board.jsx`
  - [x] `useStore(s => s.boards[alliance])` 구독
  - [x] 게시물 번역 (noticeboard와 동일 패턴)
  - [x] 권한 체크: 본인 또는 admin/developer만 삭제 가능
  - [x] Ctrl+Enter 게시 단축키

---

## Task 5: ChatTab 컴포넌트

**참고 원본:** `src/renderer/js/chat.js`

- [ ] `Chat/ChatTab.jsx` 생성
  - [ ] `messages`: 로컬 state (store 불필요)
  - [ ] 마운트 시 소켓 이벤트 직접 구독:
    - [ ] `getSocket().on('chat:history', ...)` → `translateChatMessage` 일괄 적용
    - [ ] `getSocket().on('chat:message', ...)` → 번역 후 append
    - [ ] `getSocket().on('chat:system', ...)`
    - [ ] `getSocket().on('chat:online', ...)`
  - [ ] 자동 스크롤: `useRef(messagesEndRef) + useEffect([messages])`
  - [ ] 원문/번역 토글 (translatedContent 있을 때)
  - [ ] 언마운트 시 소켓 이벤트 리스너 정리 (`socket.off(...)`)

---

## Task 6: 최종 통합 및 검증

- [ ] CSS 클래스명 점검 — 기존 `style.css` 클래스가 React 컴포넌트에서 그대로 사용됨
  - [ ] `section`, `section-title`, `section-desc`
  - [ ] `rally-card`, `rally-countdown`, `rally-progress-bar`
  - [ ] `countdown-number`, `countdown-danger`, `countdown-warning`
  - [ ] `member-card`, `member-dispatch-time`
  - [ ] `notice-row`, `notice-detail-*`, `notice-badge`
  - [ ] `board-post-card`, `board-post-*`
  - [ ] `sub-tab-nav`, `sub-tab-btn`
  - [ ] `input-row`, `input-col`, `input-label`, `input-short`
- [ ] `npm run build` (web/) — 빌드 성공 확인
- [ ] `http://localhost:5173` 시각적 확인
  - [ ] 로그인/회원가입 동작
  - [ ] 집결 타이머 실시간 동기화
  - [ ] 카운트다운 TTS 재생
  - [ ] 발송 타이밍 계산
  - [ ] 공지 핀보드 등록/삭제/번역
  - [ ] 연맹 게시판 게시/번역
  - [ ] 채팅 실시간 송수신

---

## 진행 현황

| 단계 | 항목 | 상태 |
|------|------|------|
| Task 1 | 기반 구조 | ✅ 완료 |
| Task 2 | 공통 레이아웃 | ✅ 완료 |
| Task 3 | BattleTab 그룹 | ✅ 완료 |
| Task 4 | CommunityTab 그룹 | ✅ 완료 |
| Task 5 | ChatTab | ⬜ 미완료 |
| Task 6 | 최종 통합/검증 | ⬜ 미완료 |

**전체 진행률: 4/6 Tasks 완료 (약 67%)**

---

## 다음 세션 시작 방법

```
"RESUME-react-web.md 보고 이어서 작업해줘. ChatTab부터 시작해."
```

또는 이 파일을 직접 참조:
```
"2026-04-16-react-web-conversion.md 계획서 보고 남은 작업 이어해줘."
```

## 참고 파일 경로

| 용도 | 경로 |
|------|------|
| 원본 렌더러 JS | `src/renderer/js/` |
| 새 컴포넌트 위치 | `web/src/components/` |
| API 유틸 | `web/src/api/index.js` |
| Store | `web/src/store/index.js` |
| i18n | `web/src/i18n/index.jsx` |
| 소켓 훅 | `web/src/hooks/useSocket.js` |
| 스타일 | `src/renderer/style.css` |
