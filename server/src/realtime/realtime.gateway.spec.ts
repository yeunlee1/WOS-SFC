/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

// realtime.gateway.spec.ts
//
// RealtimeGateway의 BusyLock 통합 + countdown:start/stop 핵심 분기 단위 테스트.
//
// 검증 범위:
// - countdown:start ack 응답 타입 (성공 / invalid / busy / 권한 거부)
// - countdown:stop holder 가드 (rally가 lock 잡고 있으면 거부)
// - 자동 expire 시 countdown 상태 reset + busy:state(null) 브로드캐스트
// - **race**: countdown:start의 negotiateStartedAt await 중 stop 호출되어 lock release
//   → start의 await가 끝나서 countdown.active=true가 lock 없이 설정됨 (Important 이슈)
//
// 모킹 전략: socket.io Server는 단순 emit/sockets stub.
// negotiateStartedAt은 ReadyNegotiationService를 mock하여 임의 시점에 resolve.

import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server, Socket } from 'socket.io';
import { AllianceNoticesService } from '../alliance-notices/alliance-notices.service';
import { BoardsService } from '../boards/boards.service';
import { MembersService } from '../members/members.service';
import { NoticesService } from '../notices/notices.service';
import { RalliesService } from '../rallies/rallies.service';
import { BusyLockService } from './busy-lock.service';
import { ReadyNegotiationService } from './ready-negotiation.service';
import { RealtimeGateway } from './realtime.gateway';
import { WsRateLimitService } from './ws-rate-limit.service';

// Admin role의 JwtService.verify 결과 시뮬레이션.
const ADMIN_JWT = {
  nickname: 'admin1',
  allianceName: 'KOR',
  role: 'admin',
};

function makeAdminSocket(id = 's1'): Socket {
  return {
    id,
    handshake: {
      headers: { cookie: 'access_token=fake' },
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket;
}

interface ServerMock extends Server {
  emit: jest.Mock;
}

function makeServerMock(): ServerMock {
  return {
    emit: jest.fn(),
    sockets: {
      sockets: new Map(),
    },
  } as unknown as ServerMock;
}

describe('RealtimeGateway — BusyLock 통합 단위 테스트', () => {
  let gateway: RealtimeGateway;
  let busyLock: BusyLockService;
  let server: ServerMock;
  let negotiate: jest.Mock;
  let rateLimit: WsRateLimitService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        BusyLockService,
        WsRateLimitService,
        {
          provide: JwtService,
          useValue: { verify: jest.fn().mockReturnValue(ADMIN_JWT) },
        },
        {
          provide: ReadyNegotiationService,
          useValue: { negotiateStartedAt: jest.fn() },
        },
        // 사용되지 않는 의존성은 빈 객체 stub.
        { provide: NoticesService, useValue: { findAll: jest.fn() } },
        { provide: RalliesService, useValue: { findAll: jest.fn() } },
        { provide: MembersService, useValue: { findAll: jest.fn() } },
        { provide: BoardsService, useValue: { findAllGrouped: jest.fn() } },
        {
          provide: AllianceNoticesService,
          useValue: { findByAlliance: jest.fn() },
        },
      ],
    }).compile();

    gateway = moduleRef.get(RealtimeGateway);
    busyLock = moduleRef.get(BusyLockService);
    rateLimit = moduleRef.get(WsRateLimitService);
    server = makeServerMock();
    gateway.server = server;
    negotiate = moduleRef.get(ReadyNegotiationService).negotiateStartedAt;
    // 기본은 즉시 resolve (RTT 0).
    negotiate.mockResolvedValue(Date.now() + 200);
  });

  afterEach(() => {
    // BusyLock setTimeout이 남아 있으면 jest worker가 graceful close 안 됨.
    busyLock.release({ type: 'countdown' });
    busyLock.release({ type: 'rally', groupId: 'g1' });
  });

  describe('countdown:start ack 응답', () => {
    it('정상 — { ok: true } 반환 + lock 점유 + busy:state broadcast', async () => {
      const sock = makeAdminSocket();
      const ack = await gateway.handleCountdownStart(sock, 10);

      expect(ack).toEqual({ ok: true });
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });
      // busy:state broadcast 확인 — emit calls 중에 holder 정보 포함된 것 존재.
      expect(server.emit).toHaveBeenCalledWith('busy:state', {
        holder: { type: 'countdown' },
      });
      // countdown:state도 active=true로 emit.
      expect(server.emit).toHaveBeenCalledWith(
        'countdown:state',
        expect.objectContaining({ active: true, totalSeconds: 10 }),
      );
    });

    it('totalSeconds 비정수 → { ok: false, reason: invalid }', async () => {
      const sock = makeAdminSocket();
      const ack = await gateway.handleCountdownStart(
        sock,
        5.5 as unknown as number,
      );
      expect(ack).toEqual({ ok: false, reason: 'invalid' });
      expect(busyLock.getHolder()).toBeNull();
    });

    it('totalSeconds < 1 → invalid', async () => {
      const sock = makeAdminSocket();
      const ack = await gateway.handleCountdownStart(sock, 0);
      expect(ack).toEqual({ ok: false, reason: 'invalid' });
    });

    it('totalSeconds > 600 → invalid', async () => {
      const sock = makeAdminSocket();
      const ack = await gateway.handleCountdownStart(sock, 601);
      expect(ack).toEqual({ ok: false, reason: 'invalid' });
    });

    it('이미 lock 점유 (다른 holder) → { ok: false, reason: busy, holder }', async () => {
      // 사전: rally가 lock 점유 중.
      busyLock.tryAcquire({ type: 'rally', groupId: 'g1' });

      const sock = makeAdminSocket();
      const ack = await gateway.handleCountdownStart(sock, 10);

      expect(ack).toEqual({
        ok: false,
        reason: 'busy',
        holder: { type: 'rally', groupId: 'g1' },
      });
      // negotiate은 호출되지 않음 (lock 획득 실패가 우선).
      expect(negotiate).not.toHaveBeenCalled();
    });

    it('rate limit 초과 → { ok: false, reason: rate_limit }', async () => {
      const sock = makeAdminSocket();
      // 5회 한도 채우기.
      for (let i = 0; i < 5; i++) {
        rateLimit.check(sock.id, 'countdown:start', 5, 60_000);
      }
      const ack = await gateway.handleCountdownStart(sock, 10);
      expect(ack).toEqual({ ok: false, reason: 'rate_limit' });
    });

    it('권한 없음 (member) → { ok: false } (reason 노출 안 함)', async () => {
      // JwtService.verify를 member role로 override.
      const memberSock = makeAdminSocket('s2');
      const jwt = (gateway as unknown as { jwtService: JwtService }).jwtService;
      (jwt.verify as jest.Mock).mockReturnValueOnce({
        nickname: 'm',
        allianceName: 'KOR',
        role: 'member',
      });
      const ack = await gateway.handleCountdownStart(memberSock, 10);
      expect(ack).toEqual({ ok: false });
      expect(busyLock.getHolder()).toBeNull();
    });

    it('negotiateStartedAt이 throw → lock leak 방지 (자동 release + busy:state(null))', async () => {
      negotiate.mockRejectedValueOnce(new Error('probe failed'));
      const sock = makeAdminSocket();

      await expect(gateway.handleCountdownStart(sock, 10)).rejects.toThrow(
        'probe failed',
      );

      expect(busyLock.getHolder()).toBeNull();
      // 마지막 broadcast가 busy:state(null)이어야 함.
      expect(server.emit).toHaveBeenCalledWith('busy:state', { holder: null });
    });
  });

  describe('countdown:stop ack 응답', () => {
    it('정상 — countdown holder lock release + state idle + busy:state(null)', async () => {
      // 사전: countdown 시작.
      const sock = makeAdminSocket();
      await gateway.handleCountdownStart(sock, 10);
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

      // emit 호출 카운트 reset.
      server.emit.mockClear();

      const ack = gateway.handleCountdownStop(sock);

      expect(ack).toEqual({ ok: true });
      expect(busyLock.getHolder()).toBeNull();
      expect(server.emit).toHaveBeenCalledWith('busy:state', { holder: null });
      expect(server.emit).toHaveBeenCalledWith(
        'countdown:state',
        expect.objectContaining({ active: false, totalSeconds: 0 }),
      );
    });

    it('rally가 lock 점유 중 → { ok: false } (다른 holder의 lock 풀지 않음)', async () => {
      // 사전: rally 점유.
      busyLock.tryAcquire({ type: 'rally', groupId: 'g1' });

      const sock = makeAdminSocket();
      const ack = gateway.handleCountdownStop(sock);

      expect(ack).toEqual({ ok: false });
      // rally lock 유지.
      expect(busyLock.getHolder()).toEqual({ type: 'rally', groupId: 'g1' });
    });

    it('권한 없음 (member) → { ok: false }', async () => {
      const sock = makeAdminSocket();
      const jwt = (gateway as unknown as { jwtService: JwtService }).jwtService;
      (jwt.verify as jest.Mock).mockReturnValueOnce({
        nickname: 'm',
        allianceName: 'KOR',
        role: 'member',
      });
      const ack = gateway.handleCountdownStop(sock);
      expect(ack).toEqual({ ok: false });
    });
  });

  describe('자동 expire (BusyLock setTimeout)', () => {
    it('totalSeconds + grace 경과 → countdown.active=false + busy:state(null) broadcast', async () => {
      jest.useFakeTimers();
      try {
        const sock = makeAdminSocket();
        // negotiate은 즉시 resolve이므로 fake timer 활성화 후에도 정상 동작.
        negotiate.mockImplementation(() => Promise.resolve(Date.now() + 200));

        await gateway.handleCountdownStart(sock, 5);
        expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

        // 5000ms (totalSeconds * 1000) + 1000ms grace = 6000ms.
        jest.advanceTimersByTime(6001);
        // microtask 큐 비우기.
        await Promise.resolve();
        await Promise.resolve();

        expect(busyLock.getHolder()).toBeNull();
        // 자동 expire 후 countdown:state(active:false) emit.
        const calls = server.emit.mock.calls.filter(
          (c) => c[0] === 'countdown:state',
        );
        const lastCountdown = calls[calls.length - 1];
        expect(lastCountdown[1]).toEqual(
          expect.objectContaining({ active: false, totalSeconds: 0 }),
        );
        // busy:state(null) emit도 발생.
        expect(server.emit).toHaveBeenCalledWith('busy:state', {
          holder: null,
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('start ↔ stop race (Important 이슈 — 수정 후 가드 검증)', () => {
    // 시나리오:
    // 1. Admin A: countdown:start → tryAcquire 성공, await negotiateStartedAt 진입
    // 2. Admin (A or B): countdown:stop → busyLock.release({countdown}) → holder=null,
    //    state:idle, busy:state(null) broadcast
    // 3. negotiate가 resolve → 수정된 코드가 holder를 재확인 → 'countdown'이 아니므로
    //    abort + ack { ok:false, reason:'busy', holder } 반환, countdown.active 변경 X.
    //
    // 수정 전(버그): countdown.active=true가 lock 없이 설정되어 게이팅 우회 가능했음.
    // 수정 후: holder 재확인 가드로 race 차단.
    //
    // 검증 방식: negotiateStartedAt을 수동 제어 가능한 deferred Promise로 mock,
    // start의 await 도중에 stop을 호출 후 negotiate를 resolve해 race를 재현,
    // 가드가 active=true 설정 + broadcast를 차단하는지 확인.
    it('start의 negotiate 중 stop이 lock 풀면 start 완료 후에도 active=true가 lock 없이 설정되면 안 됨', async () => {
      let resolveNegotiate!: (v: number) => void;
      const negotiatePromise = new Promise<number>((res) => {
        resolveNegotiate = res;
      });
      negotiate.mockReturnValue(negotiatePromise);

      const sock = makeAdminSocket();
      // start 시작 — await 대기 상태로 진입.
      const startPromise = gateway.handleCountdownStart(sock, 10);

      // 다음 microtask로 yield해 lock 획득까지는 진행되도록.
      await Promise.resolve();
      // 시점: lock 점유 중, negotiate 대기.
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

      // race: 다른 admin이 stop 호출.
      const stopAck = gateway.handleCountdownStop(sock);
      expect(stopAck).toEqual({ ok: true });
      // stop 결과 lock 풀림.
      expect(busyLock.getHolder()).toBeNull();

      // negotiate resolve → start 완료.
      resolveNegotiate(Date.now() + 200);
      const startAck = await startPromise;

      // 가드 적용 후: start는 lock이 풀린 것을 감지하고 ok:false를 반환.
      expect(startAck).not.toEqual({ ok: true });

      // 마지막 countdown:state broadcast가 active=true가 아니어야 함.
      // (handleCountdownStop이 active=false로 broadcast한 상태가 마지막이어야 함.)
      const lastCountdown = server.emit.mock.calls
        .filter((c) => c[0] === 'countdown:state')
        .pop();
      if (lastCountdown) {
        expect(lastCountdown[1]).toEqual(
          expect.objectContaining({ active: false }),
        );
      }
    });

    it('start↔stop race 가드 — ack가 { ok:false, reason:busy } 형태로 반환되며 countdown:state(active:true) 미발생', async () => {
      // 위 테스트 보완 — race 발생 시 ack 구조와 broadcast 부재를 명시적으로 검증.
      let resolveNegotiate!: (v: number) => void;
      const p = new Promise<number>((res) => {
        resolveNegotiate = res;
      });
      negotiate.mockReturnValue(p);

      const sock = makeAdminSocket();
      const startPromise = gateway.handleCountdownStart(sock, 10);
      await Promise.resolve();
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

      const stopAck = gateway.handleCountdownStop(sock);
      expect(stopAck).toEqual({ ok: true });
      expect(busyLock.getHolder()).toBeNull();

      // stop 후 countdown:state(active:false)가 한 번 broadcast된 상태.
      // 이후 start의 emit 추적을 위해 mockClear는 하지 않고 그대로 진행.

      resolveNegotiate(Date.now() + 200);
      const startAck = await startPromise;

      // 가드 적용 후: ack는 ok:false + reason:'busy' 형태.
      // holder는 null (stop이 풀어둔 상태).
      expect(startAck).toMatchObject({ ok: false, reason: 'busy' });

      // start는 countdown.active=true로 broadcast하지 않아야 함.
      // 따라서 모든 countdown:state 호출 중 active:true는 존재하면 안 됨.
      const activeTrueCalls = server.emit.mock.calls
        .filter((c) => c[0] === 'countdown:state')
        .filter((c) => (c[1] as { active?: boolean })?.active === true);
      expect(activeTrueCalls).toHaveLength(0);
    });

    // 2회차 verify-loop 보강 — race 가드의 두 번째 분기 회귀 보호.
    // 시나리오: countdown:start의 negotiate await 도중 stop이 풀고,
    // 즉시 RallyGroupsService(다른 admin)가 rally lock을 잡은 상태에서 await 종료.
    // 이 경우 currentHolder = {type:'rally', groupId:'g2'} 이며, 가드의
    // !currentHolder는 false이지만 currentHolder.type !== 'countdown'은 true →
    // 분기가 활성화되어야 한다.
    // 이 분기가 회귀로 사라지면 (예: 가드 조건이 잘못 단순화됨) start가 lock 없이
    // active=true 설정 + countdown:state(active:true) broadcast → 게이팅 우회 가능.
    it('start↔stop race 가드 — stop 직후 다른 holder(rally)가 lock 점유한 케이스도 차단', async () => {
      let resolveNegotiate!: (v: number) => void;
      const p = new Promise<number>((res) => {
        resolveNegotiate = res;
      });
      negotiate.mockReturnValue(p);

      const sock = makeAdminSocket();
      const startPromise = gateway.handleCountdownStart(sock, 10);
      await Promise.resolve();
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

      // race 시퀀스:
      // (1) 다른 admin이 stop 호출 → countdown lock release.
      const stopAck = gateway.handleCountdownStop(sock);
      expect(stopAck).toEqual({ ok: true });
      expect(busyLock.getHolder()).toBeNull();

      // (2) 즉시 RallyGroupsService(다른 admin)가 rally lock 획득.
      const rallyAcquired = busyLock.tryAcquire({
        type: 'rally',
        groupId: 'g2',
      });
      expect(rallyAcquired).toBe(true);
      expect(busyLock.getHolder()).toEqual({ type: 'rally', groupId: 'g2' });

      // (3) negotiate resolve → start 완료 (race 가드 진입).
      resolveNegotiate(Date.now() + 200);
      const startAck = await startPromise;

      // 가드 적용: holder는 rally지만 'countdown'이 아니므로 abort.
      expect(startAck).toMatchObject({
        ok: false,
        reason: 'busy',
        holder: { type: 'rally', groupId: 'g2' },
      });

      // rally lock은 그대로 유지 (start가 release를 호출하지 않아야 함).
      expect(busyLock.getHolder()).toEqual({ type: 'rally', groupId: 'g2' });

      // countdown:state(active:true)는 절대 broadcast되면 안 됨.
      const activeTrueCalls = server.emit.mock.calls
        .filter((c) => c[0] === 'countdown:state')
        .filter((c) => (c[1] as { active?: boolean })?.active === true);
      expect(activeTrueCalls).toHaveLength(0);
    });
  });
});
