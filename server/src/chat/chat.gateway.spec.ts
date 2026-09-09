// 채팅 게이트웨이의 메시지 검증·한도, 저장 실패 ack, 서버 푸시 번역, 대상 언어 보고, 히스토리 동봉, 입퇴장 미방송, 계약 픽스처 대조를 검증한다.
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';
import { SocketAuthService } from '../realtime/socket-auth.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatTranslationService } from '../translate/chat-translation.service';
import fixtures from '../../../docs/contracts/chat-events.json';

type ConnectedEntry = { nickname: string; language: string; targetLang: string | null };

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('ChatGateway', () => {
  const usersService = { findById: jest.fn() };
  const chatService = { saveMessage: jest.fn(), getRecentMessages: jest.fn() };
  const rateLimit = { check: jest.fn(), cleanup: jest.fn() };
  const jwtService = { verify: jest.fn() };
  const translation = { translateForMessage: jest.fn(), attachHistory: jest.fn() };
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

  function connectedUsers(): Map<string, ConnectedEntry> {
    return (gateway as unknown as { connectedUsers: Map<string, ConnectedEntry> }).connectedUsers;
  }

  function makeConnectingSocket(id = 'socket-connecting') {
    return {
      id,
      connected: true,
      handshake: { headers: { cookie: 'access_token=fake' } },
      data: {},
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    rateLimit.check.mockReturnValue(true);
    chatService.saveMessage.mockResolvedValue({
      id: 1,
      content: 'hello',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    chatService.getRecentMessages.mockResolvedValue([]);
    translation.translateForMessage.mockResolvedValue({ translations: {}, failed: [] });
    translation.attachHistory.mockResolvedValue(new Map());
    jwtService.verify.mockReturnValue({ sub: user.id });
    usersService.findById.mockResolvedValue(user);
    gateway = new ChatGateway(
      new SocketAuthService(
        jwtService as unknown as JwtService,
        usersService as unknown as UsersService,
      ),
      chatService as unknown as ChatService,
      rateLimit as unknown as WsRateLimitService,
      translation as unknown as ChatTranslationService,
    );
    gateway.server = server as unknown as Server;
    socket = {
      id: 'socket-1',
      data: { user },
    } as unknown as Socket;
    connectedUsers().set(socket.id, { nickname: user.nickname, language: user.language, targetLang: 'ko' });
  });
  afterEach(() => jest.restoreAllMocks());

  describe('메시지 검증·한도', () => {
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

    it('정확히 500자는 허용한다(T1 경계)', async () => {
      await expect(gateway.handleMessage(socket, 'x'.repeat(500))).resolves.toEqual({ ok: true });
    });

    it('인증되지 않은 소켓(user 없음)은 invalid 다', async () => {
      const anon = { id: 'anon', data: {} } as unknown as Socket;
      await expect(gateway.handleMessage(anon, 'hello')).resolves.toEqual({ ok: false, reason: 'invalid' });
      expect(chatService.saveMessage).not.toHaveBeenCalled();
    });

    it('사용자별 전송 한도를 넘으면 저장과 브로드캐스트를 막는다', async () => {
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
      rateLimit.check.mockImplementation((key: string, _event: string, limit: number) => {
        const attempts = (attemptsByKey.get(key) ?? 0) + 1;
        attemptsByKey.set(key, attempts);
        return attempts <= limit;
      });
      const secondSocket = { id: 'socket-2', data: { user } } as unknown as Socket;

      for (let i = 0; i < 30; i += 1) {
        await expect(gateway.handleMessage(socket, `message-${i}`)).resolves.toEqual({ ok: true });
      }
      await expect(gateway.handleMessage(secondSocket, 'blocked')).resolves.toEqual({
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

    it('허용된 메시지는 trim 후 저장하고 브로드캐스트한다', async () => {
      await expect(gateway.handleMessage(socket, '  hello  ')).resolves.toEqual({ ok: true });
      expect(rateLimit.check).toHaveBeenCalledWith(`chat-user:${user.id}`, 'chat:message', 30, 60_000);
      expect(chatService.saveMessage).toHaveBeenCalledWith(user, 'hello');
      expect(server.emit).toHaveBeenCalledWith(
        'chat:message',
        expect.objectContaining({ content: 'hello', nickname: 'memberKo' }),
      );
    });
  });

  describe('저장 실패 ack (C-4)', () => {
    it('저장이 throw 하면 즉시 { ok:false, reason:failed } 를 돌려주고 방송하지 않는다', async () => {
      chatService.saveMessage.mockRejectedValueOnce(new Error('db down'));
      await expect(gateway.handleMessage(socket, 'hello')).resolves.toEqual({
        ok: false,
        reason: 'failed',
      });
      expect(server.emit).not.toHaveBeenCalled();
      expect(translation.translateForMessage).not.toHaveBeenCalled();
    });
  });

  describe('서버 푸시 번역', () => {
    it('ack 는 번역 완료를 기다리지 않는다', async () => {
      const pending = deferred<{ translations: Record<string, string>; failed: string[] }>();
      translation.translateForMessage.mockReturnValueOnce(pending.promise);

      const ack = await gateway.handleMessage(socket, 'hello');

      expect(ack).toEqual({ ok: true });
      expect(server.emit).toHaveBeenCalledTimes(1);
      expect(server.emit.mock.calls[0][0]).toBe('chat:message');
      pending.resolve({ translations: { en: 'x' }, failed: [] });
      await flush();
      expect(server.emit).toHaveBeenCalledTimes(2);
    });

    it('저장·방송 뒤 접속자 언어 집합으로 번역해 chat:translation 을 전체에 방송한다', async () => {
      connectedUsers().set('socket-en', { nickname: 'en', language: 'en', targetLang: 'en' });
      connectedUsers().set('socket-off', { nickname: 'off', language: 'ja', targetLang: null });
      translation.translateForMessage.mockResolvedValueOnce({
        translations: { en: 'hello' },
        failed: [],
      });

      await gateway.handleMessage(socket, '안녕');
      await flush();

      expect(translation.translateForMessage).toHaveBeenCalledWith(
        { id: 1, content: 'hello' },
        new Set(['ko', 'en']),
      );
      expect(server.emit).toHaveBeenNthCalledWith(1, 'chat:message', expect.any(Object));
      expect(server.emit).toHaveBeenNthCalledWith(2, 'chat:translation', {
        id: 1,
        translations: { en: 'hello' },
      });
    });

    it('대상이 0이어도 translations:{} 를 방송한다(O)', async () => {
      await gateway.handleMessage(socket, '안녕');
      await flush();
      expect(server.emit).toHaveBeenLastCalledWith('chat:translation', { id: 1, translations: {} });
    });

    it('실패는 failed·error 를 실어 방송한다(G)', async () => {
      translation.translateForMessage.mockResolvedValueOnce({
        translations: { ja: 'JA' },
        failed: ['en'],
        error: 'provider',
      });
      await gateway.handleMessage(socket, '안녕');
      await flush();
      expect(server.emit).toHaveBeenLastCalledWith('chat:translation', {
        id: 1,
        translations: { ja: 'JA' },
        failed: ['en'],
        error: 'provider',
      });
    });

    it('번역 서비스가 reject 해도 경고만 남기고 방송·ack 에 영향이 없다', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      translation.translateForMessage.mockRejectedValueOnce(new Error('unexpected'));
      await expect(gateway.handleMessage(socket, '안녕')).resolves.toEqual({ ok: true });
      await flush();
      expect(server.emit).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('chat:language 대상 언어 보고 (C 5절 A)', () => {
    it('유효한 언어와 null(자동번역 꺼짐)을 소켓별로 갱신한다', () => {
      gateway.handleLanguage(socket, { lang: 'ja' });
      expect(connectedUsers().get(socket.id)?.targetLang).toBe('ja');
      expect(gateway.onlineTargetLangs()).toEqual(new Set(['ja']));

      gateway.handleLanguage(socket, { lang: null });
      expect(connectedUsers().get(socket.id)?.targetLang).toBeNull();
      expect(gateway.onlineTargetLangs()).toEqual(new Set());
    });

    it.each([undefined, null, 'ja', { lang: 'other' }, { lang: 'xx' }, { lang: 1 }, {}])(
      '잘못된 값 %p 은 무시한다',
      (body) => {
        gateway.handleLanguage(socket, body);
        expect(connectedUsers().get(socket.id)?.targetLang).toBe('ko');
      },
    );

    it('onlineTargetLangs 는 null 을 뺀 집합이다', () => {
      connectedUsers().set('a', { nickname: 'a', language: 'en', targetLang: 'en' });
      connectedUsers().set('b', { nickname: 'b', language: 'en', targetLang: null });
      connectedUsers().set('c', { nickname: 'c', language: 'zh', targetLang: 'ko' });
      expect(gateway.onlineTargetLangs()).toEqual(new Set(['ko', 'en']));
    });

    it('other 계정의 초기 대상은 en 이고 ru 계정은 ru 다', async () => {
      usersService.findById.mockResolvedValueOnce({ ...user, language: 'other' });
      const a = makeConnectingSocket('socket-other');
      await gateway.handleConnection(a);
      expect(connectedUsers().get(a.id)?.targetLang).toBe('en');

      usersService.findById.mockResolvedValueOnce({ ...user, id: 8, language: 'ru' });
      const b = makeConnectingSocket('socket-ru');
      await gateway.handleConnection(b);
      expect(connectedUsers().get(b.id)?.targetLang).toBe('ru');
    });

    it('등록 전에 도착한 보고는 보관했다가 등록 시 초기값으로 쓴다(resolveUser 경합)', async () => {
      const pendingUser = deferred<User>();
      usersService.findById.mockReturnValueOnce(pendingUser.promise);
      const connecting = makeConnectingSocket('socket-early');

      const connection = gateway.handleConnection(connecting);
      gateway.handleLanguage(connecting, { lang: 'zh' });
      pendingUser.resolve(user);
      await connection;

      expect(connectedUsers().get(connecting.id)?.targetLang).toBe('zh');
      expect(translation.attachHistory).toHaveBeenCalledWith(expect.any(Array), expect.any(Set));
      const langs = translation.attachHistory.mock.calls[0][1] as Set<string>;
      expect(langs.has('zh')).toBe(true);
    });
  });

  describe('접속 — 히스토리 동봉·입퇴장 미방송', () => {
    it('DB 조회 중 disconnect되면 유령 채팅 사용자를 등록하지 않는다', async () => {
      const pendingUser = deferred<User>();
      usersService.findById.mockReturnValueOnce(pendingUser.promise);
      const connecting = makeConnectingSocket('socket-race');

      const connection = gateway.handleConnection(connecting);
      (connecting as unknown as { connected: boolean }).connected = false;
      gateway.handleDisconnect(connecting);
      server.emit.mockClear();

      pendingUser.resolve(user);
      await connection;

      expect(connectedUsers().has(connecting.id)).toBe(false);
      expect(chatService.getRecentMessages).not.toHaveBeenCalled();
      expect(connecting.emit).not.toHaveBeenCalled();
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('히스토리 항목마다 translations 를 붙이고, 없으면 {} 다', async () => {
      const history = [
        { id: 100, content: 'gg', createdAt: new Date('2026-09-09T23:59:00Z'), user: { nickname: 'a', allianceName: null, language: 'en' } },
        { id: 101, content: '10분 뒤 SFC 집결 갑니다', createdAt: new Date('2026-09-10T00:00:00Z'), user },
      ];
      chatService.getRecentMessages.mockResolvedValueOnce(history);
      translation.attachHistory.mockResolvedValueOnce(new Map([[101, { en: 'Rally to SFC in 10 min' }]]));
      connectedUsers().set('socket-en', { nickname: 'en', language: 'en', targetLang: 'en' });
      const connecting = makeConnectingSocket();

      await gateway.handleConnection(connecting);

      expect(translation.attachHistory).toHaveBeenCalledWith(history, new Set(['ko', 'en']));
      expect(connecting.emit).toHaveBeenCalledWith('chat:history', [
        expect.objectContaining({ id: 100, translations: {} }),
        expect.objectContaining({ id: 101, translations: { en: 'Rally to SFC in 10 min' } }),
      ]);
    });

    it('입장·퇴장 때 chat:system 을 방송하지 않는다(C-5)', async () => {
      const connecting = makeConnectingSocket();
      await gateway.handleConnection(connecting);
      gateway.handleDisconnect(connecting);
      expect(server.emit).not.toHaveBeenCalled();
      expect(connectedUsers().has(connecting.id)).toBe(false);
    });

    it('히스토리 조회가 실패해도 소켓을 끊지 않고 chat:system { kind:history_error } 를 보낸다', async () => {
      chatService.getRecentMessages.mockRejectedValueOnce(new Error('db down'));
      const connecting = makeConnectingSocket();

      await gateway.handleConnection(connecting);

      expect(connecting.disconnect).not.toHaveBeenCalled();
      expect(connecting.emit).toHaveBeenCalledWith('chat:system', { kind: 'history_error' });
      expect(connecting.emit).not.toHaveBeenCalledWith('chat:error', expect.anything());
      expect((connecting.data as { user?: User }).user).toBe(user);
      expect(connectedUsers().has(connecting.id)).toBe(true);
    });

    it('히스토리 조회 성공 시에는 chat:system 을 보내지 않는다', async () => {
      const connecting = makeConnectingSocket();
      await gateway.handleConnection(connecting);
      expect(connecting.emit).toHaveBeenCalledWith('chat:history', []);
      expect(connecting.emit).not.toHaveBeenCalledWith('chat:system', expect.anything());
    });

    it('인증 실패는 여전히 끊는다', async () => {
      usersService.findById.mockResolvedValueOnce(null);
      const connecting = makeConnectingSocket();
      await gateway.handleConnection(connecting);
      expect(connecting.disconnect).toHaveBeenCalled();
      expect(connectedUsers().has(connecting.id)).toBe(false);
    });
  });

  describe('계약 픽스처 대조 (C-13)', () => {
    it('chat:message 방송과 ack 의 키 집합이 픽스처와 같다', async () => {
      const ack = await gateway.handleMessage(socket, 'hello');
      const payload = roundTrip(server.emit.mock.calls[0][1]);
      expect(Object.keys(payload).sort()).toEqual(Object.keys(fixtures['chat:message']).sort());
      expect(typeof payload.createdAt).toBe('string');
      expect(roundTrip(ack)).toEqual(fixtures['chat:message:ack:ok']);

      rateLimit.check.mockReturnValueOnce(false);
      expect(roundTrip(await gateway.handleMessage(socket, 'x'))).toEqual(fixtures['chat:message:ack:rate_limit']);
      expect(roundTrip(await gateway.handleMessage(socket, ''))).toEqual(fixtures['chat:message:ack:invalid']);
      chatService.saveMessage.mockRejectedValueOnce(new Error('x'));
      expect(roundTrip(await gateway.handleMessage(socket, 'x'))).toEqual(fixtures['chat:message:ack:failed']);
    });

    it('chat:translation 성공·실패·빈 페이로드의 키 집합이 픽스처와 같다', async () => {
      translation.translateForMessage
        .mockResolvedValueOnce({ translations: { en: 'a', ja: 'b' }, failed: [] })
        .mockResolvedValueOnce({ translations: {}, failed: ['en'], error: 'provider' })
        .mockResolvedValueOnce({ translations: {}, failed: [] });
      for (let i = 0; i < 3; i += 1) {
        await gateway.handleMessage(socket, 'hello');
        await flush();
      }
      const payloads = server.emit.mock.calls
        .filter(([event]) => event === 'chat:translation')
        .map(([, payload]) => roundTrip(payload));
      expect(payloads).toHaveLength(3);
      expect(Object.keys(payloads[0]).sort()).toEqual(Object.keys(fixtures['chat:translation']).sort());
      expect(Object.keys(payloads[1]).sort()).toEqual(Object.keys(fixtures['chat:translation:failed']).sort());
      expect(Object.keys(payloads[2]).sort()).toEqual(Object.keys(fixtures['chat:translation:empty']).sort());
      expect(payloads[2].translations).toEqual({});
    });

    it('chat:history 항목과 chat:system 의 키 집합이 픽스처와 같다', async () => {
      chatService.getRecentMessages.mockResolvedValueOnce([
        { id: 100, content: 'gg', createdAt: new Date(), user: { nickname: 'a', allianceName: null, language: 'en' } },
      ]);
      const connecting = makeConnectingSocket();
      await gateway.handleConnection(connecting);
      const history = roundTrip(connecting.emit.mock.calls.find(([e]) => e === 'chat:history')![1]) as Record<string, unknown>[];
      expect(Object.keys(history[0]).sort()).toEqual(Object.keys(fixtures['chat:history'][0]).sort());

      chatService.getRecentMessages.mockRejectedValueOnce(new Error('x'));
      const failing = makeConnectingSocket('socket-fail');
      await gateway.handleConnection(failing);
      const system = roundTrip(failing.emit.mock.calls.find(([e]) => e === 'chat:system')![1]);
      expect(system).toEqual(fixtures['chat:system']);
    });

    it('chat:language 픽스처를 핸들러에 넣으면 반영된다', () => {
      gateway.handleLanguage(socket, fixtures['chat:language']);
      expect(connectedUsers().get(socket.id)?.targetLang).toBe('en');
      gateway.handleLanguage(socket, fixtures['chat:language:off']);
      expect(connectedUsers().get(socket.id)?.targetLang).toBeNull();
    });
  });
});
