# 이어서 할 작업 — Firebase → NestJS+MySQL 통합 리팩토링

**브랜치**: `feature/chat-auth`
**워크트리**: `C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth`
**전체 계획**: `docs/superpowers/plans/2026-04-14-firebase-to-nestjs.md`

---

## 완료된 작업

- [x] 계획 수립: `2026-04-14-firebase-to-nestjs.md`
- [x] Task 1: Notice 모듈 생성 (`server/src/notices/`) — 커밋: `fbbd216`

---

## 남은 작업 (순서대로 실행)

### Task 2: Rally 모듈 (NestJS)
**파일 생성**: `server/src/rallies/`
- `rally.entity.ts`, `rallies.service.ts`, `rallies.controller.ts`, `rallies.module.ts`
- 계획 파일의 Task 2 섹션 그대로 구현

### Task 3: Member 모듈 (NestJS)
**파일 생성**: `server/src/members/`
- `member.entity.ts`, `members.service.ts`, `members.controller.ts`, `members.module.ts`

### Task 4: Board 모듈 (NestJS)
**파일 생성**: `server/src/boards/`
- `board-post.entity.ts`, `boards.service.ts`, `boards.controller.ts`, `boards.module.ts`

### Task 5: Translation 모듈 (NestJS)
**파일 생성**: `server/src/translations/`
- `translation.entity.ts`, `translations.service.ts`, `translations.controller.ts`, `translations.module.ts`

### Task 6: RealtimeGateway (중요 — 위 모듈들이 여기에 의존)
**파일 생성**: `server/src/realtime/`
- `realtime.gateway.ts`, `realtime.module.ts`
- 온라인 presence, 소켓 접속 시 초기 데이터 전송, 브로드캐스트 담당

### Task 7: AppModule + AppController 업데이트
- `app.module.ts`: 새 엔티티(Notice, Rally, Member, BoardPost, Translation) + 새 모듈 등록
- `app.controller.ts`: GET /time 엔드포인트 추가

### Task 8: UsersController 역할 관리
- `users.service.ts`: `findByNickname`, `setRole` 메서드 추가
- `users.controller.ts`: GET/PATCH `/users/:nickname/role` 생성
- `users.module.ts`: controller 등록

### Task 9-10: main.js + preload.js (Electron)
- `main.js`: Firebase 코드 전체 삭제, REST+Socket.io IPC로 교체
- `preload.js`: contextBridge 업데이트 (firebase → api 채널명)

### Task 11-14: 렌더러 JS 업데이트
- `auth.js`: `connectAlliance('2677')` → `connectAlliance()` + `socketConnect()` 추가
- `noticeboard.js`: `firebaseId` → `id` 전체 교체
- `rally-timer.js`: `firebaseId` → `id` 전체 교체
- `community.js`: `firebaseId` → `id` + `deleteBoardPost(alliance, id)` → `deleteBoardPost(id)`

### Task 15-16: Firebase 제거 + 검증
- `npm uninstall firebase` (워크트리 루트)
- `.env` Firebase 변수 제거
- `cd server && npx tsc --noEmit` — 에러 0개 확인

---

## 다음 세션 시작 방법

```
"이어서 작업해줘. 계획 파일은 docs/superpowers/plans/2026-04-14-firebase-to-nestjs.md 이고
RESUME 파일은 docs/superpowers/plans/RESUME-firebase-to-nestjs.md 야.
Task 2부터 subagent-driven-development 스킬로 순서대로 진행해줘."
```

## 참고

- 계획 파일에 각 Task별 전체 코드 포함됨
- subagent-driven-development 스킬 사용하여 Task별 subagent 디스패치
- 90% 토큰 도달 시: push + 이 파일 업데이트
