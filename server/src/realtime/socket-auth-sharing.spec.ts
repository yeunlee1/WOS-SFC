// 소켓 1건에 대해 네 게이트웨이가 인증을 한 번만 수행하는지, 인증 실패 시 각자의
// 기존 동작이 그대로인지 검증한다.
//
// 네 게이트웨이는 모두 네임스페이스 없는 @WebSocketGateway 라서 Nest가 같은 소켓에
// 대해 네 개의 handleConnection 을 모두 부른다(2026-08-27 실제 소켓으로 실측 —
// findById 3회, jwt.verify 4회). 여기서는 그 호출 순서를 그대로 재현해 공유가
// 실제로 되는지 본다.
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { SocketAuthService } from './socket-auth.service';
import { ReadyNegotiationService } from './ready-negotiation.service';
import { WsRateLimitService } from './ws-rate-limit.service';
import { BusyLockService } from './busy-lock.service';
import { RealtimeGateway } from './realtime.gateway';
import { UsersService } from '../users/users.service';
import { User } from '../users/users.entity';
import { NoticesService } from '../notices/notices.service';
import { RalliesService } from '../rallies/rallies.service';
import { MembersService } from '../members/members.service';
import { BoardsService } from '../boards/boards.service';
import { AllianceNoticesService } from '../alliance-notices/alliance-notices.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatService } from '../chat/chat.service';
import { OperationBoardsGateway } from '../operation-boards/operation-boards.gateway';
import { RallyGroupsGateway } from '../rally-groups/rally-groups.gateway';

const ADMIN = {
  id: 1,
  nickname: 'admin1',
  allianceName: 'KOR',
  language: 'ko',
  role: 'admin',
} as User;

type SocketMock = Socket & { emit: jest.Mock; disconnect: jest.Mock };

function makeSocket(id: string, token = 'valid'): SocketMock {
  return {
    id,
    connected: true,
    handshake: { headers: { cookie: `access_token=${token}` } },
    data: {},
    emit: jest.fn(),
    disconnect: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
  } as unknown as SocketMock;
}

function makeServer(): Server {
  return {
    emit: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
    sockets: { sockets: new Map() },
  } as unknown as Server;
}

/** 소켓이 받은 이벤트 이름 목록. */
function emittedEvents(socket: SocketMock): string[] {
  return (socket.emit.mock.calls as unknown as Array<[string]>).map(
    ([event]) => event,
  );
}

describe('소켓 1건의 인증 공유', () => {
  let jwtService: { verify: jest.Mock };
  let usersService: { findById: jest.Mock };
  let socketAuth: SocketAuthService;
  let realtime: RealtimeGateway;
  let chat: ChatGateway;
  let operationBoards: OperationBoardsGateway;
  let rallyGroups: RallyGroupsGateway;

  beforeEach(() => {
    jwtService = {
      verify: jest.fn((token: string) => {
        if (token === 'valid') return { sub: ADMIN.id };
        throw new Error('invalid token');
      }),
    };
    usersService = { findById: jest.fn().mockResolvedValue(ADMIN) };
    socketAuth = new SocketAuthService(
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService,
    );

    realtime = new RealtimeGateway(
      socketAuth,
      { negotiateStartedAt: jest.fn() } as unknown as ReadyNegotiationService,
      new WsRateLimitService(),
      new BusyLockService(),
      { findAll: jest.fn().mockResolvedValue([]) } as unknown as NoticesService,
      { findAll: jest.fn().mockResolvedValue([]) } as unknown as RalliesService,
      { findAll: jest.fn().mockResolvedValue([]) } as unknown as MembersService,
      {
        findAllGrouped: jest.fn().mockResolvedValue({}),
      } as unknown as BoardsService,
      {
        findByAlliance: jest.fn().mockResolvedValue([]),
      } as unknown as AllianceNoticesService,
    );
    chat = new ChatGateway(
      socketAuth,
      {
        getRecentMessages: jest.fn().mockResolvedValue([]),
        saveMessage: jest.fn(),
      } as unknown as ChatService,
      new WsRateLimitService(),
    );
    operationBoards = new OperationBoardsGateway(
      socketAuth,
      new WsRateLimitService(),
    );
    rallyGroups = new RallyGroupsGateway(socketAuth);

    realtime.server = makeServer();
    chat.server = makeServer();
    operationBoards.server = makeServer();
    rallyGroups.server = makeServer();
  });

  /**
   * Nest가 하는 것과 같이 같은 tick에 네 handleConnection을 모두 띄운다.
   * 호출 순서도 실측한 순서(realtime → chat → operation-boards → rally-groups)를 따른다.
   * RallyGroupsGateway만 동기라 Promise 묶음에 넣지 않는다.
   */
  function connectAll(socket: SocketMock): Promise<unknown[]> {
    const pending = [
      realtime.handleConnection(socket),
      chat.handleConnection(socket),
      operationBoards.handleConnection(socket),
    ];
    rallyGroups.handleConnection(socket);
    return Promise.all(pending);
  }

  it('네 게이트웨이가 붙어도 사용자 조회와 서명 검증은 각각 한 번만 일어난다', async () => {
    await connectAll(makeSocket('s1'));

    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(jwtService.verify).toHaveBeenCalledTimes(1);
  });

  it('한 번의 조회 결과로 네 게이트웨이가 모두 정상 동작한다', async () => {
    const socket = makeSocket('s1');
    rallyGroups.emitCountdownStart({
      groupId: 'g1',
      startedAtServerMs: Date.now() + 10_000,
      fireOffsets: [{ orderIndex: 1, offsetMs: 0, userId: ADMIN.id }],
    });

    await connectAll(socket);

    expect(socket.disconnect).not.toHaveBeenCalled();
    const events = emittedEvents(socket);
    // RealtimeGateway 접속 스냅샷
    expect(events).toContain('countdown:state');
    // ChatGateway 히스토리
    expect(events).toContain('chat:history');
    // RallyGroupsGateway 재접속 복구
    expect(events).toContain('rallyGroup:countdown:start');
    // OperationBoardsGateway 는 접속 시 사용자만 등록한다
    expect(
      (
        operationBoards as unknown as { connectedUsers: Map<string, unknown> }
      ).connectedUsers.has(socket.id),
    ).toBe(true);
  });

  it('접속 뒤 다시 물어봐도 조회가 늘지 않는다', async () => {
    const socket = makeSocket('s1');
    await connectAll(socket);
    await operationBoards.handleJoin(socket, {});

    expect(usersService.findById).toHaveBeenCalledTimes(1);
  });

  it('두 사람이 접속하면 각각 한 번씩 조회한다', async () => {
    await connectAll(makeSocket('s1'));
    await connectAll(makeSocket('s2'));

    expect(usersService.findById).toHaveBeenCalledTimes(2);
  });

  describe('토큰이 유효하지 않을 때 — 게이트웨이별 기존 동작 보존', () => {
    it('세 게이트웨이는 소켓을 끊고 DB는 아예 조회하지 않는다', async () => {
      const socket = makeSocket('s-bad', 'tampered');

      await connectAll(socket);

      expect(usersService.findById).not.toHaveBeenCalled();
      // realtime / chat / operation-boards 세 곳이 각각 disconnect 한다.
      expect(socket.disconnect).toHaveBeenCalledTimes(3);
    });

    it('RallyGroupsGateway 는 끊지 않고 조용히 스냅샷만 보내지 않는다', () => {
      const socket = makeSocket('s-bad', 'tampered');
      rallyGroups.emitCountdownStart({
        groupId: 'g1',
        startedAtServerMs: Date.now() + 10_000,
        fireOffsets: [{ orderIndex: 1, offsetMs: 0, userId: ADMIN.id }],
      });

      rallyGroups.handleConnection(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(emittedEvents(socket)).not.toContain('rallyGroup:countdown:start');
    });

    it('앞 소켓이 인증에 성공했어도 토큰이 다른 소켓은 통과하지 못한다', async () => {
      await connectAll(makeSocket('s-good', 'valid'));
      usersService.findById.mockClear();

      const socket = makeSocket('s-bad', 'tampered');
      await connectAll(socket);

      expect(usersService.findById).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledTimes(3);
      expect(emittedEvents(socket)).not.toContain('chat:history');
    });
  });

  it('사용자 레코드가 사라졌으면 조회 한 번으로 세 게이트웨이가 모두 끊는다', async () => {
    usersService.findById.mockResolvedValue(null);
    const socket = makeSocket('s-gone');

    await connectAll(socket);

    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(3);
  });
});
