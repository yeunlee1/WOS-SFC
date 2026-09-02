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

import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter } from 'events';
import type { Server, Socket } from 'socket.io';
import { AllianceNoticesService } from '../alliance-notices/alliance-notices.service';
import { BoardsService } from '../boards/boards.service';
import { MembersService } from '../members/members.service';
import { NoticesService } from '../notices/notices.service';
import { RalliesService } from '../rallies/rallies.service';
import { BusyLockService } from './busy-lock.service';
import { ReadyNegotiationService } from './ready-negotiation.service';
import { SocketAuthService } from './socket-auth.service';
import { RealtimeGateway } from './realtime.gateway';
import { WsRateLimitService } from './ws-rate-limit.service';
import { UsersService } from '../users/users.service';

// Admin role의 JwtService.verify 결과 시뮬레이션.
const ADMIN_JWT = {
  sub: 1,
  nickname: 'admin1',
  allianceName: 'KOR',
  role: 'admin',
};

function makeAdminSocket(id = 's1'): Socket {
  return {
    id,
    connected: true,
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
  // 인증 조회는 SocketAuthService를 거치므로 게이트웨이의 private 필드가 아니라
  // DI로 넣은 mock을 직접 잡는다.
  let usersServiceMock: { findById: jest.Mock };
  let jwtServiceMock: { verify: jest.Mock };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        BusyLockService,
        WsRateLimitService,
        // 실제 구현을 쓴다 — 소켓 인증 공유가 깨지면 여기서도 드러나야 한다.
        SocketAuthService,
        {
          provide: JwtService,
          useValue: { verify: jest.fn().mockReturnValue(ADMIN_JWT) },
        },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn((id: number) =>
              id === 2
                ? {
                    id: 2,
                    nickname: 'member1',
                    allianceName: 'KOR',
                    role: 'member',
                  }
                : {
                    id: 1,
                    nickname: 'admin1',
                    allianceName: 'KOR',
                    role: 'admin',
                  },
            ),
          },
        },
        {
          provide: ReadyNegotiationService,
          useValue: { negotiateStartedAt: jest.fn() },
        },
        // 사용되지 않는 의존성은 빈 객체 stub.
        {
          provide: NoticesService,
          useValue: { findAll: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: RalliesService,
          useValue: { findAll: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: MembersService,
          useValue: { findAll: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: BoardsService,
          useValue: { findAllGrouped: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: AllianceNoticesService,
          useValue: { findByAlliance: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    gateway = moduleRef.get(RealtimeGateway);
    usersServiceMock = moduleRef.get(UsersService);
    jwtServiceMock = moduleRef.get(JwtService);
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
      jwtServiceMock.verify.mockReturnValueOnce({
        sub: 2,
        nickname: 'm',
        allianceName: 'KOR',
        role: 'admin',
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

      const ack = await gateway.handleCountdownStop(sock);

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
      const ack = await gateway.handleCountdownStop(sock);

      expect(ack).toEqual({ ok: false });
      // rally lock 유지.
      expect(busyLock.getHolder()).toEqual({ type: 'rally', groupId: 'g1' });
    });

    it('권한 없음 (member) → { ok: false }', async () => {
      const sock = makeAdminSocket();
      jwtServiceMock.verify.mockReturnValueOnce({
        sub: 2,
        nickname: 'm',
        allianceName: 'KOR',
        role: 'admin',
      });
      const ack = await gateway.handleCountdownStop(sock);
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

        // 자동 해제 기준은 tryAcquire 시각이 아니라 확정된 startedAt이다.
        // startedAt + 5000ms (totalSeconds * 1000) + 1000ms grace 이후에 발화한다.
        const startedAt = (
          server.emit.mock.calls
            .filter((c) => c[0] === 'countdown:state')
            .pop() as [string, { startedAt: number }]
        )[1].startedAt;
        jest.advanceTimersByTime(startedAt + 5000 + 1000 + 1 - Date.now());
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
      await new Promise<void>((resolve) => setImmediate(resolve));
      // 시점: lock 점유 중, negotiate 대기.
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

      // race: 다른 admin이 stop 호출.
      const stopAck = await gateway.handleCountdownStop(sock);
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
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

      const stopAck = await gateway.handleCountdownStop(sock);
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
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

      // race 시퀀스:
      // (1) 다른 admin이 stop 호출 → countdown lock release.
      const stopAck = await gateway.handleCountdownStop(sock);
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

  describe('연결 인증 race', () => {
    it('DB 조회 중 disconnect되면 유령 온라인 사용자를 등록하지 않는다', async () => {
      const sock = makeAdminSocket('socket-race');
      const usersService = usersServiceMock;
      let resolveUser!: (user: {
        id: number;
        nickname: string;
        allianceName: string;
        role: string;
      }) => void;
      usersService.findById.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveUser = resolve;
        }),
      );

      const connecting = gateway.handleConnection(sock);
      (sock as unknown as { connected: boolean }).connected = false;
      gateway.handleDisconnect(sock);
      server.emit.mockClear();

      resolveUser({
        id: 1,
        nickname: 'admin1',
        allianceName: 'KOR',
        role: 'admin',
      });
      await connecting;

      const onlineMap = (
        gateway as unknown as {
          onlineMap: Map<string, unknown>;
        }
      ).onlineMap;
      expect(onlineMap.has(sock.id)).toBe(false);
      expect(sock.emit).not.toHaveBeenCalled();
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('countdown:start fallback 인증 중 disconnect되면 시작하지 않는다', async () => {
      const sock = makeAdminSocket('countdown-start-race');
      const usersService = usersServiceMock;
      let resolveUser!: (user: {
        id: number;
        nickname: string;
        allianceName: string;
        role: string;
      }) => void;
      usersService.findById.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveUser = resolve;
        }),
      );

      const starting = gateway.handleCountdownStart(sock, 10);
      (sock as unknown as { connected: boolean }).connected = false;
      gateway.handleDisconnect(sock);
      server.emit.mockClear();

      resolveUser({
        id: 1,
        nickname: 'admin1',
        allianceName: 'KOR',
        role: 'admin',
      });
      await expect(starting).resolves.toEqual({ ok: false });
      expect(negotiate).not.toHaveBeenCalled();
      expect(busyLock.getHolder()).toBeNull();
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('countdown:stop fallback 인증 중 disconnect되면 잠금을 유지한다', async () => {
      const sock = makeAdminSocket('countdown-stop-race');
      busyLock.tryAcquire({ type: 'countdown' });
      const usersService = usersServiceMock;
      let resolveUser!: (user: {
        id: number;
        nickname: string;
        allianceName: string;
        role: string;
      }) => void;
      usersService.findById.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveUser = resolve;
        }),
      );

      const stopping = gateway.handleCountdownStop(sock);
      (sock as unknown as { connected: boolean }).connected = false;
      gateway.handleDisconnect(sock);
      server.emit.mockClear();

      resolveUser({
        id: 1,
        nickname: 'admin1',
        allianceName: 'KOR',
        role: 'admin',
      });
      await expect(stopping).resolves.toEqual({ ok: false });
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });
      expect(server.emit).not.toHaveBeenCalled();
    });
  });

  describe('사용자 소켓 강제 종료', () => {
    it('같은 nickname의 모든 연결을 종료한다', () => {
      const first = makeAdminSocket('socket-a');
      const second = makeAdminSocket('socket-b');
      const other = makeAdminSocket('socket-c');
      const onlineMap = (
        gateway as unknown as {
          onlineMap: Map<
            string,
            { nickname: string; alliance: string; role: string }
          >;
        }
      ).onlineMap;
      onlineMap.set('socket-a', {
        nickname: 'target',
        alliance: 'KOR',
        role: 'member',
      });
      onlineMap.set('socket-b', {
        nickname: 'target',
        alliance: 'KOR',
        role: 'member',
      });
      onlineMap.set('socket-c', {
        nickname: 'other',
        alliance: 'KOR',
        role: 'member',
      });
      server.sockets.sockets.set('socket-a', first);
      server.sockets.sockets.set('socket-b', second);
      server.sockets.sockets.set('socket-c', other);

      gateway.kickUser('target');

      expect(first.disconnect).toHaveBeenCalledTimes(1);
      expect(second.disconnect).toHaveBeenCalledTimes(1);
      expect(other.disconnect).not.toHaveBeenCalled();
    });
  });

  // ── time:ping 서버 체류 시간 분리 ───────────────────────────────────────
  // 클라이언트(clockSync.js)는 rtt = (t3-t0) - (t2-t1) 로 서버 체류 시간을 빼고
  // offset = ((t1-t0) + (t2-t3)) / 2 로 시계 오차를 추정한다.
  // t1과 t2를 붙여서 찍으면 t2-t1 = 0 이라 이 분리가 통째로 no-op이 되고,
  // 서버 체류 시간의 절반이 그대로 offset 오차로 들어간다.
  describe('time:ping 4-timestamp', () => {
    it('t1은 engine.io 패킷 수신 시각 — 핸들러 체류 시간이 t2-t1에 잡힌다', async () => {
      const conn = new EventEmitter();
      const client = {
        id: 'ping-1',
        connected: true,
        conn,
        handshake: { headers: { cookie: 'access_token=fake' } },
        emit: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(client);

      // 소켓이 패킷을 받은 시각
      conn.emit('packet', { type: 'message' });
      const packetAt = Date.now();

      // 이벤트 루프가 밀려 핸들러 진입이 늦어지는 상황을 동기 대기로 흉내낸다.
      const spinUntil = packetAt + 15;
      while (Date.now() < spinUntil) {
        /* busy wait */
      }

      const res = gateway.handleTimePing(client);
      expect(res).not.toBeNull();
      // t1/t2를 붙여 찍는 구현이면 이 값이 0이라 실패한다.
      expect(res!.t2 - res!.t1).toBeGreaterThanOrEqual(12);
      expect(res!.t1).toBeLessThanOrEqual(packetAt + 2);
      expect(res!.utc).toBe(res!.t2);
    });

    it('engine.io conn이 없는 소켓도 t1 ≤ t2로 안전하게 응답한다', async () => {
      const client = makeAdminSocket('ping-2');
      await gateway.handleConnection(client);

      const res = gateway.handleTimePing(client);
      expect(res).not.toBeNull();
      expect(res!.t1).toBeLessThanOrEqual(res!.t2);
      expect(res!.utc).toBe(res!.t2);
    });

    it('rate limit 초과 시 null을 반환한다', () => {
      const client = makeAdminSocket('ping-3');
      for (let i = 0; i < 30; i++) {
        expect(gateway.handleTimePing(client)).not.toBeNull();
      }
      expect(gateway.handleTimePing(client)).toBeNull();
    });
  });

  // ── probe 대상 축소 ────────────────────────────────────────────────────
  describe('countdown:start probe 대상', () => {
    it('인증된(onlineMap) 소켓 id 집합을 협상 서비스에 전달한다', async () => {
      const client = makeAdminSocket('admin-1');
      await gateway.handleConnection(client);
      server.emit.mockClear();

      await gateway.handleCountdownStart(client, 10);

      expect(negotiate).toHaveBeenCalledTimes(1);
      const [passedServer, passedIds] = negotiate.mock.calls[0] as [
        unknown,
        Set<string>,
      ];
      expect(passedServer).toBe(server);
      expect(passedIds).toBeInstanceOf(Set);
      expect(passedIds.has('admin-1')).toBe(true);
    });
  });

  // ── 자동 해제 시각 (항목 1) ────────────────────────────────────────────
  // handleCountdownStart는 probe(negotiateStartedAt) 이전에 lock을 잡으므로
  // 자동 해제 타이머의 기준 시각(tryAcquire 시점)과 실제 카운트다운 시작 시각
  // (startedAt = tryAcquire + probe소요 + grace)이 어긋난다.
  // 이 어긋남만큼 자동 해제가 실제 종료보다 먼저 발화하면 마지막 "1"과 개인 "출발"
  // 음성이 잘리고 전원에게 "중지되었습니다"가 겹쳐 나온다.
  describe('자동 해제 시각 — 실제 종료 시각 이후에만 발화', () => {
    const PROBE_MS = 500; // ReadyNegotiationService.PROBE_DEADLINE_MS 최악값
    const GRACE_MS = 1200; // p95 clamp 시 계산되는 grace 최대값
    const AUTO_RELEASE_GRACE_MS = 1000; // 게이트웨이 상수와 동일

    function lastCountdownState(): { active: boolean; startedAt: number } {
      const calls = server.emit.mock.calls.filter(
        (c) => c[0] === 'countdown:state',
      );
      return calls[calls.length - 1][1] as {
        active: boolean;
        startedAt: number;
      };
    }

    it('probe+grace가 큰 값이어도 실제 종료 전에는 자동 해제가 발화하지 않는다', async () => {
      jest.useFakeTimers();
      try {
        // probe에 PROBE_MS가 걸리고 그 뒤 GRACE_MS를 더한 시각을 startedAt으로 돌려준다.
        negotiate.mockImplementation(() => {
          jest.advanceTimersByTime(PROBE_MS);
          return Promise.resolve(Date.now() + GRACE_MS);
        });

        const sock = makeAdminSocket('auto-expire-1');
        const totalSeconds = 30;
        const t0 = Date.now();

        await gateway.handleCountdownStart(sock, totalSeconds);

        const started = lastCountdownState();
        expect(started.active).toBe(true);
        expect(started.startedAt).toBe(t0 + PROBE_MS + GRACE_MS);

        server.emit.mockClear();

        // 실제 마지막 슬롯("1") 시각 = startedAt + (totalSeconds - 1) * 1000.
        // 그 시각까지는 자동 해제가 절대 발화하면 안 된다.
        const lastSlotAt = started.startedAt + (totalSeconds - 1) * 1000;
        jest.advanceTimersByTime(lastSlotAt - Date.now());
        expect(
          server.emit.mock.calls.filter((c) => c[0] === 'countdown:state'),
        ).toHaveLength(0);
        expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

        // 카운트다운 종료 시각(startedAt + totalSeconds*1000)까지도 유지되어야 한다.
        const endAt = started.startedAt + totalSeconds * 1000;
        jest.advanceTimersByTime(endAt - Date.now());
        expect(
          server.emit.mock.calls.filter((c) => c[0] === 'countdown:state'),
        ).toHaveLength(0);
        expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

        // 종료 + 여유가 지나면 그제서야 자동 해제된다.
        jest.advanceTimersByTime(AUTO_RELEASE_GRACE_MS + 1);
        expect(busyLock.getHolder()).toBeNull();
        expect(lastCountdownState()).toEqual(
          expect.objectContaining({ active: false }),
        );
        expect(server.emit).toHaveBeenCalledWith('busy:state', {
          holder: null,
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('종료 시각이 아직 남았는데 타이머가 발화하면 상태를 유지하고 다시 잡는다', () => {
      jest.useFakeTimers();
      try {
        const now = Date.now();
        // 진행 중인 카운트다운 상태를 직접 심는다 (아직 5초 남음).
        (
          gateway as unknown as {
            countdown: {
              active: boolean;
              startedAt: number;
              totalSeconds: number;
            };
          }
        ).countdown = {
          active: true,
          startedAt: now - 25_000,
          totalSeconds: 30,
        };
        server.emit.mockClear();

        // BusyLock이 holder를 null로 만든 뒤 콜백을 부르는 상황을 그대로 재현.
        (
          gateway as unknown as { handleCountdownAutoExpire: () => void }
        ).handleCountdownAutoExpire();

        // 조기 발화이므로 중지 broadcast가 나가면 안 되고, lock을 다시 잡아야 한다.
        expect(
          server.emit.mock.calls.filter((c) => c[0] === 'countdown:state'),
        ).toHaveLength(0);
        expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

        // 남은 시간 + 여유가 지나면 정상 종료된다.
        jest.advanceTimersByTime(5_000 + 1_000 + 1);
        expect(busyLock.getHolder()).toBeNull();
        expect(server.emit).toHaveBeenCalledWith(
          'countdown:state',
          expect.objectContaining({ active: false }),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ── handleConnection 예외 격리 (항목 2) ────────────────────────────────
  // Nest의 web-sockets-controller는 handleConnection이 돌려준 Promise를
  // subscribe 콜백에서 그냥 버린다(catch 없음). Node 24 기본값
  // (--unhandled-rejections=throw)에서는 이 rejection이 uncaughtException으로
  // 승격되어 프로세스가 종료된다.
  describe('handleConnection DB 예외 격리', () => {
    it('스냅샷 조회가 실패해도 reject하지 않고 소켓만 정리한다', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      try {
        const notices = (
          gateway as unknown as { noticesService: { findAll: jest.Mock } }
        ).noticesService;
        notices.findAll.mockRejectedValueOnce(new Error('DB 순단'));

        const sock = makeAdminSocket('db-down-1');

        await expect(gateway.handleConnection(sock)).resolves.toBeUndefined();

        const onlineMap = (
          gateway as unknown as { onlineMap: Map<string, unknown> }
        ).onlineMap;
        expect(onlineMap.has(sock.id)).toBe(false);
        expect(sock.disconnect).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('연맹 공지 조회가 실패해도 reject하지 않는다', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      try {
        const allianceNotices = (
          gateway as unknown as {
            allianceNoticesService: { findByAlliance: jest.Mock };
          }
        ).allianceNoticesService;
        allianceNotices.findByAlliance.mockRejectedValueOnce(
          new Error('DB 순단'),
        );

        const sock = makeAdminSocket('db-down-2');

        await expect(gateway.handleConnection(sock)).resolves.toBeUndefined();
        expect(sock.disconnect).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  // ── 접속 스냅샷 병렬화 (항목 3) ────────────────────────────────────────
  describe('접속 스냅샷 조회 병렬화', () => {
    it('연맹 공지 5건을 순차 대기하지 않고 한 번에 띄운다', async () => {
      const allianceNotices = (
        gateway as unknown as {
          allianceNoticesService: { findByAlliance: jest.Mock };
        }
      ).allianceNoticesService;
      const release: Array<() => void> = [];
      allianceNotices.findByAlliance.mockImplementation(
        () =>
          new Promise((resolve) => {
            release.push(() => resolve([]));
          }),
      );

      const sock = makeAdminSocket('parallel-1');
      const connecting = gateway.handleConnection(sock);
      await new Promise((resolve) => setImmediate(resolve));

      // 순차 await면 첫 호출이 pending이라 1회에서 멈춘다.
      expect(allianceNotices.findByAlliance).toHaveBeenCalledTimes(5);

      release.forEach((fn) => fn());
      await connecting;

      // 방출 순서는 고정 목록 순서를 유지해야 한다.
      const events = (sock.emit as jest.Mock).mock.calls
        .map((c) => c[0] as string)
        .filter((name) => name.startsWith('alliance-notice:updated:'));
      expect(events).toEqual([
        'alliance-notice:updated:KOR',
        'alliance-notice:updated:NSL',
        'alliance-notice:updated:JKY',
        'alliance-notice:updated:GPX',
        'alliance-notice:updated:UFO',
      ]);
    });
  });

  // ── 브로드캐스트 직렬화 (항목 4) ───────────────────────────────────────
  // 행마다 toLocaleString(옵션객체)를 부르면 매번 Intl 포매터가 새로 만들어져
  // 접속 1건(수백 행)에서 이벤트 루프가 수십 ms 동기 블로킹된다.
  describe('날짜 포맷 — 캐시된 Intl 포매터 사용', () => {
    const sample = new Date('2026-08-27T13:45:06.000Z');
    const expected = sample.toLocaleString('ko-KR', {
      dateStyle: 'short',
      timeStyle: 'short',
      // 게이트웨이 포매터가 KST 로 고정돼 있으므로 기대값도 같은 시간대로 만든다(CI 러너는 UTC).
      timeZone: 'Asia/Seoul',
    });

    function withoutToLocaleString<T>(fn: () => T): {
      value: T;
      calls: number;
    } {
      const spy = jest.spyOn(Date.prototype, 'toLocaleString');
      try {
        const value = fn();
        return { value, calls: spy.mock.calls.length };
      } finally {
        spy.mockRestore();
      }
    }

    it('formatNotice는 행마다 toLocaleString을 부르지 않으면서 같은 문자열을 낸다', () => {
      const format = (
        gateway as unknown as {
          formatNotice: (n: unknown) => { createdAt: string };
        }
      ).formatNotice;
      const { value, calls } = withoutToLocaleString(() =>
        format({ id: 1, createdAt: sample }),
      );
      expect(value.createdAt).toBe(expected);
      expect(calls).toBe(0);
    });

    it('formatAllianceNotice / formatBoardPost도 동일하다', () => {
      const g = gateway as unknown as {
        formatAllianceNotice: (n: unknown) => { createdAt: string };
        formatBoardPost: (p: unknown) => { createdAt: string };
      };
      const notice = withoutToLocaleString(() =>
        g.formatAllianceNotice({ id: 1, createdAt: sample }),
      );
      expect(notice.value.createdAt).toBe(expected);
      expect(notice.calls).toBe(0);

      const post = withoutToLocaleString(() =>
        g.formatBoardPost({ id: 1, createdAt: sample }),
      );
      expect(post.value.createdAt).toBe(expected);
      expect(post.calls).toBe(0);
    });

    it('Date가 아닌 createdAt은 그대로 문자열화한다 (회귀 방지)', () => {
      const g = gateway as unknown as {
        formatNotice: (n: unknown) => { createdAt: string };
      };
      expect(g.formatNotice({ id: 1, createdAt: '2026-08-27' }).createdAt).toBe(
        '2026-08-27',
      );
    });
  });
});
