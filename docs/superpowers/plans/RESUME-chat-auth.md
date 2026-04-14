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
- [x] Task 7: Electron main.js — auth/chat IPC 핸들러 (axios, socket.io-client)
- [x] Task 8: preload.js — auth/chat API 노출
- [x] Task 9: auth.js — 로그인/회원가입 UI
- [x] Task 10: chat.js — 실시간 채팅 UI

**마지막 커밋:** `def24cd feat: chat.js 실시간 채팅 UI`

---

## 남은 작업 (Task 11 ~ Task 13)

### Task 11: index.html 수정
파일: `src/renderer/index.html`

변경사항:
1. 기존 `<div id="alliance-modal" ...>...</div>` 블록 전체를 아래로 교체:
   ```html
   <!-- ── Auth 모달 ── -->
   <div id="auth-modal" class="auth-modal" style="display:none">
     <div id="auth-modal-box" class="auth-modal-box">
       <!-- auth.js가 동적으로 렌더링 -->
     </div>
   </div>
   ```

2. `<nav class="tab-nav">` 안 마지막 탭 버튼 뒤에 추가:
   ```html
   <button class="tab-btn" data-tab="chat">💬 채팅</button>
   ```

3. `<main class="tab-content">` 안 마지막 `</section>` 뒤에 추가:
   ```html
   <!-- ══ 채팅 ══ -->
   <section id="chat" class="tab-panel">
     <div class="chat-layout">
       <div class="chat-header">
         <h2>💬 동맹 채팅</h2>
         <span class="chat-online-badge">
           <span id="chat-online-count">0</span>명 접속 중
         </span>
       </div>
       <div id="chat-online-list" class="chat-online-list"></div>
       <div id="chat-messages" class="chat-messages">
         <p class="empty-message">채팅 탭을 열면 연결됩니다</p>
       </div>
       <div class="chat-input-area">
         <input type="text" id="chat-input" placeholder="메시지 입력... (Enter 전송)" maxlength="500" />
         <button id="chat-send-btn" class="btn btn-primary">전송</button>
       </div>
     </div>
   </section>
   ```

4. 헤더에 유저 정보 영역 추가 (auth.js가 참조):
   - `id="user-info"` 요소 (기본 display:none)
   - `id="user-nickname"`, `id="user-role-badge"` span
   - `id="logout-btn"` 버튼

5. `</body>` 바로 위에 script 태그 추가:
   ```html
   <script src="js/auth.js"></script>
   <script src="js/chat.js"></script>
   ```

6. 커밋: `git commit -m "feat: index.html auth 모달 교체 + 채팅 탭 추가"`

### Task 12: style.css 스타일 추가
파일: `src/renderer/style.css`

파일 끝에 아래 CSS 추가:

```css
/* ── Auth Modal ── */
.auth-modal {
  position: fixed; inset: 0; background: rgba(0,0,0,0.8);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.auth-modal-box {
  background: #1e1e3a; border: 1px solid #3a3a6a; border-radius: 12px;
  padding: 2rem; width: 360px; display: flex; flex-direction: column; gap: 0.75rem;
}
.auth-modal-box h2 { text-align: center; color: #e2e8f0; margin: 0 0 0.5rem; }
.auth-subtitle { text-align: center; color: #94a3b8; margin: 0; font-size: 0.9rem; }
.auth-modal-box input, .auth-modal-box select {
  padding: 0.6rem 0.8rem; border-radius: 6px; border: 1px solid #3a3a6a;
  background: #0f0f23; color: #e2e8f0; font-size: 0.9rem; width: 100%; box-sizing: border-box;
}
.auth-error { color: #f87171; font-size: 0.85rem; min-height: 1.2rem; margin: 0; }
.auth-switch { text-align: center; color: #94a3b8; font-size: 0.85rem; margin: 0; }
.auth-switch a { color: #60a5fa; text-decoration: none; }
.auth-server-question { color: #fbbf24; font-size: 0.85rem; margin: 0.25rem 0 0; font-weight: 600; }

/* ── Chat ── */
.chat-layout {
  display: flex; flex-direction: column; height: calc(100vh - 120px); gap: 0.5rem; padding: 1rem;
}
.chat-header { display: flex; align-items: center; justify-content: space-between; }
.chat-online-badge { background: #1e3a5f; color: #60a5fa; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem; }
.chat-online-list { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.chat-online-user { background: #1e3a2a; color: #4ade80; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.75rem; }
.chat-messages { flex: 1; overflow-y: auto; background: #0f0f23; border: 1px solid #2a2a4a; border-radius: 8px; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
.chat-message { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem; }
.chat-alliance { color: #94a3b8; font-size: 0.75rem; }
.chat-nickname { color: #60a5fa; font-weight: 600; font-size: 0.85rem; }
.chat-time { color: #64748b; font-size: 0.7rem; }
.chat-content { width: 100%; margin: 0; color: #e2e8f0; font-size: 0.9rem; }
.chat-system-msg { color: #94a3b8; font-size: 0.8rem; text-align: center; font-style: italic; }
.chat-input-area { display: flex; gap: 0.5rem; }
.chat-input-area input { flex: 1; padding: 0.6rem 0.8rem; border-radius: 6px; border: 1px solid #3a3a6a; background: #0f0f23; color: #e2e8f0; }
```

커밋: `git commit -m "feat: auth/chat 스타일 추가"`

### Task 13: 전체 동작 검증
1. PostgreSQL 확인 (wos_user / wos_db)
2. NestJS 기동: `cd server && npm run start:dev`
3. Electron 기동: `npm start`
4. 회원가입 → 서버코드 `2677` → 성공
5. 잘못된 서버코드 → 에러 메시지
6. 로그인 → 성공
7. 채팅 탭 → 연결 → 메시지 전송
8. 최종 커밋: `git commit -m "feat: 실시간 채팅 + 회원가입/로그인 전체 구현 완료"`

---

## ⚠️ Task 11 주의사항

index.html을 수정하기 전에 반드시 파일을 먼저 읽어라.
- 기존 `alliance-modal` ID를 가진 모달 블록의 정확한 위치 확인 필요
- auth.js가 참조하는 ID: `user-info`, `user-nickname`, `user-role-badge`, `logout-btn` — 헤더에 없을 경우 추가 필요

---

## 다음 세션 시작 방법

```bash
# 워크트리로 이동
cd C:/WOS/wos-sfc-helper/.worktrees/feature-chat-auth

# 브랜치 확인
git branch  # feature/chat-auth 이어야 함

# Task 11부터 이어서 진행
# subagent-driven-development 스킬로 Task 11 ~ 13 실행
```

## 참고

- NestJS 서버 포트: 3001
- Socket.io는 main.js에서 관리 (renderer CSP 우회)
- 기존 Firebase 기능은 그대로 유지 (공지/집결/게시판)
- 서버 코드: `2677`
