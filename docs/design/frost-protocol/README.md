# FROST PROTOCOL — 디자인 레퍼런스

이 폴더는 클로드 디자인(Claude.ai)이 생성한 WOS SFC 프로젝트의 새 UI/UX 시안 원본을 보관한다.
현재 진행 중인 통합 작업의 **시각 레퍼런스 + 코드 원본** 역할.

---

## 🚨 UI/UX 디자인 작업 시 절대 규칙 (사용자 명시)

**이 프로젝트의 UI/UX·테마·시각 디자인 변경 작업을 할 때는 반드시 다음 두 가지를 참조해야 한다:**

1. **[reference/](reference/) 의 클로드 디자인 코드 9개** — JSX/CSS 원본
2. **[screenshots/](screenshots/) 의 스크린샷 5장** — 의도된 최종 시각

코드만 보고 작업하지 말 것 — 스크린샷이 의도된 픽셀-레벨 외관을 보여준다. 코드와 스크린샷이 서로 다르게 해석될 여지가 있을 때는 **스크린샷이 진실의 원천**이다.

이 규칙은 Phase 2 이후의 모든 시각 작업(Layout shell / AuthModal / Community / Chat / Admin / Battle Countdown / Spring 리팩토링)에 적용된다.

---

> **중요:** 이 파일들은 단독 React 프로토타입(CDN React + `window.WOS.*` 글로벌 패턴)으로,
> 우리 실제 스택(React+Vite+zustand+Socket.IO+NestJS) 에 직접 import 할 수 없다.
> **시각 디자인의 *레퍼런스*로만** 사용하고, 코드 자체는 우리 컴포넌트 구조에 맞게 이식한다.

## 통합 플랜

전체 통합 플랜: `C:\Users\admin\.claude\plans\expressive-greeting-cascade.md`

## Phase별 참조 매핑

| Phase | 참조 파일 | 추출할 부분 |
|-------|-----------|-------------|
| **Phase 1 — 테마 토큰** | [app.css](reference/app.css) | `:root`의 색 토큰 (line 6-44), Petals 숨김 셀렉터 |
| **Phase 2 — Layout Shell** | [app.jsx](reference/app.jsx), [app.css](reference/app.css) | `RailLogo`/Icon Rail (line 300-345), `CommandPalette` (17-105), `UserPopover` (108-137), `.console`/`.rail`/`.canvas`/`.topbar` 스타일 (84-326) |
| **Phase 3 — AuthModal** | [auth.jsx](reference/auth.jsx), [app.css](reference/app.css) | `AuthModal` 전체 구조, `.auth-modal-wrap`/`.auth-modal`/`.auth-tabs`/`.auth-field`/`.auth-dev`/`.dev-grid`/`.dev-btn` (1006-1130) |
| **Phase 4 — Community** | [community.jsx](reference/community.jsx), [app.css](reference/app.css) | `CommunityTab` 구조, `.sub-tab-btn`/`.post-*`/`.compose-card` (1132-1208) |
| **Phase 5 — Chat + Dock** | [chat.jsx](reference/chat.jsx) | `ChatTab` (full-page) + `ChatDock` (우측 슬라이드) 분리 패턴 |
| **Phase 6 — Admin** | [admin.jsx](reference/admin.jsx), [app.css](reference/app.css) | `AdminTab` 구조, `.admin-tab`/`.admin-table`/`.admin-card-list`/`.role-badge` (1211-1281) |
| **Phase 7 — Battle Countdown** | [battle.jsx](reference/battle.jsx), [app.css](reference/app.css) | **`.cd-hero` 부분만** (line 166-226 in battle.jsx) — `.cd-mega`/`.cd-arc-bg`/`.cd-dial`/`.cd-controls`/`.cd-key-hint` (402-548 in app.css). 나머지(.timeline-row/.rally-strip)는 사용 금지 |
| **Phase 8 — Spring 리팩토링** | [app.css](reference/app.css), [snow.jsx](reference/snow.jsx) | `SnowCanvas` 패턴을 벚꽃 캔버스로 재작성 시 참고 |

## 보조 파일

- [snow.jsx](reference/snow.jsx) — Phase 1에서 [SnowCanvas.jsx](../../../web/src/components/Layout/SnowCanvas.jsx) 로 ESM 변환됨
- [data.jsx](reference/data.jsx) — i18n 키, ALLIANCES, mock data. **mock 데이터는 사용하지 말 것** (우리는 NestJS API 사용). i18n 키 명명 규칙만 참고.
- [app.html](reference/app.html) — 원본 HTML 셸 (CDN React 로드용). 우리는 Vite 빌드 사용하므로 `index.html`은 우리 것 유지.

## 스크린샷

`screenshots/` 디렉토리에 사용자가 첨부한 5개 스크린샷:

| 파일명 | 화면 | 핵심 시각 요소 |
|--------|------|----------------|
| `01-login.png` | 로그인 / FROST PROTOCOL | 글래스 모달 + 로고 SVG + 로그인/가입 토글 + dev 빠른 로그인 6개 그리드 |
| `02-battle.png` | 전투 탭 | 좌측 Icon Rail 8개 + 거대 카운트다운(20s) + 호+틱 다이얼 + 멤버 출정 4명 + 우측 Chat Dock + 하단 Rally chips 4개 |
| `03-community.png` | 커뮤니티 / 공지사항 | 공지/게시판 sub-tab + 새 공지 버튼 + 공지 카드 3개 (PIN 뱃지 포함) + 우측 Chat Dock 동일 |
| `04-chat.png` | 채팅 (풀페이지) | `// 채팅` 타이틀 + `# GENERAL` 헤더 + 자동 번역 토글 + 메시지 5개 + 우측 연맹별 온라인 사이드바 |
| `05-admin.png` | 관리 / 사용자 관리 | 👑 사용자 관리 헤더 + 표 (닉네임/연맹/역할/액션) + 연맹 컬러 뱃지 (KOR/NSL/JKY/GPX/UFO) + 우측 Chat Dock |

> 스크린샷이 비어있는 시점엔 사용자에게 다음 명령어로 저장 요청:
> ```
> 첨부 이미지 5장을 docs/design/frost-protocol/screenshots/ 에 위 파일명으로 저장 부탁
> ```

## 절대 적용하지 않는 디자인 (사용자 명시)

Battle 탭의 다음 요소들은 **클로드 디자인에 있지만 적용 금지** — 기존 기능 손실 방지:

- ❌ 멤버 타임라인 막대 (`.timeline-row`, `.tl-bar`) — 우리 `Dispatch.jsx` + `CountdownDots.jsx` 와 충돌
- ❌ Rally Strip chip (`.rally-strip`, `.rally-chip`) — 우리 `RallyGroupPanel`은 6개 그룹 동시 관리·편집. 단순화 시 기능 손실
- ❌ BattleStage grid 재구성 (`.battle-stage` 2x1 + bottom strip) — 기존 `.battle-grid` 유지
- ❌ 멤버 추가 폼 (`.member-add`) — 우리 `RallyGroupEditor`와 도메인 다름

## 현재 진행 상황

| Phase | 상태 |
|-------|------|
| Phase 1 — 테마 토큰 + 4번째 테마 등록 | ✅ 완료 (verify-loop 통과) |
| Phase 2-8 | ⏳ 대기 |
