# 2026-04-26 — Countdown(1번) ↔ RallyGroup(3번) 상호 배제 + Countdown 자동 초기화

## Context

전투현황 탭에는 **음성 카운트다운**을 발화하는 두 기능이 있다:

- **1번 Countdown** — 동맹 공용 카운트다운 (1~180초). admin/developer가 시작하면 Socket.io로 전체 브로드캐스트, 모든 클라이언트가 동시에 TTS 숫자 발화.
  - 상태 보관: `realtime.gateway.ts:35` — 인스턴스 메모리 `{ active, startedAt, totalSeconds }`
  - 종료: **수동 stop만** — 0초 도달해도 `active=true` 유지됨 ([Countdown.jsx:173](web/src/components/Battle/Countdown.jsx:173) `setRemaining(0)` 후 화면만 멈춤)
- **3번 RallyGroupPanel** — 집결 그룹별 카운트다운 (그룹당 멤버 N명, 멤버별 발사 시각 차등). 시작 안내 음성 + 프리카운트(3·2·1) + 멤버별 "출발" 음성.
  - 상태 보관: DB `rally_groups.state` (`idle`/`running`/`finished`) + `startedAtServerMs` + `maxMarchSeconds`
  - 동시 running: **여러 그룹 동시 가능** (현재 구조)

**문제:** R4들(admin)/developer 다수가 두 기능을 **동시에 누르면 음성이 겹쳐** 동맹 전체에 혼란이 생긴다.

**요구사항:**
1. **상호 배제** — 1번/3번 어느 하나라도 진행 중이면 다른 시작 요청 차단. 3번끼리도 한 그룹만 running.
2. **Countdown 자동 초기화** — 1번이 0초에 도달하면 서버 상태를 `active=false`로 리셋하고 모든 클라이언트에 broadcast.

---

## Design

### 핵심 설계 결정

| # | 항목 | 권장안 | 이유 |
|---|---|---|---|
| **D1** | Lock 위치 | 서버 메모리 단일 lock (`BusyLockService` 신설) | 단일 인스턴스 모놀리스 가정. DB lock보다 단순/빠름. 두 게이트웨이가 동일 서비스 주입받아 공유. |
| **D2** | Lock 식별자 | `'countdown'` 또는 `'rally:<groupId>'` | 무엇이 잡고 있는지 broadcast로 알리면 클라 UX(어느 기능이 진행 중)에 활용 가능. |
| **D3** | Lock 범위 | 서버 인스턴스 글로벌 (단일 동맹/서버 가정) | 현재 코드도 alliance 구분 없이 broadcast — 이미 글로벌. |
| **D4** | Countdown 자동 초기화 트리거 | 서버 측 `setTimeout(totalSeconds * 1000)` | 클라이언트 다수가 stop emit하면 race. 서버에서 권위적으로 1회 reset. |
| **D5** | Rally 자동 lock 해제 | `(maxMarchSeconds + 5초 여유) * 1000` 후 자동 stop | 사용자 요청은 1번만이지만 lock이 영구히 안 풀리면 dead state. 안전 timeout 추가. |
| **D6** | 시작 거부 응답 | Socket ack callback에 `{ ok: false, reason: 'busy', holder }` | 별도 이벤트보다 ack가 직관적, 클라가 await 가능. |
| **D7** | 클라이언트 UX | zustand `busyHolder` state + 시작 버튼 disable + 거부 시 1.5초 토스트 | 시각적 차단(능동) + 서버 응답(반응) 이중. |

### 컴포넌트/모듈 변화

```
[NEW]      server/src/realtime/busy-lock.service.ts        — 단일 글로벌 lock service
[NEW]      server/src/realtime/busy-lock.service.spec.ts
[MODIFY]   server/src/realtime/realtime.gateway.ts         — countdown:start/stop 게이팅 + 자동 reset setTimeout
[MODIFY]   server/src/realtime/realtime.module.ts          — BusyLockService provider/export
[MODIFY]   server/src/rally-groups/rally-groups.service.ts — startCountdown/stopCountdown 게이팅 + 자동 idle setTimeout
[MODIFY]   server/src/rally-groups/rally-groups.module.ts  — BusyLockService inject (RealtimeModule import)
[MODIFY]   server/src/rally-groups/rally-groups.controller.ts — start API에서 ack 의미의 200/409 응답
[MODIFY]   web/src/store/index.js                          — busyHolder state 추가
[MODIFY]   web/src/api/index.js                            — busy:state 이벤트 핸들러
[MODIFY]   web/src/hooks/useSocket.js                      — busy:state 구독
[MODIFY]   web/src/components/Battle/Countdown.jsx         — 시작 버튼 disable + 토스트
[MODIFY]   web/src/components/Battle/RallyGroupPanel.jsx   — 시작 버튼 disable + 토스트
```

### BusyLockService 인터페이스

```ts
export type LockHolder = { type: 'countdown' } | { type: 'rally'; groupId: string };

@Injectable()
export class BusyLockService {
  private holder: LockHolder | null = null;
  private autoReleaseTimer: NodeJS.Timeout | null = null;

  /** 잠금 시도. 성공 시 true, 이미 점유 중이면 false. */
  tryAcquire(holder: LockHolder, autoReleaseMs?: number, onAutoRelease?: () => void): boolean;

  /** 명시적 해제. 현재 holder가 일치할 때만 해제 (다른 주체의 holder를 실수로 풀지 않도록). */
  release(holder: LockHolder): void;

  /** 현재 holder 조회 (broadcast/UX용). */
  getHolder(): LockHolder | null;
}
```

자동 해제 타이머는 `tryAcquire` 시 함께 등록 → `release` 시 clear, 만료 시 `onAutoRelease` 콜백으로 broadcast 트리거.

### 자동 초기화 흐름 (Countdown)

```
SFC가 30초 카운트다운 시작
 ├ realtime.gateway.handleCountdownStart()
 │   ├ busyLock.tryAcquire({ type:'countdown' }, 30000+1000, onAutoRelease)
 │   │   └ false면 ack { ok:false, reason:'busy', holder } 후 return
 │   ├ countdown = { active:true, startedAt, totalSeconds:30 }
 │   ├ server.emit('countdown:state', countdown)
 │   └ server.emit('busy:state', { holder: {type:'countdown'} })
 │
 (30초 + 1초 여유 후 setTimeout fire)
 │
 ├ onAutoRelease()
 │   ├ countdown = { active:false, startedAt:0, totalSeconds:0 }
 │   ├ server.emit('countdown:state', countdown)  // 클라 자동 초기화
 │   └ server.emit('busy:state', { holder: null })
```

수동 stop 호출 시: 동일 흐름이지만 timeout을 clear한 뒤 release.

### Rally 자동 해제 흐름

```
admin이 Rally 그룹 X 시작
 ├ rally-groups.service.startCountdown()
 │   ├ busyLock.tryAcquire({type:'rally', groupId:X}, (maxMarch+5)*1000+LEAD, onAutoRelease)
 │   │   └ false면 BadRequestException { reason:'busy', holder } (controller가 409 변환)
 │   ├ DB state='running'
 │   ├ gateway.emitCountdownStart
 │   └ gateway.emit('busy:state', { holder: {type:'rally', groupId:X} })
 │
 (maxMarch + LEAD + 5초 후)
 │
 ├ onAutoRelease()
 │   ├ DB state='idle', startedAtServerMs=null
 │   ├ gateway.emitCountdownStop(X)
 │   └ gateway.emit('busy:state', { holder: null })
```

명시적 stop 호출 시: timeout clear 후 release.

### 클라이언트 UX

zustand store:
```js
busyHolder: null | { type: 'countdown' } | { type: 'rally', groupId }
```

- 소켓 `busy:state` 이벤트 수신 시 `setBusyHolder` 갱신.
- [Countdown.jsx](web/src/components/Battle/Countdown.jsx) 시작 버튼:
  - `disabled={busyHolder !== null}` (active일 때는 어차피 stop 버튼이 보이므로 OK)
  - tooltip: "다른 카운트다운이 진행 중입니다" (busyHolder가 rally면)
- [RallyGroupPanel.jsx](web/src/components/Battle/RallyGroupPanel.jsx) 각 그룹 시작 버튼:
  - `disabled={busyHolder !== null && busyHolder.groupId !== g.id}`
- 서버 ack `{ ok:false }` 또는 409 수신 시 1.5초 토스트 (또는 인라인 에러 메시지) — 기존 RallyGroupPanel.jsx의 `setError` 패턴 활용.

### 페일세이프

- **서버 재시작 시**: 메모리 lock은 휘발 → 자동 해제. DB `rally_groups.state`는 남으므로 부팅 시 `state='running'` 인 row 모두 `idle`로 reset (RallyGroupsService에 `onModuleInit` 추가 권장).
- **클라이언트 미연결 중**: connection 시 `client.emit('busy:state', getHolder())` 초기 push (handleConnection에 추가).
- **자동 해제 타이머 만료 후**: holder가 이미 다른 값이면 no-op (lock holder mismatch 체크).

### Out of scope

- 멀티 인스턴스 (Redis lock 등) — 현재 단일 서버 모놀리스라 필요 없음.
- Alliance별 격리 — 현재 broadcast가 글로벌이므로 lock도 글로벌.
- Countdown 외 기능(공지 등) — TTS 충돌 없음.

---

## Tasks

### Task 1 — BusyLockService 신설
- `server/src/realtime/busy-lock.service.ts` 작성
- `tryAcquire/release/getHolder` 구현 + setTimeout 관리
- 단위 테스트 `busy-lock.service.spec.ts` (acquire/release/auto-release/holder-mismatch)
- `realtime.module.ts`에 provider/export 추가

### Task 2 — RealtimeGateway 통합
- `handleCountdownStart`에 lock check + ack 응답
- start 성공 시 `setTimeout` 등록, `onAutoRelease`에서 countdown reset + broadcast
- `handleCountdownStop`에서 lock release + timeout clear
- `busy:state` 이벤트 broadcast (start/stop/auto-release)
- `handleConnection`에서 client.emit('busy:state', currentHolder) 초기 푸시
- 기존 카운트다운 e2e 테스트가 있다면 안 깨지는지 확인

### Task 3 — RallyGroupsService 통합
- `RallyGroupsModule`이 `RealtimeModule` 또는 `BusyLockService`를 import
- `startCountdown`에 lock check (실패 시 `BadRequestException('busy', holder)`)
- start 성공 시 setTimeout 등록 (`(maxMarch+LEAD/1000+5) * 1000` ms) + auto-idle 처리
- `stopCountdown`에서 lock release + timeout clear
- `onModuleInit`: `state='running'` row 전부 `idle`로 reset (서버 재시작 복구)
- 단위 테스트: lock 점유 시 start 거부, stop 시 release, auto-release 동작

### Task 4 — RallyGroupsController 응답 코드
- `startCountdown` 컨트롤러에서 `BadRequestException` → 409 Conflict 매핑 또는 명시적 응답 변환
- 응답 body에 `{ reason: 'busy', holder: { type, groupId? } }` 포함

### Task 5 — 프론트엔드 store/socket
- `web/src/store/index.js`에 `busyHolder` state + `setBusyHolder` action
- `useSocket.js`에서 `busy:state` 이벤트 구독 → store 갱신
- 연결 직후 서버가 푸시하는 초기값도 동일 핸들러로 처리

### Task 6 — Countdown.jsx 시작 버튼 게이팅 + 에러 UX
- `busyHolder` 구독
- 시작 버튼 `disabled` 조건에 `|| (busyHolder && busyHolder.type !== 'countdown')` 추가 (자기 자신은 stop 버튼 노출이므로 사실상 다른 holder만 차단)
- ack 응답 처리: `socket.emit('countdown:start', s, (ack) => { if (!ack?.ok) showError(...) })` → ack 콜백 형태로 변경 (현재는 emit only)
- 1.5초 후 자동 사라지는 인라인 메시지

### Task 7 — RallyGroupPanel.jsx 시작 버튼 게이팅 + 에러 UX
- 그룹별 시작 버튼 `disabled` 조건에 `|| (busyHolder && busyHolder.groupId !== g.id)` 추가
- 기존 try/catch에서 409 응답을 `setError`로 표시 (이미 패턴 있음)

### Task 8 — 통합 시나리오 검증
- 시나리오 A: Countdown 진행 중 Rally 시작 시도 → 거부 + 에러 메시지
- 시나리오 B: Rally 진행 중 Countdown 시작 시도 → 거부
- 시나리오 C: Countdown 30초 시작 → 30초 후 자동 active=false, 모든 클라 동기화
- 시나리오 D: Rally 시작 → maxMarch+LEAD+5초 후 자동 idle, lock 해제
- 시나리오 E: 두 사용자가 거의 동시에 시작 클릭 → 한쪽만 성공

---

## Critical Files

- `server/src/realtime/realtime.gateway.ts` — countdown 핸들러
- `server/src/realtime/realtime.module.ts` — provider 등록
- `server/src/rally-groups/rally-groups.service.ts` — start/stop 게이팅 + onModuleInit
- `server/src/rally-groups/rally-groups.module.ts` — BusyLockService 주입
- `server/src/rally-groups/rally-groups.controller.ts` — 409 응답
- `web/src/store/index.js` — busyHolder state
- `web/src/hooks/useSocket.js` — busy:state 구독
- `web/src/components/Battle/Countdown.jsx` — 시작 버튼 + ack
- `web/src/components/Battle/RallyGroupPanel.jsx` — 시작 버튼 + 에러

---

## Verification

### 자동 테스트
- `busy-lock.service.spec.ts` — 신설
- `realtime.gateway` — countdown lock e2e (있다면 확장, 없으면 신설은 선택)
- `rally-groups.service.spec.ts` — start/stop lock 케이스 추가

### 수동 검증 (preview 서버 + 두 브라우저 세션)
1. 두 브라우저에 admin 두 명 로그인 (예: `dev_admin_ko`, `dev_dev_ko`)
2. **시나리오 A**: A가 Countdown 30초 시작 → B가 Countdown 시작 클릭 → 거부 메시지 확인 + B의 시작 버튼 disabled 확인
3. **시나리오 B**: A가 Rally 그룹 시작 → B가 Countdown 시작 시도 → 거부
4. **시나리오 C (자동 초기화)**: A가 Countdown 5초 시작 → 5초 후 두 브라우저 모두 'idle' 상태 + 시작 버튼 활성화 확인
5. **시나리오 D**: 거의 동시 클릭 — 한쪽만 active, 다른 쪽 거부 메시지
6. **시나리오 E (서버 재시작 복구)**: Rally 진행 중 NestJS 재시작 → DB의 running row가 idle로 복구되는지

### 회귀 방지
- 기존 board posting (직전 fix)
- 기존 Countdown stop 동작
- 기존 Rally 멤버 편집/marchSeconds 변경 → 재정렬

---

## 미해결 질문 (사용자 확인 후 확정)

1. **Rally 자동 idle 안전 여유**: 권장 `+5초` (마지막 발사 음성이 끝날 때까지). 다른 값 선호?
2. **거부 시 UX**: 인라인 에러 메시지(기존 `rally-error` 패턴) 권장. 토스트 컴포넌트 신설 선호?
3. **클라이언트에서도 ack 실패 시 자동 retry?**: 권장 = retry 안 함 (사용자가 다시 누르도록). 동의?
