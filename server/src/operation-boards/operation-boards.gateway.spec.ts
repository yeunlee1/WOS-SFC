// 작전판 실시간 게이트웨이의 메모리 상태 계약을 검증한다.
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import {
  OPERATION_BOARD_ROOM,
  OPERATION_REJECT_REASONS,
  OperationBoardsGateway,
  PRESENCE_COALESCE_MS,
} from './operation-boards.gateway';
import { UsersService } from '../users/users.service';
import { SocketAuthService } from '../realtime/socket-auth.service';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import { MAX_OPERATION_ELEMENTS } from './operation-board-elements';

type JwtPayload = {
  sub: number;
  nickname: string;
  allianceName?: string;
  role?: string;
};

type ServerMock = Server & {
  emit: jest.Mock;
  to: jest.Mock;
  roomEmit: jest.Mock;
};

type SocketMock = Socket & {
  emit: jest.Mock;
  disconnect: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
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
  const roomEmit = jest.fn();
  const to = jest.fn(() => ({ emit: roomEmit }));
  return {
    emit: jest.fn(),
    to,
    roomEmit,
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
    join: jest.fn(),
    leave: jest.fn(),
  } as unknown as SocketMock;
}

/**
 * 요청 제한 창을 넘겨 가며 대량으로 요소를 추가한다.
 * 요청 제한 자체는 별도 테스트에서 검증하고, 여기서는 총량 상한만 보기 위해 시간을 밀어 준다.
 */
function withAdvancingClock<T>(run: (advance: (ms: number) => void) => T): T {
  const base = Date.now();
  let offset = 0;
  const spy = jest.spyOn(Date, 'now').mockImplementation(() => base + offset);
  try {
    return run((ms) => {
      offset += ms;
    });
  } finally {
    spy.mockRestore();
  }
}

type EmittedState = {
  elements: Array<Record<string, unknown>>;
  background: unknown;
  participants: unknown[];
  canDraw: boolean;
  sessionId: string;
};

function lastState(socket: SocketMock): EmittedState {
  const calls = socket.emit.mock.calls as unknown as Array<
    [string, EmittedState]
  >;
  const call = [...calls]
    .reverse()
    .find(([event]) => event === 'operation:state');
  return call?.[1] as EmittedState;
}

describe('OperationBoardsGateway', () => {
  /** 코얼레싱 창이 닫힐 때까지 실제 시간으로 기다린다. */
  async function flushPresence(): Promise<void> {
    await new Promise((resolve) =>
      setTimeout(resolve, PRESENCE_COALESCE_MS + 30),
    );
  }

  /** 지금까지 나간 operation:presence 브로드캐스트의 페이로드 목록. */
  function presenceCalls(): unknown[][] {
    const calls = server.roomEmit.mock.calls as unknown as Array<
      [string, unknown[]]
    >;
    return calls
      .filter(([event]) => event === 'operation:presence')
      .map(([, payload]) => payload);
  }

  let jwtService: { verify: jest.Mock<JwtPayload, [string]> };
  let usersService: { findById: jest.Mock };
  let rateLimit: WsRateLimitService;
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
    rateLimit = new WsRateLimitService();
    gateway = new OperationBoardsGateway(
      new SocketAuthService(
        jwtService as unknown as JwtService,
        usersService as unknown as UsersService,
      ),
      rateLimit,
    );
    server = makeServer();
    gateway.server = server;
    adminSocket = makeSocket('s-admin', 'admin');
    memberSocket = makeSocket('s-member', 'member');
  });

  it('authenticates connection cookies but only joined operation-board tabs appear in presence', async () => {
    await gateway.handleConnection(adminSocket);

    expect(adminSocket.disconnect).not.toHaveBeenCalled();
    expect(server.roomEmit).not.toHaveBeenCalledWith(
      'operation:presence',
      expect.anything(),
    );

    const ack = await gateway.handleJoin(adminSocket, { chatOpen: true });

    expect(ack).toEqual({ ok: true });
    expect(adminSocket.emit).toHaveBeenCalledWith(
      'operation:state',
      expect.objectContaining({
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
      }),
    );

    // presence 는 코얼레싱 창이 닫힐 때 나간다.
    await flushPresence();
    expect(server.roomEmit).toHaveBeenCalledWith('operation:presence', [
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
    server.roomEmit.mockClear();

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
    expect(server.roomEmit).not.toHaveBeenCalled();
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
    server.roomEmit.mockClear();

    resolveUser({
      id: 1,
      nickname: 'adminKo',
      allianceName: 'KOR',
      role: 'admin',
    });
    await expect(joining).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );

    const state = gateway as unknown as {
      connectedUsers: Map<string, unknown>;
      participants: Map<string, unknown>;
    };
    expect(state.connectedUsers.has(socket.id)).toBe(false);
    expect(state.participants.has(socket.id)).toBe(false);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(server.roomEmit).not.toHaveBeenCalled();
  });

  it('keeps non-admin draw permission per joined session and drops it on disconnect', async () => {
    await gateway.handleJoin(adminSocket, {});
    await gateway.handleJoin(memberSocket, { chatOpen: false });

    expect(gateway.handleElementAdd(memberSocket, { id: 'e1' })).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(server.roomEmit).not.toHaveBeenCalledWith(
      'operation:element:add',
      expect.anything(),
    );

    const permissionAck = gateway.handlePermissionUpdate(adminSocket, {
      participantId: memberSocket.id,
      canDraw: true,
    });

    expect(permissionAck).toEqual({ ok: true });

    // presence 는 코얼레싱 창이 닫힐 때 나간다.
    await flushPresence();
    expect(server.roomEmit).toHaveBeenCalledWith(
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
    expect(server.roomEmit).toHaveBeenCalledWith('operation:element:add', {
      id: 'e1',
      type: 'text',
      text: '집결',
    });

    gateway.handleDisconnect(memberSocket);
    server.roomEmit.mockClear();

    const reconnectedMember = makeSocket('s-member-2', 'member');
    await gateway.handleJoin(reconnectedMember, {});

    expect(reconnectedMember.emit).toHaveBeenCalledWith(
      'operation:state',
      expect.objectContaining({ canDraw: false }),
    );
    expect(gateway.handleElementAdd(reconnectedMember, { id: 'e2' })).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(server.roomEmit).not.toHaveBeenCalledWith(
      'operation:element:add',
      expect.anything(),
    );
  });

  it('grants draw permission only to the matching participantId for duplicate nicknames', async () => {
    const secondMemberSocket = makeSocket('s-member-2', 'member');
    await gateway.handleJoin(adminSocket, {});
    await gateway.handleJoin(memberSocket, {});
    await gateway.handleJoin(secondMemberSocket, {});
    server.roomEmit.mockClear();

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
    ).toEqual(expect.objectContaining({ ok: false }));
    // presence 는 코얼레싱 창이 닫힐 때 나간다.
    await flushPresence();
    expect(server.roomEmit).toHaveBeenCalledWith(
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
    expect(server.roomEmit).toHaveBeenCalledWith('operation:element:add', {
      id: 'e1',
      type: 'marker',
    });
    expect(server.roomEmit).not.toHaveBeenCalledWith('operation:element:add', {
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
    await flushPresence();
    server.roomEmit.mockClear();

    expect(gateway.handleLeave(memberSocket)).toEqual({ ok: true });
    expect(memberSocket.leave).toHaveBeenCalledWith(OPERATION_BOARD_ROOM);
    // presence 는 코얼레싱 창이 닫힐 때 나간다.
    await flushPresence();
    expect(server.roomEmit).toHaveBeenCalledWith(
      'operation:presence',
      expect.not.arrayContaining([
        expect.objectContaining({ participantId: 's-member' }),
      ]),
    );

    server.roomEmit.mockClear();
    await gateway.handleJoin(memberSocket, {});

    expect(memberSocket.emit).toHaveBeenLastCalledWith(
      'operation:state',
      expect.objectContaining({ canDraw: false }),
    );
    expect(
      gateway.handleElementAdd(memberSocket, { id: 'e2', type: 'marker' }),
    ).toEqual(expect.objectContaining({ ok: false }));
    expect(server.roomEmit).not.toHaveBeenCalledWith(
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

    expect(ack).toEqual(expect.objectContaining({ ok: false }));
    expect(server.roomEmit).not.toHaveBeenCalledWith(
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
    server.roomEmit.mockClear();

    expect(gateway.handleClear(memberSocket)).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(
      gateway.handleBackgroundUpdate(memberSocket, {
        type: 'image',
        imageUrl:
          '/uploads/operation-boards/1760000000000-123e4567-e89b-12d3-a456-426614174000.webp',
      }),
    ).toEqual(expect.objectContaining({ ok: false }));
    expect(server.roomEmit).not.toHaveBeenCalledWith('operation:clear');
    expect(server.roomEmit).not.toHaveBeenCalledWith(
      'operation:background:update',
      expect.anything(),
    );
  });

  it('reflects chat-open changes in operation-board presence', async () => {
    await gateway.handleJoin(memberSocket, { chatOpen: false });
    await flushPresence();
    server.roomEmit.mockClear();

    const ack = gateway.handleChatOpen(memberSocket, { chatOpen: true });

    expect(ack).toEqual({ ok: true });
    // presence 는 코얼레싱 창이 닫힐 때 나간다.
    await flushPresence();
    expect(server.roomEmit).toHaveBeenCalledWith('operation:presence', [
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

  it('rejects oversized, invalid, nested, or unknown-key elements', async () => {
    await gateway.handleJoin(adminSocket, {});
    server.roomEmit.mockClear();

    expect(
      gateway.handleElementAdd(adminSocket, {
        id: 'e-safe',
        type: 'text',
        x: 10,
        y: 20,
        text: '집결',
        color: '#ffcc00',
      }),
    ).toEqual({ ok: true });
    expect(server.roomEmit).toHaveBeenCalledWith('operation:element:add', {
      id: 'e-safe',
      type: 'text',
      x: 10,
      y: 20,
      text: '집결',
      color: '#ffcc00',
    });

    server.roomEmit.mockClear();

    // 화이트리스트 밖 키는 원시 타입이어도 거절한다.
    for (const bad of [
      { id: 'e-label', type: 'text', label: 'main' },
      { id: 'e-points', type: 'path', points: [{ x: 1, y: 2 }] },
      { id: 'e-meta', type: 'marker', meta: { nested: true } },
      { id: 'e-oversized', type: 'text', note: 'x'.repeat(21 * 1024) },
      { id: 'e-unknown', type: 'freehand' },
      { id: 'x'.repeat(81), type: 'marker' },
    ]) {
      expect(gateway.handleElementAdd(adminSocket, bad)).toEqual({
        ok: false,
        reason: OPERATION_REJECT_REASONS.invalidElement,
      });
    }
    expect(server.roomEmit).not.toHaveBeenCalledWith(
      'operation:element:add',
      expect.anything(),
    );
  });

  it('요소 개수 상한을 넘기면 조용히 자르지 않고 사유와 함께 거절한다', async () => {
    await gateway.handleJoin(adminSocket, {});

    withAdvancingClock((advance) => {
      for (let index = 0; index < MAX_OPERATION_ELEMENTS; index++) {
        if (index % 100 === 0) advance(11_000);
        expect(
          gateway.handleElementAdd(adminSocket, {
            id: `e${index}`,
            type: 'marker',
          }),
        ).toEqual({ ok: true });
      }

      advance(11_000);
      expect(
        gateway.handleElementAdd(adminSocket, {
          id: 'overflow',
          type: 'marker',
        }),
      ).toEqual({
        ok: false,
        reason: OPERATION_REJECT_REASONS.tooManyElements,
      });
    });

    const latestStateSocket = makeSocket('s-latest-admin', 'admin');
    await gateway.handleJoin(latestStateSocket, {});
    const state = lastState(latestStateSocket);

    expect(state.elements).toHaveLength(MAX_OPERATION_ELEMENTS);
    // 가장 오래된 요소를 잘라내지 않는다.
    expect(state.elements.some((element) => element.id === 'e0')).toBe(true);
    expect(state.elements.some((element) => element.id === 'overflow')).toBe(
      false,
    );

    expect(gateway.handleElementRemove(adminSocket, { id: 'e0' })).toEqual({
      ok: true,
    });
    expect(server.roomEmit).toHaveBeenCalledWith('operation:element:remove', {
      id: 'e0',
    });
    // 자리가 나면 다시 받는다.
    expect(
      gateway.handleElementAdd(adminSocket, { id: 'again', type: 'marker' }),
    ).toEqual({ ok: true });

    expect(gateway.handleClear(adminSocket)).toEqual({ ok: true });
    expect(server.roomEmit).toHaveBeenCalledWith('operation:clear');
  });

  it('총 바이트 상한을 넘기면 사유와 함께 거절한다', async () => {
    await gateway.handleJoin(adminSocket, {});

    const rejected = withAdvancingClock((advance) => {
      for (let index = 0; index < MAX_OPERATION_ELEMENTS; index++) {
        if (index % 100 === 0) advance(11_000);
        const ack = gateway.handleElementAdd(adminSocket, {
          id: `e${index}`,
          type: 'text',
          text: '가'.repeat(300),
        });
        if (!ack.ok) return ack;
      }
      return null;
    });

    expect(rejected).toEqual({
      ok: false,
      reason: OPERATION_REJECT_REASONS.tooLarge,
    });
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
    expect(server.roomEmit).toHaveBeenCalledWith(
      'operation:background:update',
      {
        type: 'image',
        imageUrl:
          '/uploads/operation-boards/1760000000000-123e4567-e89b-12d3-a456-426614174000.webp',
      },
    );

    expect(
      gateway.handleBackgroundUpdate(adminSocket, {
        type: 'grid',
        imageUrl: '/ignored.webp',
      }),
    ).toEqual({ ok: true });
    expect(server.roomEmit).toHaveBeenCalledWith(
      'operation:background:update',
      { type: 'grid', imageUrl: null },
    );
  });

  it('rejects invalid or oversized operation-board background image URLs', async () => {
    await gateway.handleJoin(adminSocket, {});
    server.roomEmit.mockClear();

    for (const imageUrl of [
      'https://example.test/map.webp',
      '/uploads/not-operation-boards/map.webp',
      `/uploads/operation-boards/${'x'.repeat(260)}`,
    ]) {
      expect(
        gateway.handleBackgroundUpdate(adminSocket, {
          type: 'image',
          imageUrl,
        }),
      ).toEqual(expect.objectContaining({ ok: false }));
    }
    expect(server.roomEmit).not.toHaveBeenCalledWith(
      'operation:background:update',
      expect.anything(),
    );
  });

  // ── 항목 1: 요청 제한 ──────────────────────────────────────────────
  describe('요청 제한', () => {
    it('정상 드로잉 속도(10초에 40획)는 한 건도 막지 않는다', async () => {
      await gateway.handleJoin(adminSocket, {});

      for (let index = 0; index < 40; index++) {
        expect(
          gateway.handleElementAdd(adminSocket, {
            id: `e${index}`,
            type: 'marker',
          }),
        ).toEqual({ ok: true });
      }
    });

    it('드로잉 폭주는 사유와 함께 막고 브로드캐스트도 멈춘다', async () => {
      await gateway.handleJoin(adminSocket, {});
      // 아래 개수 비교의 +1 은 join 이 만든 presence 1건이다 — 먼저 내보내 놓는다.
      await flushPresence();

      let firstRejectedAt = -1;
      for (let index = 0; index < 400; index++) {
        const ack = gateway.handleElementAdd(adminSocket, {
          id: `e${index}`,
          type: 'marker',
        });
        if (!ack.ok) {
          expect(ack).toEqual({
            ok: false,
            reason: OPERATION_REJECT_REASONS.rateLimited,
          });
          firstRejectedAt = index;
          break;
        }
      }

      expect(firstRejectedAt).toBeGreaterThan(40);
      expect(firstRejectedAt).toBeLessThan(400);
      expect(server.roomEmit).toHaveBeenCalledTimes(firstRejectedAt + 1);
    });

    it('요청 제한은 소켓별로 독립이라 다른 사용자를 막지 않는다', async () => {
      await gateway.handleJoin(adminSocket, {});
      await gateway.handleJoin(memberSocket, {});
      gateway.handlePermissionUpdate(adminSocket, {
        participantId: memberSocket.id,
        canDraw: true,
      });

      for (let index = 0; index < 400; index++) {
        const ack = gateway.handleElementAdd(adminSocket, {
          id: `a${index}`,
          type: 'marker',
        });
        if (!ack.ok) break;
      }

      expect(
        gateway.handleElementAdd(memberSocket, { id: 'm1', type: 'marker' }),
      ).toEqual({ ok: true });
    });

    it('clear 와 background 폭주도 막는다', async () => {
      await gateway.handleJoin(adminSocket, {});

      let clearRejected = false;
      for (let index = 0; index < 60; index++) {
        if (!gateway.handleClear(adminSocket).ok) {
          clearRejected = true;
          break;
        }
      }
      expect(clearRejected).toBe(true);

      let backgroundRejected = false;
      for (let index = 0; index < 120; index++) {
        if (!gateway.handleBackgroundUpdate(adminSocket, { type: 'grid' }).ok) {
          backgroundRejected = true;
          break;
        }
      }
      expect(backgroundRejected).toBe(true);
    });

    it('disconnect 시 요청 제한 버킷을 정리한다', async () => {
      await gateway.handleJoin(adminSocket, {});
      const cleanup = jest.spyOn(rateLimit, 'cleanup');

      gateway.handleDisconnect(adminSocket);

      expect(cleanup).toHaveBeenCalledWith(adminSocket.id);
    });

    it('값이 바뀌지 않은 chat-open 과 권한 변경은 presence 를 다시 뿌리지 않는다', async () => {
      // 훅은 마운트 직후 join 에 이어 같은 값으로 operation:chat-open 을 한 번 더 보낸다.
      // 100명이 접속하면 그 중복만으로 전원 대상 presence 브로드캐스트가 100번 더 생긴다.
      await gateway.handleJoin(adminSocket, { chatOpen: false });
      await gateway.handleJoin(memberSocket, { chatOpen: false });
      await flushPresence();
      server.roomEmit.mockClear();

      expect(gateway.handleChatOpen(memberSocket, { chatOpen: false })).toEqual(
        {
          ok: true,
        },
      );
      await flushPresence();
      expect(server.roomEmit).not.toHaveBeenCalled();

      expect(
        gateway.handlePermissionUpdate(adminSocket, {
          participantId: memberSocket.id,
          canDraw: false,
        }),
      ).toEqual({ ok: true });
      await flushPresence();
      expect(server.roomEmit).not.toHaveBeenCalled();

      // 실제로 바뀔 때만 뿌린다.
      expect(gateway.handleChatOpen(memberSocket, { chatOpen: true })).toEqual({
        ok: true,
      });
      await flushPresence();
      expect(server.roomEmit).toHaveBeenCalledTimes(1);
    });
  });

  // ── 항목 7: room 격리 ──────────────────────────────────────────────
  describe('room 격리', () => {
    it('join 시 작전판 room 에 넣고 모든 브로드캐스트를 room 으로만 보낸다', async () => {
      await gateway.handleJoin(adminSocket, {});

      expect(adminSocket.join).toHaveBeenCalledWith(OPERATION_BOARD_ROOM);

      gateway.handleElementAdd(adminSocket, { id: 'e1', type: 'marker' });
      gateway.handleElementRemove(adminSocket, { id: 'e1' });
      gateway.handleClear(adminSocket);
      gateway.handleBackgroundUpdate(adminSocket, { type: 'grid' });
      gateway.handleChatOpen(adminSocket, { chatOpen: true });
      gateway.handleLeave(adminSocket);

      // 전역 브로드캐스트는 한 번도 없어야 한다 — 작전판을 열지 않은 접속자는 무관하다.
      expect(server.emit).not.toHaveBeenCalled();
      expect(server.to).toHaveBeenCalledWith(OPERATION_BOARD_ROOM);
      expect(server.roomEmit).toHaveBeenCalled();
    });
  });

  // ── 항목 3: 저장본 일괄 적용 ────────────────────────────────────────
  describe('저장본 일괄 적용', () => {
    it('요소 500개 저장본을 브로드캐스트 1건으로 적용한다', async () => {
      await gateway.handleJoin(adminSocket, {});
      server.roomEmit.mockClear();

      const elements = Array.from(
        { length: MAX_OPERATION_ELEMENTS },
        (_, index) => ({ id: `e${index}`, type: 'marker', x: index, y: index }),
      );

      const ack = gateway.handleBoardReplace(adminSocket, {
        elements,
        background: { type: 'grid', imageUrl: null },
      });

      expect(ack).toEqual({ ok: true });
      expect(server.roomEmit).toHaveBeenCalledTimes(1);
      expect(server.roomEmit).toHaveBeenCalledWith('operation:board:replace', {
        elements,
        background: { type: 'grid', imageUrl: null },
      });

      const joiner = makeSocket('s-joiner', 'admin');
      await gateway.handleJoin(joiner, {});
      expect(lastState(joiner).elements).toHaveLength(MAX_OPERATION_ELEMENTS);
    });

    it('관리 권한이 없으면 일괄 적용을 거절한다', async () => {
      await gateway.handleJoin(adminSocket, {});
      await gateway.handleJoin(memberSocket, {});
      gateway.handlePermissionUpdate(adminSocket, {
        participantId: memberSocket.id,
        canDraw: true,
      });
      server.roomEmit.mockClear();

      expect(
        gateway.handleBoardReplace(memberSocket, { elements: [] }),
      ).toEqual({ ok: false, reason: OPERATION_REJECT_REASONS.forbidden });
      expect(server.roomEmit).not.toHaveBeenCalledWith(
        'operation:board:replace',
        expect.anything(),
      );
    });

    it('상한을 넘긴 저장본은 잘라서 적용하지 않고 거절한다', async () => {
      await gateway.handleJoin(adminSocket, {});
      server.roomEmit.mockClear();

      const tooMany = Array.from(
        { length: MAX_OPERATION_ELEMENTS + 1 },
        (_, index) => ({ id: `e${index}`, type: 'marker' }),
      );

      expect(
        gateway.handleBoardReplace(adminSocket, { elements: tooMany }),
      ).toEqual({
        ok: false,
        reason: OPERATION_REJECT_REASONS.tooManyElements,
      });
      expect(
        gateway.handleBoardReplace(adminSocket, {
          elements: [{ id: 'e1', type: 'nope' }],
        }),
      ).toEqual({ ok: false, reason: OPERATION_REJECT_REASONS.invalidElement });
      expect(server.roomEmit).not.toHaveBeenCalled();
    });
  });

  // ── presence 브로드캐스트 코얼레싱 ──────────────────────────────────
  // 참가자 목록은 전체 스냅샷이라 한 건의 크기가 참가자 수에 비례한다.
  // 100명이 작전 직전에 탭을 동시에 열면 broadcast 100건 x 최대 100명분 목록이
  // 카운트다운과 같은 소켓으로 흐른다. 짧은 창으로 묶어 그 폭을 줄인다.
  describe('presence 브로드캐스트 코얼레싱', () => {
    it('짧은 시간에 몰린 입장을 presence 한 건으로 묶는다', async () => {
      const sockets = Array.from({ length: 20 }, (_, index) =>
        makeSocket(`s-burst-${index}`, 'member'),
      );

      for (const socket of sockets) {
        await gateway.handleJoin(socket, {});
      }

      // 창이 닫히기 전에는 목록이 아직 나가지 않았다.
      expect(presenceCalls()).toHaveLength(0);
      // 각자 자기 화면은 join 즉시 받는다 — 미루는 것은 남에게 가는 목록뿐이다.
      for (const socket of sockets) {
        expect(typeof lastState(socket).sessionId).toBe('string');
      }

      await flushPresence();

      const calls = presenceCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toHaveLength(20);
    });

    it('묶어 보낸 presence 는 창이 닫힐 때의 최신 목록을 담는다', async () => {
      await gateway.handleJoin(adminSocket, {});
      await gateway.handleJoin(memberSocket, {});
      gateway.handleLeave(memberSocket);

      await flushPresence();

      const calls = presenceCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        expect.objectContaining({ participantId: 's-admin' }),
      ]);
    });

    it('창이 닫힌 뒤의 입장은 새 presence 로 나간다', async () => {
      await gateway.handleJoin(adminSocket, {});
      await flushPresence();
      expect(presenceCalls()).toHaveLength(1);

      await gateway.handleJoin(memberSocket, {});
      await flushPresence();

      const calls = presenceCalls();
      expect(calls).toHaveLength(2);
      expect(calls[1]).toHaveLength(2);
    });

    it('예약된 presence 는 종료 시 취소된다', async () => {
      await gateway.handleJoin(adminSocket, {});

      gateway.onModuleDestroy();
      await flushPresence();

      expect(presenceCalls()).toHaveLength(0);
    });
  });

  // ── 항목 5: 라이브 상태 휘발 고지 ────────────────────────────────────
  describe('라이브 상태 세션 식별자', () => {
    it('operation:state 에 프로세스 세션 식별자를 실어 재시작을 구분할 수 있게 한다', async () => {
      await gateway.handleJoin(adminSocket, {});
      const first = lastState(adminSocket);

      expect(typeof first.sessionId).toBe('string');
      expect(first.sessionId.length).toBeGreaterThan(8);

      const other = makeSocket('s-other', 'admin');
      await gateway.handleJoin(other, {});
      expect(lastState(other).sessionId).toBe(first.sessionId);

      const restarted = new OperationBoardsGateway(
        new SocketAuthService(
          jwtService as unknown as JwtService,
          usersService as unknown as UsersService,
        ),
        new WsRateLimitService(),
      );
      restarted.server = makeServer();
      const afterRestart = makeSocket('s-after', 'admin');
      await restarted.handleJoin(afterRestart, {});

      expect(lastState(afterRestart).sessionId).not.toBe(first.sessionId);
    });
  });
});
