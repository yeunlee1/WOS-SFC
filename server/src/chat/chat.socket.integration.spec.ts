// 실제 Socket.IO 어댑터로 ChatGateway 를 띄워 ack 전달·방송·번역 후속 방송·저장 실패 ack·대상 언어 보고를 소켓 1개로 검증한다(A-T5).
import { INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { SocketAuthService } from '../realtime/socket-auth.service';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import { ChatTranslationService } from '../translate/chat-translation.service';

const user = {
  id: 7,
  nickname: 'memberKo',
  allianceName: 'KOR',
  language: 'ko',
  role: 'member',
};

function waitFor<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} 를 ${timeoutMs}ms 안에 받지 못했다`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitWithAck<T = unknown>(socket: ClientSocket, event: string, payload: unknown, timeoutMs = 4900): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack 를 ${timeoutMs}ms 안에 받지 못했다`)), timeoutMs);
    socket.emit(event, payload, (ack: T) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

describe('ChatGateway 소켓 통합', () => {
  const chatService = { saveMessage: jest.fn(), getRecentMessages: jest.fn() };
  const translation = { translateForMessage: jest.fn(), attachHistory: jest.fn() };
  const socketAuth = { resolveUser: jest.fn() };
  let app: INestApplication;
  let url: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatGateway,
        WsRateLimitService,
        { provide: ChatService, useValue: chatService },
        { provide: SocketAuthService, useValue: socketAuth },
        { provide: ChatTranslationService, useValue: translation },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    socketAuth.resolveUser.mockResolvedValue(user);
    chatService.getRecentMessages.mockResolvedValue([]);
    chatService.saveMessage.mockResolvedValue({
      id: 1,
      content: 'hello',
      createdAt: new Date('2026-09-10T00:00:00Z'),
    });
    translation.attachHistory.mockResolvedValue(new Map());
    translation.translateForMessage.mockResolvedValue({ translations: {}, failed: [] });
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.disconnect();
  });

  /** 접속 뒤 chat:history 까지 받아야 handleConnection 이 끝나 사용자가 등록된 상태다. */
  async function connect(): Promise<ClientSocket> {
    const client = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(client);
    const history = waitFor(client, 'chat:history');
    await waitFor(client, 'connect');
    await history;
    return client;
  }

  it('(a) chat:message 는 ack { ok:true } 를 받고 chat:message 가 방송된다', async () => {
    const client = await connect();
    const broadcast = waitFor<Record<string, unknown>>(client, 'chat:message');

    const ack = await emitWithAck(client, 'chat:message', 'hello');

    expect(ack).toEqual({ ok: true });
    const payload = await broadcast;
    expect(payload).toMatchObject({ id: 1, content: 'hello', nickname: 'memberKo', allianceName: 'KOR', language: 'ko' });
    expect(typeof payload.createdAt).toBe('string');
    expect(chatService.saveMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'hello');
  });

  it('(b) chat:translation 이 방송 뒤에 따라온다', async () => {
    translation.translateForMessage.mockResolvedValueOnce({ translations: { en: 'hello' }, failed: [] });
    const client = await connect();
    const order: string[] = [];
    client.on('chat:message', () => order.push('message'));
    const translated = waitFor<Record<string, unknown>>(client, 'chat:translation');
    client.on('chat:translation', () => order.push('translation'));

    await emitWithAck(client, 'chat:message', '안녕');

    expect(await translated).toEqual({ id: 1, translations: { en: 'hello' } });
    expect(order).toEqual(['message', 'translation']);
  });

  it('(c) 저장이 reject 되면 ack { ok:false, reason:failed } 가 5초 안에 온다', async () => {
    chatService.saveMessage.mockRejectedValueOnce(new Error('db down'));
    const client = await connect();
    let broadcasts = 0;
    client.on('chat:message', () => (broadcasts += 1));

    const ack = await emitWithAck(client, 'chat:message', 'hello');

    expect(ack).toEqual({ ok: false, reason: 'failed' });
    expect(client.connected).toBe(true);
    expect(broadcasts).toBe(0);
  });

  it('(d) chat:language 뒤에 보낸 메시지는 그 언어를 대상에 넣는다', async () => {
    const client = await connect();
    client.emit('chat:language', { lang: 'zh' });
    const translated = waitFor(client, 'chat:translation');

    await emitWithAck(client, 'chat:message', 'hello');
    await translated;

    expect(translation.translateForMessage).toHaveBeenCalledTimes(1);
    const targets = translation.translateForMessage.mock.calls[0][1] as Set<string>;
    expect(targets.has('zh')).toBe(true);
    expect(targets.has('ko')).toBe(false);
  });

  it('(e) 인증 실패 소켓은 서버가 끊는다', async () => {
    socketAuth.resolveUser.mockResolvedValueOnce(null);
    const client = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(client);
    const disconnected = waitFor<string>(client, 'disconnect');
    await waitFor(client, 'connect');
    expect(await disconnected).toBe('io server disconnect');
  });
});
