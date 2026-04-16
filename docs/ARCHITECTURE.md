# WOS SFC Helper — 아키텍처 & 기능-파일 매핑

## 기술 스택

- **Electron 34+** — 데스크탑 앱 프레임워크
- **Vanilla JS** — 렌더러 프로세스 (빌드 도구 없음)
- **NestJS** — 백엔드 서버 (`server/`)
- **MySQL** — 데이터베이스 (TypeORM)
- **Socket.io** — 실시간 통신
- **Claude API** — 자동 번역 (claude-haiku)

---

## 프로젝트 구조

```
wos-sfc-helper/
├── src/
│   ├── main.js         # IPC 핸들러 전체, Claude API 호출, 소켓 이벤트 중계
│   ├── preload.js      # electronAPI 노출 (렌더러-메인 브릿지)
│   └── renderer/
│       ├── index.html  # 전체 UI (탭 4개)
│       ├── style.css
│       └── js/
│           ├── i18n.js         # 다국어(ko/en/ja/zh), t(), 번역 캐시
│           ├── app.js          # 공통 유틸, 탭 전환, formatTime, playBeep
│           ├── auth.js         # 로그인/회원가입 UI, initAppWithUser
│           ├── rally-timer.js  # 집결 타이머 6개, 카드 렌더링
│           ├── countdown.js    # 공유 카운트다운 (음성 TTS, 언어별 음성 선택)
│           ├── dispatch.js     # 발송 타이밍 계산기
│           ├── noticeboard.js  # 공지 핀보드 + 자동번역
│           ├── community.js    # 5개 연맹 게시판 + 자동번역
│           ├── chat.js         # 실시간 채팅
│           ├── online.js       # 접속자 목록
│           └── translator.js   # 수동 번역기 (Claude AI)
└── server/src/
    ├── auth/           # JWT 발급, 회원가입/로그인
    ├── users/          # User 엔티티, 역할 관리
    ├── chat/           # 채팅 메시지 저장, ChatGateway
    ├── notices/        # 공지 DB, 브로드캐스트
    ├── rallies/        # 집결 DB, 브로드캐스트
    ├── members/        # 집결원 DB, 브로드캐스트
    ├── boards/         # 연맹 게시판 DB, 브로드캐스트
    ├── translations/   # 번역 캐시 DB
    └── realtime/       # Socket.io 게이트웨이 (카운트다운, 온라인)
```

---

## 기능 → 파일 매핑

| 기능 | 렌더러 파일 | 서버 폴더 |
|------|------------|----------|
| 로그인 / 회원가입 | `auth.js` | `auth/` |
| 공유 카운트다운 (음성 TTS) | `countdown.js` | `realtime/` |
| 집결 타이머 (최대 6개) | `rally-timer.js` | `rallies/` |
| 발송 타이밍 계산 | `dispatch.js` | `members/` |
| 공지 핀보드 | `noticeboard.js` | `notices/` |
| 연맹 게시판 (5개) | `community.js` | `boards/` |
| 실시간 채팅 | `chat.js` | `chat/` |
| 접속자 목록 | `online.js` | `realtime/` |
| 다국어 UI | `i18n.js` | — |
| 수동 번역기 | `translator.js` | `translations/` |
| 공통 유틸 / 탭 전환 | `app.js` | — |
| IPC 전체 중개 | `main.js` | — |

---

## 데이터 흐름

### 렌더러 → 서버
```
렌더러 → window.electronAPI.xxx()
       → preload.js (contextBridge)
       → main.js IPC 핸들러
       → NestJS REST API / Socket.io
```

### 서버 → 렌더러 (실시간)
```
NestJS 서비스 → RealtimeGateway.broadcastXxx()
              → Socket.io 브로드캐스트
              → main.js 소켓 이벤트 수신
              → mainWindow.webContents.send()
              → 렌더러 onXxxUpdated 콜백
```

### 번역 캐시 3단계
```
1. localStorage (로컬 캐시)
2. server/translations/ (공유 DB 캐시)
3. Claude API 호출 → 1, 2에 저장
```

---

## 주요 전역 변수 (렌더러)

| 변수 | 위치 | 설명 |
|------|------|------|
| `window.currentUser` | `auth.js` | 로그인 유저 정보 (nickname, role, language 등) |
| `window.timeOffset` | `app.js` | 서버-로컬 시간 오프셋 (ms) |
| `window.electronAPI` | `preload.js` | IPC 메서드 모음 |

---

## 역할 권한

| 역할 | 권한 |
|------|------|
| `developer` | 모든 기능 (카운트다운 시작/정지 포함) |
| `admin` | 카운트다운 시작/정지, 게시물/공지 삭제 |
| `member` | 읽기 + 본인 게시물 삭제 |
