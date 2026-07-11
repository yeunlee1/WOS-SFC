// 작전판 실시간 게이트웨이의 메모리 상태 계약을 검증한다.
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { OperationBoardsGateway } from './operation-boards.gateway';
import { UsersService } from '../users/users.service';

type JwtPayload = {
  sub: number;
  nickname: string;
  allianceName?: string;
  role?: string;
};

type ServerMock = Server & {
  emit: jest.Mock;
};

type SocketMock = Socket & {
  emit: jest.Mock;
  disconnect: jest.Mock;
};

const ADMIN_PAYLOAD: JwtPayload = {
  sub: 1,
  nickname: 'adminKo',
  allianceName: 'KOR',
  role: 'admin',
};

const MEMBER_PAYLOAD: JwtPayload = {
  sub: 2,
  nickname: 'memberKo',
  allianceName: 'NSL',
  role: 'member',
};

function makeServer(): ServerMock {
  return {
    emit: jest.fn(),
  } as unknown as ServerMock;
}

function makeSocket(id: string, token = id): SocketMock {
  return {
    id,
    connected: true,
    handshake: {
      headers: { cookie: `access_token=${encodeURIComponent(token)}` },
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as SocketMock;
}

describe('OperationBoardsGateway', () => {
  let jwtService: { verify: jest.Mock<JwtPayload, [string]> };
  let usersService: { findById: jest.Mock };
  let gateway: OperationBoardsGateway;
  let server: ServerMock;
  let adminSocket: SocketMock;
  let memberSocket: SocketMock;

  beforeEach(() => {
    jwtService = {
      verify: jest.fn((token: string) => {
        if (token === 'admin') return ADMIN_PAYLOAD;
        if (token === 'member') return MEMBER_PAYLOAD;
        throw new Error('invalid token');
      }),
    };
    usersService = {
      findById: jest.fn((id: number) =>
        id === ADMIN_PAYLOAD.sub
          ? {
              id,
              nickname: ADMIN_PAYLOAD.nickname,
              allianceName: ADMIN_PAYLOAD.allianceName,
              role: ADMIN_PAYLOAD.role,
            }
          : {
              id,
              nickname: MEMBER_PAYLOAD.nickname,
              allianceName: MEMBER_PAYLOAD.allianceName,
              role: MEMBER_PAYLOAD.role,
            },
      ),
    };
    gateway = new OperationBoardsGateway(
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService,
    );
    server = makeServer();
    gateway.server = server;
    adminSocket = makeSocket('s-admin', 'admin');
    memberSocket = makeSocket('s-member', 'member');
  });

  it('authenticates connection cookies but only joined operation-board tabs appear in presence', async () => {
    await gateway.handleConnection(adminSocket);

    expect(adminSocket.disconnect).not.toHaveBeenCalled();
    expect(server.emit).not.toHaveBeenCalledWith(
      'operation:presence',
      expect.anything(),
    );

    const ack = await gateway.handleJoin(adminSocket, { chatOpen: true });

    expect(ack).toEqual({ ok: true });
    expect(adminSocket.emit).toHaveBeenCalledWith('operation:state', {
      elements: [],
      background: { type: 'grid', imageUrl: null },
      participants: [
        {
          participantId: 's-admin',
          nickname: 'adminKo',
          alliance: 'KOR',
          role: 'admin',
          canDraw: true,
          chatOpen: true,
        },
      ],
      canDraw: true,
    });
    expect(server.emit).toHaveBeenCalledWith('operation:presence', [
      {
        participantId: 's-admin',
        nickname: 'adminKo',
        alliance: 'KOR',
        role: 'admin',
        canDraw: true,
        chatOpen: true,
      },
    ]);
  });

  it('disconnects sockets with invalid access_token cookies', async () => {
    const socket = makeSocket('s-invalid', 'bad-token');

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('DB 조회 중 disconnect되면 유령 연결 사용자를 등록하지 않는다', async () => {
    const socket = makeSocket('s-race', 'admin');
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

    const connecting = gateway.handleConnection(socket);
    (socket as unknown as { connected: boolean }).connected = false;
    gateway.handleDisconnect(socket);
    server.emit.mockClear();

    resolveUser({
      id: 1,
      nickname: 'adminKo',
      allianceName: 'KOR',
      role: 'admin',
    });
    await connecting;

    const connectedUsers = (
      gateway as unknown as {
        connectedUsers: Map<string, unknown>;
      }
    ).connectedUsers;
    expect(connectedUsers.has(socket.id)).toBe(false);
    expect(socket.emit).not.toHaveBeenCalled();
    expect(server.emit).not.toHaveBeenCalled();
  });

  it('operation:join 인증 조회 중 disconnect되면 사용자와 참가자를 등록하지 않는다', async () => {
    const socket = makeSocket('s-join-race', 'admin');
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

    const joining = gateway.handleJoin(socket, { chatOpen: true });
    (socket as unknown as { connected: boolean }).connected = false;
    gateway.handleDisconnect(socket);
    server.emit.mockClear();

    resolveUser({
      id: 1,
      nickname: 'adminKo',
      allianceName: 'KOR',
      role: 'admin',
    });
    await expect(joining).resolves.toEqual({ ok: false });

    const state = gateway as unknown as {
      connectedUsers: Map<string, unknown>;
      participants: Map<string, unknown>;
    };
    expect(state.connectedUsers.has(socket.id)).toBe(false);
    expect(state.participants.has(socket.id)).toBe(false);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(server.emit).not.toHaveBeenCalled();
  });

  it('keeps non-admin draw permission per joined session and drops it on disconnect', async () => {
    await gateway.handleJoin(adminSocket, {});
    await gateway.handleJoin(memberSocket, { chatOpen: false });

    expect(gateway.handleElementAdd(memberSocket, { id: 'e1' })).toEqual({
      ok: false,
    });
    expect(server.emit).not.toHaveBeenCalledWith(
      'operation:element:add',
      expect.anything(),
    );

    const permissionAck = gateway.handlePermissionUpdate(adminSocket, {
      participantId: memberSocket.id,
      canDraw: true,
    });

    expect(permissionAck).toEqual({ ok: true });
    expect(server.emit).toHaveBeenCalledWith(
      'operation:presence',
      expect.arrayContaining([
        expect.objectContaining({
          nickname: 'memberKo',
          canDraw: true,
        }),
      ]),
    );

    const drawAck = gateway.handleElementAdd(memberSocket, {
      id: 'e1',
      type: 'text',
      text: '집결',
    });

    expect(drawAck).toEqual({ ok: true });
    expect(server.emit).toHaveBeenCalledWith('operation:element:add', {
      id: 'e1',
      type: 'text',
      text: '집결',
    });

    gateway.handleDisconnect(memberSocket);
    server.emit.mockClear();

    const reconnectedMember = makeSocket('s-member-2', 'member');
    await gateway.handleJoin(reconnectedMember, {});

    expect(reconnectedMember.emit).toHaveBeenCalledWith(
      'operation:state',
      expect.objectContaining({ canDraw: false }),
    );
    expect(gateway.handleElementAdd(reconnectedMember, { id: 'e2' })).toEqual({
      ok: false,
    });
    expect(server.emit).not.toHaveBeenCalledWith(
      'operation:element:add',
      expect.anything(),
    );
  });

  it('grants draw permission only to the matching participantId for duplicate nicknames', async () => {
    const secondMemberSocket = makeSocket('s-member-2', 'member');
    await gateway.handleJoin(adminSocket, {});
    await gateway.handleJoin(memberSocket, {});
    await gateway.handleJoin(secondMemberSocket, {});
    server.emit.mockClear();

    const permissionAck = gateway.handlePermissionUpdate(adminSocket, {
      participantId: memberSocket.id,
      canDraw: true,
    });

    expect(permissionAck).toEqual({ ok: true });
    expect(
      gateway.handleElementAdd(memberSocket, { id: 'e1', type: 'marker' }),
    ).toEqual({ ok: true });
    expect(
      gateway.handleElementAdd(secondMemberSocket, {
        id: 'e2',
        type: 'marker',
      }),
    ).toEqual({ ok: false });
    expect(server.emit).toHaveBeenCalledWith(
      'operation:presence',
      expect.arrayContaining([
        expect.objectContaining({
          participantId: 's-member',
          nickname: 'memberKo',
          canDraw: true,
        }),
        expect.objectContaining({
          participantId: 's-member-2',
          nickname: 'memberKo',
          canDraw: false,
        }),
      ]),
    );
    expect(server.emit).toHaveBeenCalledWith('operation:element:add', {
      id: 'e1',
      type: 'marker',
    });
    expect(server.emit).not.toHaveBeenCalledWith('operation:element:add', {
      id: 'e2',
      type: 'marker',
    });
  });

  it('removes joined presence and temporary draw permission on operation:leave', async () => {
    await gateway.handleJoin(adminSocket, {});
    await gateway.handleJoin(memberSocket, {});
    gateway.handlePermissionUpdate(adminSocket, {
      participantId: memberSocket.id,
      canDraw: true,
    });
    expect(
      gateway.handleElementAdd(memberSocket, { id: 'e1', type: 'marker' }),
    ).toEqual({ ok: true });
    server.emit.mockClear();

    const gatewayWithLeave = gateway as unknown as {
      handleLeave?: (client: Socket) => { ok: boolean };
    };
    expect(gatewayWithLeave.handleLeave).toBeDefined();
    expect(gatewayWithLeave.handleLeave?.(memberSocket)).toEqual({ ok: true });
    expect(server.emit).toHaveBeenCalledWith(
      'operation:presence',
      expect.not.arrayContaining([
        expect.objectContaining({ participantId: 's-member' }),
      ]),
    );

    server.emit.mockClear();
    await gateway.handleJoin(memberSocket, {});

    expect(memberSocket.emit).toHaveBeenLastCalledWith(
      'operation:state',
      expect.objectContaining({ canDraw: false }),
    );
    expect(
      gateway.handleElementAdd(memberSocket, { id: 'e2', type: 'marker' }),
    ).toEqual({ ok: false });
    expect(server.emit).not.toHaveBeenCalledWith(
      'operation:element:add',
      expect.anything(),
    );
  });

  it('allows only admin or developer participants to change draw permission', async () => {
    await gateway.handleJoin(memberSocket, {});

    const ack = gateway.handlePermissionUpdate(memberSocket, {
      participantId: memberSocket.id,
      canDraw: true,
    });

    expect(ack).toEqual({ ok: false });
    expect(server.emit).not.toHaveBeenCalledWith(
      'operation:presence',
      expect.arrayContaining([
        expect.objectContaining({ nickname: 'memberKo', canDraw: true }),
      ]),
    );
  });

  it('rejects management events from members even when they have draw permission', async () => {
    await gateway.handleJoin(adminSocket, {});
    await gateway.handleJoin(memberSocket, {});
    gateway.handlePermissionUpdate(adminSocket, {
      participantId: memberSocket.id,
      canDraw: true,
    });
    server.emit.mockClear();

    expect(gateway.handleClear(memberSocket)).toEqual({ ok: false });
    expect(
      gateway.handleBackgroundUpdate(memberSocket, {
        type: 'image',
        imageUrl:
          '/uploads/operation-boards/1760000000000-123e4567-e89b-12d3-a456-426614174000.webp',
      }),
    ).toEqual({ ok: false });
    expect(server.emit).not.toHaveBeenCalledWith('operation:clear');
    expect(server.emit).not.toHaveBeenCalledWith(
      'operation:background:update',
      expect.anything(),
    );
  });

  it('reflects chat-open changes in operation-board presence', async () => {
    await gateway.handleJoin(memberSocket, { chatOpen: false });
    server.emit.mockClear();

    const ack = gateway.handleChatOpen(memberSocket, { chatOpen: true });

    expect(ack).toEqual({ ok: true });
    expect(server.emit).toHaveBeenCalledWith('operation:presence', [
      {
        participantId: 's-member',
        nickname: 'memberKo',
        alliance: 'NSL',
        role: 'member',
        canDraw: false,
        chatOpen: true,
      },
    ]);
  });

  it('rejects oversized, invalid, or nested elements and broadcasts sanitized shallow elements', async () => {
    await gateway.handleJoin(adminSocket, {});
    server.emit.mockClear();

    expect(
      gateway.handleElementAdd(adminSocket, {
        id: 'e-safe',
        type: 'text',
        x: 10,
        y: 20,
        text: '집결',
        color: '#ffcc00',
        label: 'main',
        opacity: 0.7,
        locked: false,
      }),
    ).toEqual({ ok: true });
    expect(server.emit).toHaveBeenCalledWith('operation:element:add', {
      id: 'e-safe',
      type: 'text',
      x: 10,
      y: 20,
      text: '집결',
      color: '#ffcc00',
      label: 'main',
      opacity: 0.7,
      locked: false,
    });

    server.emit.mockClear();

    expect(
      gateway.handleElementAdd(adminSocket, {
        id: 'e-points',
        type: 'path',
        points: [{ x: 1, y: 2 }],
      }),
    ).toEqual({ ok: false });
    expect(
      gateway.handleElementAdd(adminSocket, {
        id: 'e-meta',
        type: 'marker',
        meta: { nested: true },
      }),
    ).toEqual({ ok: false });
    expect(
      gateway.handleElementAdd(adminSocket, {
        id: 'e-oversized',
        type: 'text',
        note: 'x'.repeat(21 * 1024),
      }),
    ).toEqual({ ok: false });
    expect(
      gateway.handleElementAdd(adminSocket, {
        id: 'e-unknown',
        type: 'freehand',
      }),
    ).toEqual({ ok: false });
    expect(
      gateway.handleElementAdd(adminSocket, {
        id: 'x'.repeat(81),
        type: 'marker',
      }),
    ).toEqual({ ok: false });
    expect(server.emit).not.toHaveBeenCalledWith(
      'operation:element:add',
      expect.anything(),
    );
  });

  it('broadcasts accepted drawing mutations and keeps at most 500 live elements', async () => {
    await gateway.handleJoin(adminSocket, {});

    for (let index = 0; index < 501; index++) {
      expect(
        gateway.handleElementAdd(adminSocket, {
          id: `e${index}`,
          type: 'marker',
        }),
      ).toEqual({ ok: true });
    }

    const latestStateSocket = makeSocket('s-latest-admin', 'admin');
    await gateway.handleJoin(latestStateSocket, {});

    expect(latestStateSocket.emit).toHaveBeenCalledWith(
      'operation:state',
      expect.objectContaining({
        elements: expect.arrayContaining([
          { id: 'e1', type: 'marker' },
          { id: 'e500', type: 'marker' },
        ]),
      }),
    );
    const latestState = latestStateSocket.emit.mock.calls.find(
      (call) => call[0] === 'operation:state',
    )?.[1] as { elements: Array<{ id: string }> };
    expect(latestState.elements).toHaveLength(500);
    expect(latestState.elements.some((element) => element.id === 'e0')).toBe(
      false,
    );

    expect(gateway.handleElementRemove(adminSocket, { id: 'e500' })).toEqual({
      ok: true,
    });
    expect(server.emit).toHaveBeenCalledWith('operation:element:remove', {
      id: 'e500',
    });

    expect(gateway.handleClear(adminSocket)).toEqual({ ok: true });
    expect(server.emit).toHaveBeenCalledWith('operation:clear');
  });

  it('normalizes background updates before broadcasting', async () => {
    await gateway.handleJoin(adminSocket, {});

    expect(
      gateway.handleBackgroundUpdate(adminSocket, {
        type: 'image',
        imageUrl:
          '/uploads/operation-boards/1760000000000-123e4567-e89b-12d3-a456-426614174000.webp',
      }),
    ).toEqual({ ok: true });
    expect(server.emit).toHaveBeenCalledWith('operation:background:update', {
      type: 'image',
      imageUrl:
        '/uploads/operation-boards/1760000000000-123e4567-e89b-12d3-a456-426614174000.webp',
    });

    expect(
      gateway.handleBackgroundUpdate(adminSocket, {
        type: 'grid',
        imageUrl: '/ignored.webp',
      }),
    ).toEqual({ ok: true });
    expect(server.emit).toHaveBeenCalledWith('operation:background:update', {
      type: 'grid',
      imageUrl: null,
    });
  });

  it('rejects invalid or oversized operation-board background image URLs', async () => {
    await gateway.handleJoin(adminSocket, {});
    server.emit.mockClear();

    expect(
      gateway.handleBackgroundUpdate(adminSocket, {
        type: 'image',
        imageUrl: 'https://example.test/map.webp',
      }),
    ).toEqual({ ok: false });
    expect(
      gateway.handleBackgroundUpdate(adminSocket, {
        type: 'image',
        imageUrl: '/uploads/not-operation-boards/map.webp',
      }),
    ).toEqual({ ok: false });
    expect(
      gateway.handleBackgroundUpdate(adminSocket, {
        type: 'image',
        imageUrl: `/uploads/operation-boards/${'x'.repeat(260)}`,
      }),
    ).toEqual({ ok: false });
    expect(server.emit).not.toHaveBeenCalledWith(
      'operation:background:update',
      expect.anything(),
    );
  });
});
