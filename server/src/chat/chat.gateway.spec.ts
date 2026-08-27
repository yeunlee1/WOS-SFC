// 채팅 게이트웨이의 메시지 크기와 전송 빈도 제한을 검증한다.
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';
import { SocketAuthService } from '../realtime/socket-auth.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

describe('ChatGateway 메시지 보안', () => {
  const usersService = { findById: jest.fn() };
  const chatService = { saveMessage: jest.fn(), getRecentMessages: jest.fn() };
  const rateLimit = { check: jest.fn(), cleanup: jest.fn() };
  const jwtService = { verify: jest.fn() };
  const server = { emit: jest.fn() };
  const user = {
    id: 7,
    nickname: 'memberKo',
    allianceName: 'KOR',
    language: 'ko',
    role: 'member',
  } as User;
  let gateway: ChatGateway;
  let socket: Socket;

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.check.mockReturnValue(true);
    chatService.saveMessage.mockResolvedValue({
      id: 1,
      content: 'hello',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    gateway = new ChatGateway(
      new SocketAuthService(
        jwtService as unknown as JwtService,
        usersService as unknown as UsersService,
      ),
      chatService as unknown as ChatService,
      rateLimit as unknown as WsRateLimitService,
    );
    gateway.server = server as unknown as Server;
    socket = {
      id: 'socket-1',
      data: { user },
    } as unknown as Socket;
  });

  it.each([123, {}, ' ', 'x'.repeat(501)])(
    '문자열이 아니거나 비어 있거나 500자를 넘는 메시지를 거부한다',
    async (content) => {
      await expect(gateway.handleMessage(socket, content)).resolves.toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect(chatService.saveMessage).not.toHaveBeenCalled();
    },
  );

  it('DB 조회 중 disconnect되면 유령 채팅 사용자를 등록하지 않는다', async () => {
    jwtService.verify.mockReturnValue({ sub: user.id });
    let resolveUser!: (value: User) => void;
    usersService.findById.mockReturnValueOnce(
      new Promise<User>((resolve) => {
        resolveUser = resolve;
      }),
    );
    const connectingSocket = {
      id: 'socket-race',
      connected: true,
      handshake: { headers: { cookie: 'access_token=fake' } },
      data: {},
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;

    const connecting = gateway.handleConnection(connectingSocket);
    (connectingSocket as unknown as { connected: boolean }).connected = false;
    gateway.handleDisconnect(connectingSocket);
    server.emit.mockClear();

    resolveUser(user);
    await connecting;

    const connectedUsers = (
      gateway as unknown as {
        connectedUsers: Map<string, unknown>;
      }
    ).connectedUsers;
    expect(connectedUsers.has(connectingSocket.id)).toBe(false);
    expect(chatService.getRecentMessages).not.toHaveBeenCalled();
    expect(connectingSocket.emit).not.toHaveBeenCalled();
    expect(server.emit).not.toHaveBeenCalled();
  });

  it('소켓별 전송 한도를 넘으면 저장과 브로드캐스트를 막는다', async () => {
    rateLimit.check.mockReturnValue(false);

    await expect(gateway.handleMessage(socket, 'hello')).resolves.toEqual({
      ok: false,
      reason: 'rate_limit',
    });
    expect(chatService.saveMessage).not.toHaveBeenCalled();
    expect(server.emit).not.toHaveBeenCalled();
  });

  it('같은 사용자의 서로 다른 소켓은 하나의 전송 한도를 공유한다', async () => {
    const attemptsByKey = new Map<string, number>();
    rateLimit.check.mockImplementation(
      (key: string, _event: string, limit: number) => {
        const attempts = (attemptsByKey.get(key) ?? 0) + 1;
        attemptsByKey.set(key, attempts);
        return attempts <= limit;
      },
    );
    const secondSocket = {
      id: 'socket-2',
      data: { user },
    } as unknown as Socket;

    for (let i = 0; i < 30; i += 1) {
      await expect(
        gateway.handleMessage(socket, `message-${i}`),
      ).resolves.toEqual({
        ok: true,
      });
    }

    await expect(
      gateway.handleMessage(secondSocket, 'blocked'),
    ).resolves.toEqual({
      ok: false,
      reason: 'rate_limit',
    });
    expect(attemptsByKey.get(`chat-user:${user.id}`)).toBe(31);
    expect(chatService.saveMessage).toHaveBeenCalledTimes(30);
  });

  it('disconnect 때 사용자 전송 한도 버킷을 삭제하지 않는다', () => {
    gateway.handleDisconnect(socket);

    expect(rateLimit.cleanup).not.toHaveBeenCalled();
  });

  // 히스토리 조회 실패가 소켓 전체(=전투 카운트다운)를 끊지 않아야 한다.
  describe('히스토리 조회 실패 격리', () => {
    function makeConnectingSocket() {
      return {
        id: 'socket-history',
        connected: true,
        handshake: { headers: { cookie: 'access_token=fake' } },
        data: {},
        emit: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as Socket;
    }

    beforeEach(() => {
      jwtService.verify.mockReturnValue({ sub: user.id });
      usersService.findById.mockResolvedValue(user);
    });

    it('히스토리 조회가 실패해도 소켓을 끊지 않는다', async () => {
      chatService.getRecentMessages.mockRejectedValueOnce(new Error('db down'));
      const connectingSocket = makeConnectingSocket();

      await gateway.handleConnection(connectingSocket);

      expect(connectingSocket.disconnect).not.toHaveBeenCalled();
    });

    it('히스토리 조회가 실패하면 chat:error를 알리고 입장 처리는 유지한다', async () => {
      chatService.getRecentMessages.mockRejectedValueOnce(new Error('db down'));
      const connectingSocket = makeConnectingSocket();

      await gateway.handleConnection(connectingSocket);

      expect(connectingSocket.emit).toHaveBeenCalledWith(
        'chat:error',
        expect.objectContaining({ scope: 'history' }),
      );
      expect(
        (connectingSocket.data as { user?: User }).user,
      ).toBe(user);
      expect(server.emit).toHaveBeenCalledWith(
        'chat:system',
        expect.stringContaining(user.nickname),
      );
    });

    it('히스토리 조회 성공 시에는 chat:error를 보내지 않는다', async () => {
      chatService.getRecentMessages.mockResolvedValueOnce([]);
      const connectingSocket = makeConnectingSocket();

      await gateway.handleConnection(connectingSocket);

      expect(connectingSocket.emit).toHaveBeenCalledWith('chat:history', []);
      expect(connectingSocket.emit).not.toHaveBeenCalledWith(
        'chat:error',
        expect.anything(),
      );
    });
  });

  // 구독자가 0인 이벤트는 100명 규모에서 순수한 낭비다 (항목 6).
  describe('구독자 없는 chat:online 브로드캐스트 제거', () => {
    it('입장 시 chat:online을 브로드캐스트하지 않는다', async () => {
      jwtService.verify.mockReturnValue({ sub: user.id });
      usersService.findById.mockResolvedValue(user);
      chatService.getRecentMessages.mockResolvedValueOnce([]);
      const connectingSocket = {
        id: 'socket-online',
        connected: true,
        handshake: { headers: { cookie: 'access_token=fake' } },
        data: {},
        emit: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(connectingSocket);

      const events = server.emit.mock.calls.map((call) => call[0]);
      expect(events).not.toContain('chat:online');
    });

    it('퇴장 시에도 chat:online을 브로드캐스트하지 않는다', () => {
      (
        gateway as unknown as {
          connectedUsers: Map<string, { nickname: string; language: string }>;
        }
      ).connectedUsers.set(socket.id, {
        nickname: user.nickname,
        language: user.language,
      });

      gateway.handleDisconnect(socket);

      const events = server.emit.mock.calls.map((call) => call[0]);
      expect(events).toContain('chat:system');
      expect(events).not.toContain('chat:online');
    });
  });

  it('허용된 메시지는 trim 후 저장하고 브로드캐스트한다', async () => {
    await expect(gateway.handleMessage(socket, '  hello  ')).resolves.toEqual({
      ok: true,
    });
    expect(rateLimit.check).toHaveBeenCalledWith(
      `chat-user:${user.id}`,
      'chat:message',
      30,
      60_000,
    );
    expect(chatService.saveMessage).toHaveBeenCalledWith(user, 'hello');
    expect(server.emit).toHaveBeenCalledWith(
      'chat:message',
      expect.objectContaining({ content: 'hello', nickname: 'memberKo' }),
    );
  });
});
