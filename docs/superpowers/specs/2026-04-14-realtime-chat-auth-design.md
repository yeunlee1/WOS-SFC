# 실시간 채팅 + 회원가입/로그인 설계 문서

**날짜**: 2026-04-14
**프로젝트**: WOS SFC 전투 보조 앱

---

## 개요

동맹원들끼리 실시간 채팅이 가능하도록 회원가입/로그인 시스템과 채팅 기능을 추가한다.
백엔드는 Node.js + Express + PostgreSQL, 실시간 통신은 Socket.io를 사용한다.

---

## 전체 아키텍처

```
Electron 앱 (프론트엔드)
    ↕ REST API (로그인/회원가입)
    ↕ Socket.io (실시간 채팅)
Node.js + Express 백엔드
    ↕
PostgreSQL DB
```

---

## 데이터베이스 스키마

### users 테이블

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 고유 ID |
| nickname | VARCHAR(50) UNIQUE NOT NULL | 닉네임 |
| password_hash | VARCHAR(255) NOT NULL | bcrypt 해시 |
| alliance_name | VARCHAR(100) NOT NULL | 동맹명 |
| role | ENUM('admin', 'member', 'developer') NOT NULL | 역할 |
| birth_date | DATE NOT NULL | 생년월일 |
| name | VARCHAR(100) NOT NULL | 이름 |
| language | VARCHAR(20) NOT NULL | 사용 언어 |
| created_at | TIMESTAMP DEFAULT NOW() | 가입일 |

### messages 테이블

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 고유 ID |
| user_id | INTEGER REFERENCES users(id) | 발신자 |
| content | TEXT NOT NULL | 메시지 내용 |
| created_at | TIMESTAMP DEFAULT NOW() | 발송 시각 |

- 7일 지난 메시지는 자동 삭제 (cron job 또는 조회 시 필터링)

---

## 회원가입 흐름

1. 사용자가 아래 필드 입력:
   - 닉네임, 비밀번호, 동맹명, 역할, 생년월일, 이름, 언어
2. "서버가 어디입니까?" 질문 표시
3. 입력값이 `2677`이 아니면 → 가입 차단 (에러 메시지)
4. 정답이면 → DB 저장 (비밀번호 bcrypt 해시)
5. 가입 완료 → 자동 로그인

---

## 로그인 흐름

1. 닉네임 + 비밀번호 입력
2. 백엔드에서 bcrypt 검증
3. JWT 토큰 발급 → Electron 앱 로컬 저장
4. 이후 모든 API 요청 시 JWT 헤더 포함

---

## 채팅 기능

- 로그인한 사용자만 채팅탭 접근 가능
- Socket.io 연결 시 JWT로 인증
- 기능:
  - 실시간 메시지 송수신 (전체 동맹 단체방)
  - 접속 중인 동맹원 목록 표시
  - 7일치 이전 채팅 기록 로드
  - 입장/퇴장 알림

---

## 백엔드 구조

```
server/
├── index.js           # Express + Socket.io 서버 진입점
├── db.js              # PostgreSQL 연결
├── routes/
│   ├── auth.js        # POST /signup, POST /login
│   └── messages.js    # GET /messages (기록 조회)
├── middleware/
│   └── auth.js        # JWT 검증 미들웨어
└── socket/
    └── chat.js        # Socket.io 이벤트 핸들러
```

---

## 프론트엔드 변경사항 (Electron renderer)

- 앱 시작 시 로그인 화면 먼저 표시
- 로그인 성공 후 기존 탭(타이머, 발송, 공지, 번역) + 채팅탭 표시
- 새 파일 추가:
  - `renderer/js/auth.js` — 로그인/회원가입 UI 로직
  - `renderer/js/chat.js` — 채팅 UI + Socket.io 클라이언트

---

## 보안

- 비밀번호: bcrypt (salt rounds 12)
- 세션: JWT (만료 7일)
- 서버 접근 제한: "서버가 어디입니까?" → `2677` 코드 검증
- Socket.io 연결 시 JWT 필수

---

## 언어 지원 목록 (선택지)

- 한국어, 영어, 일본어, 중국어, 러시아어, 기타
