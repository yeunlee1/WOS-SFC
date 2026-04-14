# 이어서 할 작업 — 실시간 채팅 + 회원가입/로그인

**브랜치**: `feature/chat-auth`
**워크트리**: `C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth`
**전체 계획**: `docs/superpowers/plans/2026-04-14-realtime-chat-auth.md`

---

## 완료된 작업

- [x] Task 1: NestJS 프로젝트 초기화 (`server/` 디렉토리)
- [x] Task 2: User 엔티티 + TypeORM forRootAsync 설정
- [x] Task 3: Message 엔티티
- [x] Task 4: Users 모듈 + 서비스 (bcrypt, 중복 닉네임 검사, 유닛 테스트)
- [x] Task 5: Auth 모듈 — 회원가입/로그인 API (서버코드 '2677' 검증, JWT 7일)
- [x] Task 6: Chat 모듈 — Socket.io 게이트웨이 (JWT 인증, 7일 히스토리)

**마지막 커밋:** `298653d feat: Socket.io 채팅 게이트웨이 (JWT 인증, 7일 기록)`

---

## 남은 작업 (Task 7 ~ Task 13)

### Task 7: Electron main.js — auth/chat IPC 핸들러
파일:
- `src/main.js`

핵심 로직:
- `npm install axios socket.io-client` (wos-sfc-helper 루트에서)
- `let mainWindow;` 아래에 axios, io, SERVER_URL, authToken, currentUser, chatSocket 변수 추가
- `auth-signup` IPC: axios.post → SERVER_URL/auth/signup, authToken/currentUser 저장
- `auth-login` IPC: axios.post → SERVER_URL/auth/login, authToken/currentUser 저장
- `auth-logout` IPC: chatSocket?.disconnect(), authToken=null, currentUser=null
- `chat-connect` IPC: io(SERVER_URL, {auth:{token}}) 연결, chat:history/message/system/online → mainWindow.webContents.send
- `chat-send` IPC: chatSocket.emit('chat:message', content)

### Task 8: preload.js — auth/chat API 노출
파일:
- `src/preload.js`

추가할 항목:
- `signup`, `login`, `logout`
- `chatConnect`, `chatSend`
- `onChatHistory`, `onChatMessage`, `onChatSystem`, `onChatOnline`

### Task 9: renderer — auth.js
파일:
- `src/renderer/js/auth.js` (신규)

핵심 UI:
- 로그인 폼 / 회원가입 폼 동적 렌더링
- 회원가입: 닉네임, 비밀번호, 동맹명, 역할, 생년월일, 언어, 이름, "서버가 어디입니까?" 입력 (serverCode)
- 로그인 성공 시 `hideAuthModal()` + 헤더에 유저 정보 표시

### Task 10: renderer — chat.js
파일:
- `src/renderer/js/chat.js` (신규)

핵심 UI:
- 채팅 탭 클릭 시 `chatConnect()` 초기화
- `onChatHistory`, `onChatMessage`, `onChatSystem`, `onChatOnline` 이벤트 바인딩
- 메시지 전송 (Enter / 버튼)
- XSS 방지: `escapeHtml()` 사용

### Task 11: index.html 수정
파일:
- `src/renderer/index.html`

변경사항:
- 기존 `<div id="alliance-modal">` 블록 전체 → `<div id="auth-modal">` 교체
- `<nav class="tab-nav">`에 `<button data-tab="chat">💬 채팅</button>` 추가
- `<section id="chat" class="tab-panel">` 패널 추가 (chat-messages, chat-input, chat-online-list 등)
- `</body>` 전 `<script src="js/auth.js">`, `<script src="js/chat.js">` 추가

### Task 12: style.css 스타일
파일:
- `src/renderer/style.css`

추가할 스타일:
- `.auth-modal`, `.auth-modal-box`, `.auth-error`, `.auth-server-question`
- `.chat-layout`, `.chat-messages`, `.chat-message`, `.chat-input-area`, `.chat-online-list`

### Task 13: 전체 동작 검증
1. PostgreSQL DB 생성 (`wos_user`, `wos_db`) — 이미 생성된 경우 스킵
2. NestJS 서버 기동: `cd server && npm run start:dev`
3. Electron 앱 기동: `npm start`
4. 회원가입 → 서버코드 2677 → 성공
5. 잘못된 서버코드 → 에러
6. 로그인 → 성공
7. 채팅탭 → 연결 → 메시지 전송

---

## 다음 세션 시작 방법

```bash
# 워크트리로 이동
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth

# 브랜치 확인
git branch  # feature/chat-auth 이어야 함

# Task 7부터 이어서 진행
# subagent-driven-development 스킬로 Task 7 ~ 13 실행
```

## 참고

- NestJS 서버 포트: 3001
- Socket.io는 main.js에서 관리 (renderer CSP 우회)
- 기존 Firebase 기능은 그대로 유지 (공지/집결/게시판)
- 서버 코드: `2677`
- axios + socket.io-client는 아직 미설치 — Task 7 시작 시 설치 필요
