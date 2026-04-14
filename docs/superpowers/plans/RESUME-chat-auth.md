# 이어서 할 작업 — 실시간 채팅 + 회원가입/로그인

**브랜치**: `feature/chat-auth`
**워크트리**: `C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth`
**전체 계획**: `docs/superpowers/plans/2026-04-14-realtime-chat-auth.md`

---

## 🎉 코드 구현 전체 완료

모든 Task 1~13 구현 완료 + MySQL 전환 완료. 마지막 커밋: `31b7090 chore: PostgreSQL → MySQL 전환`

### 완료된 작업 전체 목록

- [x] Task 1: NestJS 프로젝트 초기화
- [x] Task 2: User 엔티티 + TypeORM 설정
- [x] Task 3: Message 엔티티
- [x] Task 4: Users 모듈 + 서비스
- [x] Task 5: Auth 모듈 — 회원가입/로그인 API (서버코드 '2677', JWT 7일)
- [x] Task 6: Chat 모듈 — Socket.io 게이트웨이 (JWT 인증, 7일 히스토리)
- [x] Task 7: main.js — auth/chat IPC 핸들러 (axios, socket.io-client)
- [x] Task 8: preload.js — auth/chat IPC 브릿지
- [x] Task 9: auth.js — 로그인/회원가입 UI
- [x] Task 10: chat.js — 실시간 채팅 UI
- [x] Task 11: index.html — auth 모달 교체 + 채팅 탭 추가
- [x] Task 12: style.css — auth/chat 스타일 추가
- [x] Task 13: 정적 검증 (tsc --noEmit PASS, 파일 구조 PASS)

---

## 남은 작업: 런타임 검증 + 머지

### Step 1: MySQL 준비

```bash
# MySQL에서 실행
mysql -u root -p
CREATE USER 'wos_user'@'localhost' IDENTIFIED BY 'wos_pass';
CREATE DATABASE wos_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON wos_db.* TO 'wos_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

`server/.env` 현재 설정:
```
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USER=wos_user
DATABASE_PASSWORD=wos_pass
DATABASE_NAME=wos_db
JWT_SECRET=wos_jwt_secret_change_in_production
PORT=3001
```

### Step 2: NestJS 서버 기동

```bash
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth/server
npm run start:dev
```

Expected: `Server running on port 3001`, `WebSocket Gateway initialized`

### Step 3: Electron 앱 기동

```bash
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth
npm start
```

Expected: Auth 모달이 먼저 표시됨 (기존 Firebase 모달 대신)

### Step 4: 기능 검증

1. **회원가입**: 모든 항목 입력 → "서버가 어디입니까?" → `2677` → 가입하기
   - Expected: 앱 본체 표시, 헤더에 닉네임/역할
2. **잘못된 서버코드**: `1234` → Expected: 에러 메시지
3. **로그인**: 닉네임 + 비밀번호 → Expected: 성공
4. **채팅**: 채팅 탭 클릭 → 연결 → 메시지 입력/전송

### Step 5: 머지 (검증 통과 후)

`superpowers:finishing-a-development-branch` 스킬 사용하여 PR 생성 또는 master 머지.

---

## 다음 세션 시작 방법

```bash
# 워크트리로 이동
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth

# MySQL 기동 후
cd server && npm run start:dev

# 별도 터미널에서
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth
npm start
```

## 참고

- NestJS 서버 포트: 3001
- 서버 코드: `2677`
- 기존 Firebase 기능(공지/집결/게시판) 그대로 유지
- `finishing-a-development-branch` 스킬로 PR/머지 진행
