# 이어서 할 작업 — React 웹앱 전환

**브랜치**: `feature/react-web`
**최근 커밋**: feat: React+Vite 웹앱 전환 — 기반 구조 + 공통 모듈 (진행 중)

---

## ✅ 완료된 작업

### 서버 (NestJS)
- Member 엔티티에 `normalSeconds`, `petSeconds` 컬럼 추가
- `TranslateModule` 신규 생성 (`server/src/translate/`)
- `app.module.ts`: `ServeStaticModule`(`web/dist/`) + `TranslateModule` 등록
- `@nestjs/serve-static`, `@anthropic-ai/sdk` 설치

### 웹앱 (`web/`)
- Vite + React + Zustand 프로젝트 초기화
- `vite.config.js`: API 경로 → `localhost:3001` 프록시 설정
- `src/api/index.js`: fetch helper + socket.io 싱글톤 + 번역 유틸
- `src/store/index.js`: Zustand store
- `src/i18n/index.jsx`: ko/en/ja/zh UI 텍스트 + React Context
- `src/hooks/useSocket.js`: 소켓 이벤트 → store 갱신
- `App.jsx` + `main.jsx`: auth gate + 탭 라우팅
- `AuthModal.jsx`: 로그인/회원가입/devLogin
- `Header.jsx`: 세계시계(UTC), 유저 배지, 탭 내비
- `OnlineList.jsx`: 접속 중 유저 목록

---

## 🔧 남은 작업 (순서대로)

### 1. BattleTab 컴포넌트 그룹

**`web/src/components/Battle/BattleTab.jsx`**
- RallyTimer + Countdown + Dispatch를 세로로 나열하는 컨테이너

**`web/src/components/Battle/RallyTimer.jsx`**
- `store.rallies` 구독
- 200ms interval → `tickMap(Map<id, {remainMs, ratio}>)` 로컬 state
- `endTimeUTC` 기반: `Date.now() + timeOffset`
- 색상: ratio > 0.5 정상 / 0.2~0.5 warning / < 0.2 danger
- 종료: `playBeep` 3번 (api/index.js에서 import)
- 최대 6개 제한
- 참고 원본: `src/renderer/js/rally-timer.js`

**`web/src/components/Battle/Countdown.jsx`**
- `store.countdown` 구독 (`{ active, startedAt, totalSeconds }`)
- TTS: Web Speech API — `countdown.js`의 `VOICE_PREF`, `getBestVoice`, `speak` 로직 그대로
- 관리자/개발자만 제어 버튼 표시 (`user.role` 체크)
- `getSocket().emit('countdown:start', seconds)` / `'countdown:stop'`
- 참고 원본: `src/renderer/js/countdown.js`

**`web/src/components/Battle/Dispatch.jsx`**
- `store.members` 구독 (`{ id, name, normalSeconds, petSeconds }`)
- 도착 시각 입력 → 각 집결원별 발송 시각 역산
- 삭제: `api.deleteMember(member.id)` ← `id` 사용 (`firebaseId` 아님)
- 참고 원본: `src/renderer/js/dispatch.js`

---

### 2. CommunityTab 컴포넌트 그룹

**`web/src/components/Community/CommunityTab.jsx`**
- 서브탭 상태: `'notices' | 'board-KOR' | 'board-NSL' | 'board-JKY' | 'board-GPX' | 'board-UFO'`
- `<Noticeboard />` + `<Board alliance={...} />` x5 조건부 렌더

**`web/src/components/Community/Noticeboard.jsx`**
- view: `'list' | 'write' | 'detail'` (로컬 state)
- `store.notices` 구독
- 번역 3단계: 로컬캐시 → 서버캐시(`api.getTranslation`) → `api.translate`
- 소스 아이콘: discord/kakao/game
- 참고 원본: `src/renderer/js/noticeboard.js`

**`web/src/components/Community/Board.jsx`** (props: `alliance: string`)
- `useStore(s => s.boards[alliance])` 구독
- 게시물 번역 (noticeboard와 동일 패턴)
- 권한 체크: `user.role` 기반 삭제 가능 여부
- 참고 원본: `src/renderer/js/community.js`

---

### 3. ChatTab

**`web/src/components/Chat/ChatTab.jsx`**
- `messages`: 로컬 state (store 불필요)
- 마운트 시 소켓 이벤트 직접 구독:
  - `getSocket().on('chat:history', ...)` → `translateChatMessage` 일괄 적용
  - `getSocket().on('chat:message', ...)` → 번역 후 append
  - `getSocket().on('chat:system', ...)`
  - `getSocket().on('chat:online', ...)`
- 자동 스크롤: `useRef(messagesEndRef) + useEffect([messages])`
- 원문/번역 토글 (translatedContent 있을 때)
- 참고 원본: `src/renderer/js/chat.js`

---

### 4. 최종 통합 및 CSS 클래스명 점검

기존 `style.css`의 클래스명이 React 컴포넌트에서 그대로 사용됨.
빌드 후 `http://localhost:5173` 에서 시각적 확인 필요.

---

## 다음 세션 시작 방법

```
"RESUME-react-web.md 보고 이어서 작업해줘.
BattleTab(RallyTimer/Countdown/Dispatch)부터 시작해."
```

## 참고 파일 경로

- 원본 렌더러: `src/renderer/js/`
- 새 컴포넌트 위치: `web/src/components/`
- API 유틸: `web/src/api/index.js`
- Store: `web/src/store/index.js`
- i18n: `web/src/i18n/index.jsx`
