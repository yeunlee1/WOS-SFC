// 작전판 실시간 게이트웨이의 메모리 상태 계약을 검증한다.
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { OperationBoardsGateway } from './operation-boards.gateway';

type JwtPayload = {
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
  nickname: 'adminKo',
  allianceName: 'KOR',
  role: 'admin',
};

const MEMBER_PAYLOAD: JwtPayload = {
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
    handshake: {
      headers: { cookie: `access_token=${encodeURIComponent(token)}` },
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as SocketMock;
}

describe('OperationBoardsGateway', () => {
  let jwtService: { verify: jest.Mock<JwtPayload, [string]> };
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
    gateway = new OperationBoardsGateway(
      jwtService as unknown as JwtService,
    );
    server = makeServer();
    gateway.server = server;
    adminSocket = makeSocket('s-admin', 'admin');
    memberSocket = makeSocket('s-member', 'member');
  });

  it('authenticates connection cookies but only joined operation-board tabs appear in presence', () => {
    gateway.handleConnection(adminSocket);

    expect(adminSocket.disconnect).not.toHaveBeenCalled();
    expect(server.emit).not.toHaveBeenCalledWith(
      'operation:presence',
      expect.anything(),
    );

    const ack = gateway.handleJoin(adminSocket, { chatOpen: true });

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

  it('disconnects sockets with invalid access_token cookies', () => {
    const socket = makeSocket('s-invalid', 'bad-token');

    gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps non-admin draw permission per joined session and drops it on disconnect', () => {
    gateway.handleJoin(adminSocket, {});
    gateway.handleJoin(memberSocket, { chatOpen: false });

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
    gateway.handleJoin(reconnectedMember, {});

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

  it('grants draw permission only to the matching participantId for duplicate nicknames', () => {
    const secondMemberSocket = makeSocket('s-member-2', 'member');
    gateway.handleJoin(adminSocket, {});
    gateway.handleJoin(memberSocket, {});
    gateway.handleJoin(secondMemberSocket, {});
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

  it('removes joined presence and temporary draw permission on operation:leave', () => {
    gateway.handleJoin(adminSocket, {});
    gateway.handleJoin(memberSocket, {});
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
    gateway.handleJoin(memberSocket, {});

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

  it('allows only admin or developer participants to change draw permission', () => {
    gateway.handleJoin(memberSocket, {});

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

  it('reflects chat-open changes in operation-board presence', () => {
    gateway.handleJoin(memberSocket, { chatOpen: false });
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

  it('rejects oversized or invalid elements and broadcasts sanitized shallow elements', () => {
    gateway.handleJoin(adminSocket, {});
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
        points: [{ x: 1, y: 2 }],
        meta: { nested: true },
        opacity: Number.POSITIVE_INFINITY,
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
    });

    server.emit.mockClear();

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

  it('broadcasts accepted drawing mutations and keeps at most 500 live elements', () => {
    gateway.handleJoin(adminSocket, {});

    for (let index = 0; index < 501; index++) {
      expect(
        gateway.handleElementAdd(adminSocket, {
          id: `e${index}`,
          type: 'marker',
        }),
      ).toEqual({ ok: true });
    }

    const latestStateSocket = makeSocket('s-latest-admin', 'admin');
    gateway.handleJoin(latestStateSocket, {});

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

  it('normalizes background updates before broadcasting', () => {
    gateway.handleJoin(adminSocket, {});

    expect(
      gateway.handleBackgroundUpdate(adminSocket, {
        type: 'image',
        imageUrl: '/uploads/operation-boards/map.webp',
      }),
    ).toEqual({ ok: true });
    expect(server.emit).toHaveBeenCalledWith('operation:background:update', {
      type: 'image',
      imageUrl: '/uploads/operation-boards/map.webp',
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

  it('rejects invalid or oversized operation-board background image URLs', () => {
    gateway.handleJoin(adminSocket, {});
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
