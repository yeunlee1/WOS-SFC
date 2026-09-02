// 집결 그룹 게이트웨이의 재접속 스냅샷 계약을 검증한다.
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { SocketAuthService } from '../realtime/socket-auth.service';
import { UsersService } from '../users/users.service';
import { RallyGroupsGateway } from './rally-groups.gateway';
import type { RallyGroup } from './rally-group.entity';

const START_EVENT = 'rallyGroup:countdown:start';
const UPDATED_EVENT = 'rallyGroup:updated';

type EmitMock = jest.Mock<void, [string, unknown]>;
type ServerMock = Server & { emit: EmitMock };
type SocketMock = Socket & { emit: EmitMock; disconnect: jest.Mock };

type FireOffset = { orderIndex: number; offsetMs: number; userId: number };
type CountdownPayload = {
  groupId: string;
  startedAtServerMs: number;
  fireOffsets: FireOffset[];
};

function makeServer(): ServerMock {
  return { emit: jest.fn() as EmitMock } as unknown as ServerMock;
}

function makeSocket(id: string, token = 'valid'): SocketMock {
  return {
    id,
    connected: true,
    handshake: {
      headers: { cookie: `access_token=${encodeURIComponent(token)}` },
    },
    emit: jest.fn() as EmitMock,
    disconnect: jest.fn(),
  } as unknown as SocketMock;
}

function makeSocketWithoutCookie(id: string): SocketMock {
  return {
    id,
    connected: true,
    handshake: { headers: {} },
    emit: jest.fn() as EmitMock,
    disconnect: jest.fn(),
  } as unknown as SocketMock;
}

/** 소켓이 받은 rallyGroup:countdown:start 페이로드만 추린다. */
function snapshotsOf(socket: SocketMock): CountdownPayload[] {
  return socket.emit.mock.calls
    .filter((call) => call[0] === START_EVENT)
    .map((call) => call[1] as CountdownPayload);
}

/** 소켓이 받은 rallyGroup:updated 페이로드만 추린다. */
function groupUpdatesOf(socket: SocketMock): { id: string; state: string }[] {
  return socket.emit.mock.calls
    .filter((call) => call[0] === UPDATED_EVENT)
    .map((call) => call[1] as { id: string; state: string });
}

/** 클라이언트가 running으로 렌더하는 데 필요한 최소 그룹 형태. */
function makeGroup(id: string, state: 'idle' | 'running', displayOrder = 1) {
  return {
    id,
    name: `${displayOrder}번 집결그룹`,
    displayOrder,
    state,
    members: [],
  } as unknown as RallyGroup;
}

describe('RallyGroupsGateway 재접속 스냅샷', () => {
  let jwtService: { verify: jest.Mock };
  let findById: jest.Mock;
  let gateway: RallyGroupsGateway;
  let server: ServerMock;

  // 실제 startCountdown이 쓰는 값 — COUNTDOWN_LEAD_MS = 7000
  const LEAD_MS = 7000;

  beforeEach(() => {
    jwtService = {
      verify: jest.fn((token: string) => {
        if (token === 'valid') return { sub: 7 };
        throw new Error('invalid token');
      }),
    };
    // 이 게이트웨이는 서명 검증만 쓴다 — 사용자 조회는 호출되지 않아야 한다.
    findById = jest.fn();
    gateway = new RallyGroupsGateway(
      new SocketAuthService(
        jwtService as unknown as JwtService,
        { findById } as unknown as UsersService,
      ),
    );
    server = makeServer();
    gateway.server = server;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('진행 중인 카운트다운이 있으면 새 소켓에 시작 페이로드와 동일한 스냅샷을 보낸다', () => {
    const startedAtServerMs = Date.now() + LEAD_MS;
    const fireOffsets: FireOffset[] = [
      { orderIndex: 1, offsetMs: 0, userId: 11 },
      { orderIndex: 2, offsetMs: 45_000, userId: 12 },
      { orderIndex: 3, offsetMs: 187_000, userId: 13 },
    ];
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs,
      fireOffsets,
    });

    const late = makeSocket('late');
    gateway.handleConnection(late);

    const snapshots = snapshotsOf(late);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual({
      groupId: 'g1',
      startedAtServerMs,
      fireOffsets,
    });
    // 스케줄러가 쓰는 절대 시각이 그대로 복원되는지 수치로 확인
    expect(
      snapshots[0].startedAtServerMs + snapshots[0].fireOffsets[2].offsetMs,
    ).toBe(startedAtServerMs + 187_000);
  });

  it('187초 진행 중 100초 시점에 재접속하면 남은 슬롯의 절대시각만 미래로 남는다', () => {
    const base = 1_800_000_000_000;
    jest.useFakeTimers().setSystemTime(base);

    const startedAtServerMs = base;
    const fireOffsets: FireOffset[] = [
      { orderIndex: 1, offsetMs: 0, userId: 11 },
      { orderIndex: 2, offsetMs: 45_000, userId: 12 },
      { orderIndex: 3, offsetMs: 187_000, userId: 13 },
    ];
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs,
      fireOffsets,
    });

    jest.setSystemTime(base + 100_000);
    const late = makeSocket('late');
    gateway.handleConnection(late);

    const [payload] = snapshotsOf(late);
    expect(payload).toBeDefined();
    const serverNow = Date.now();
    const absolute = payload.fireOffsets.map(
      (f) => payload.startedAtServerMs + f.offsetMs,
    );
    expect(absolute).toEqual([base, base + 45_000, base + 187_000]);
    // 이미 지난 슬롯 2개 / 남은 슬롯 1개 — 수치로 확정
    expect(absolute.filter((a) => a < serverNow)).toEqual([
      base,
      base + 45_000,
    ]);
    expect(absolute.filter((a) => a >= serverNow)).toEqual([base + 187_000]);
    expect(base + 187_000 - serverNow).toBe(87_000);
  });

  it('진행 중인 카운트다운이 없으면 스냅샷을 보내지 않는다', () => {
    const late = makeSocket('late');
    gateway.handleConnection(late);
    expect(snapshotsOf(late)).toHaveLength(0);
    expect(late.emit).not.toHaveBeenCalled();
  });

  it('정지된 카운트다운의 잔여 상태가 새 접속자에게 새지 않는다', () => {
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs: Date.now() + LEAD_MS,
      fireOffsets: [{ orderIndex: 1, offsetMs: 60_000, userId: 11 }],
    });
    gateway.emitCountdownStop('g1');

    const late = makeSocket('late');
    gateway.handleConnection(late);
    expect(snapshotsOf(late)).toHaveLength(0);
  });

  it('삭제된 그룹의 잔여 상태가 새 접속자에게 새지 않는다', () => {
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs: Date.now() + LEAD_MS,
      fireOffsets: [{ orderIndex: 1, offsetMs: 60_000, userId: 11 }],
    });
    gateway.emitGroupRemoved('g1');

    const late = makeSocket('late');
    gateway.handleConnection(late);
    expect(snapshotsOf(late)).toHaveLength(0);
  });

  it('마지막 슬롯까지 지난 스냅샷은 만료되어 보내지 않는다 (경계 수치)', () => {
    const base = 1_800_000_000_000;
    jest.useFakeTimers().setSystemTime(base);
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs: base,
      fireOffsets: [
        { orderIndex: 1, offsetMs: 0, userId: 11 },
        { orderIndex: 2, offsetMs: 30_000, userId: 12 },
      ],
    });

    // 마지막 슬롯 시각 정각 — 아직 만료 아님
    jest.setSystemTime(base + 30_000);
    const onTime = makeSocket('onTime');
    gateway.handleConnection(onTime);
    expect(snapshotsOf(onTime)).toHaveLength(1);

    // 1ms 지남 — 만료
    jest.setSystemTime(base + 30_001);
    const tooLate = makeSocket('tooLate');
    gateway.handleConnection(tooLate);
    expect(snapshotsOf(tooLate)).toHaveLength(0);
  });

  it('스냅샷은 접속한 소켓에만 보내고 전체 broadcast 하지 않는다', () => {
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs: Date.now() + LEAD_MS,
      fireOffsets: [{ orderIndex: 1, offsetMs: 60_000, userId: 11 }],
    });
    server.emit.mockClear();

    const late = makeSocket('late');
    gateway.handleConnection(late);

    expect(snapshotsOf(late)).toHaveLength(1);
    expect(server.emit).not.toHaveBeenCalled();
  });

  it('행군시간 변경으로 재계산되면 최신 페이로드만 스냅샷으로 남는다', () => {
    const startedAtServerMs = Date.now() + LEAD_MS;
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs,
      fireOffsets: [{ orderIndex: 1, offsetMs: 60_000, userId: 11 }],
    });
    const recomputed: FireOffset[] = [
      { orderIndex: 1, offsetMs: 0, userId: 11 },
      { orderIndex: 2, offsetMs: 90_000, userId: 12 },
    ];
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs,
      fireOffsets: recomputed,
    });

    const late = makeSocket('late');
    gateway.handleConnection(late);

    const snapshots = snapshotsOf(late);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].fireOffsets).toEqual(recomputed);
  });

  it('토큰이 없거나 무효한 소켓에는 스냅샷을 보내지 않는다', () => {
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs: Date.now() + LEAD_MS,
      fireOffsets: [{ orderIndex: 1, offsetMs: 60_000, userId: 11 }],
    });

    const noCookie = makeSocketWithoutCookie('noCookie');
    gateway.handleConnection(noCookie);
    expect(noCookie.emit).not.toHaveBeenCalled();

    const badToken = makeSocket('badToken', 'forged');
    gateway.handleConnection(badToken);
    expect(badToken.emit).not.toHaveBeenCalled();

    // 인증 실패 시에도 이 게이트웨이는 소켓을 끊지 않는다 — 끊는 책임은
    // RealtimeGateway/ChatGateway/OperationBoardsGateway 쪽에 있다.
    expect(noCookie.disconnect).not.toHaveBeenCalled();
    expect(badToken.disconnect).not.toHaveBeenCalled();
  });

  it('접속 처리는 동기로 끝나고 사용자 조회를 하지 않는다', () => {
    // 100명 동시 재접속 부하를 키우지 않기 위한 계약이다.
    // 공유 인증 서비스를 쓰더라도 이 경로는 서명 검증(동기)까지만 해야 한다.
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs: Date.now() + LEAD_MS,
      fireOffsets: [{ orderIndex: 1, offsetMs: 60_000, userId: 11 }],
    });

    const socket = makeSocket('live');
    const returned = gateway.handleConnection(socket);

    expect(returned).toBeUndefined();
    expect(socket.emit).toHaveBeenCalledWith(START_EVENT, expect.anything());
    expect(findById).not.toHaveBeenCalled();
  });

  // 소켓만 끊겼다 붙은 클라이언트는 스토어의 group.state가 'idle'로 남아 있어
  // 카운트다운 페이로드만 받아서는 running으로 렌더되지 않는다.
  // (web/src/components/Battle/RallyGroupPanel.jsx: running = g.state === 'running' && !!countdown)
  describe('진행 중 그룹 상태 동반 전송', () => {
    it('진행 중이면 카운트다운 스냅샷보다 먼저 running 그룹 상태를 보낸다', () => {
      const startedAtServerMs = Date.now() + LEAD_MS;
      gateway.emitGroupUpdated(makeGroup('g1', 'running'));
      gateway.emitCountdownStart({
        groupId: 'g1',
        startedAtServerMs,
        fireOffsets: [{ orderIndex: 1, offsetMs: 60_000, userId: 11 }],
      });

      const late = makeSocket('late');
      gateway.handleConnection(late);

      expect(groupUpdatesOf(late)).toEqual([
        expect.objectContaining({ id: 'g1', state: 'running' }),
      ]);
      expect(snapshotsOf(late)).toHaveLength(1);
      // 그룹 상태가 먼저 도착해야 스냅샷이 도착한 시점에 running으로 렌더된다
      expect(late.emit.mock.calls.map(([event]) => event)).toEqual([
        UPDATED_EVENT,
        START_EVENT,
      ]);
    });

    it('idle 그룹의 상태는 재접속자에게 재전송하지 않는다', () => {
      gateway.emitGroupUpdated(makeGroup('g1', 'idle'));

      const late = makeSocket('late');
      gateway.handleConnection(late);
      expect(late.emit).not.toHaveBeenCalled();
    });

    it('정지되면 running 그룹 상태 캐시도 함께 비워진다', () => {
      gateway.emitGroupUpdated(makeGroup('g1', 'running'));
      gateway.emitCountdownStart({
        groupId: 'g1',
        startedAtServerMs: Date.now() + LEAD_MS,
        fireOffsets: [{ orderIndex: 1, offsetMs: 60_000, userId: 11 }],
      });
      // 실제 stopCountdown 순서: emitCountdownStop → emitGroupUpdated(state: idle)
      gateway.emitCountdownStop('g1');
      gateway.emitGroupUpdated(makeGroup('g1', 'idle'));

      const late = makeSocket('late');
      gateway.handleConnection(late);
      expect(late.emit).not.toHaveBeenCalled();
    });

    it('삭제된 그룹의 캐시된 상태도 새 접속자에게 새지 않는다', () => {
      gateway.emitGroupUpdated(makeGroup('g1', 'running'));
      gateway.emitCountdownStart({
        groupId: 'g1',
        startedAtServerMs: Date.now() + LEAD_MS,
        fireOffsets: [{ orderIndex: 1, offsetMs: 60_000, userId: 11 }],
      });
      gateway.emitGroupRemoved('g1');

      const late = makeSocket('late');
      gateway.handleConnection(late);
      expect(late.emit).not.toHaveBeenCalled();
    });

    it('스냅샷이 만료됐으면 그룹 상태도 재전송하지 않는다', () => {
      const base = 1_800_000_000_000;
      jest.useFakeTimers().setSystemTime(base);
      gateway.emitGroupUpdated(makeGroup('g1', 'running'));
      gateway.emitCountdownStart({
        groupId: 'g1',
        startedAtServerMs: base,
        fireOffsets: [{ orderIndex: 1, offsetMs: 30_000, userId: 11 }],
      });

      jest.setSystemTime(base + 30_001);
      const late = makeSocket('late');
      gateway.handleConnection(late);
      expect(late.emit).not.toHaveBeenCalled();
    });
  });

  it('handleConnection은 동기 — 재연결 폭주 시 DB 조회나 await가 없다', () => {
    gateway.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs: Date.now() + LEAD_MS,
      fireOffsets: [{ orderIndex: 1, offsetMs: 60_000, userId: 11 }],
    });
    const late = makeSocket('late');
    // Promise를 반환하면 비동기 I/O가 끼어든 것 — 동기 반환(undefined)이어야 한다.
    expect(gateway.handleConnection(late)).toBeUndefined();
    expect(snapshotsOf(late)).toHaveLength(1);
  });
});
