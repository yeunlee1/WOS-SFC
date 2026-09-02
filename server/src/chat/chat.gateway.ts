import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { SocketAuthService } from '../realtime/socket-auth.service';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import { User } from '../users/users.entity';
import { SOCKET_CORS_OPTIONS } from '../realtime/socket-cors.options';

const CHAT_MESSAGE_MAX_LENGTH = 500;
const CHAT_MESSAGE_RATE_LIMIT = 30;
const CHAT_MESSAGE_RATE_WINDOW_MS = 60_000;

@WebSocketGateway({ cors: SOCKET_CORS_OPTIONS })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // socket.id → { nickname, language } 매핑
  private connectedUsers = new Map<string, { nickname: string; language: string }>();

  constructor(
    private readonly socketAuth: SocketAuthService,
    private readonly chatService: ChatService,
    private readonly rateLimit: WsRateLimitService,
  ) {}

  // 클라이언트 연결 시: JWT 검증 → 유저 확인 → 히스토리 전송
  // 인증 실패만 연결을 끊는다. 이 소켓은 RealtimeGateway(전투 카운트다운)와 같은
  // 기본 네임스페이스를 공유하므로 채팅 내부 오류로 끊으면 전투 기능까지 죽는다.
  async handleConnection(client: Socket) {
    // 쿠키 파싱·서명 검증·사용자 조회는 SocketAuthService가 소켓당 한 번만 한다.
    // 어느 단계에서 실패하든 null이 오므로, 예전처럼 인증 실패는 곧 disconnect다.
    const user: User | null = await this.socketAuth.resolveUser(client);

    if (!client.connected) return;
    if (!user) {
      client.disconnect();
      return;
    }

    // 유저 정보를 소켓 객체에 저장
    (client.data as { user?: User }).user = user;
    this.connectedUsers.set(client.id, { nickname: user.nickname, language: user.language });

    // 최근 7일치 메시지 히스토리 전송.
    // 조회가 실패해도 소켓을 끊지 않는다 — 채팅은 부가 기능이고, 여기서 끊으면
    // 클라이언트가 'io server disconnect'를 인증 실패로 읽어 앱 전체가 로그아웃된다.
    try {
      const history = await this.chatService.getRecentMessages();
      if (!client.connected) return;
      client.emit(
        'chat:history',
        history.map((m) => ({
          id: m.id,
          nickname: m.user.nickname,
          allianceName: m.user.allianceName,
          language: m.user.language,
          content: m.content,
          createdAt: m.createdAt,
        })),
      );
    } catch {
      if (!client.connected) return;
      client.emit('chat:error', { scope: 'history' });
    }

    // 전체에게 입장 알림.
    // 온라인 목록은 RealtimeGateway의 'online:updated'가 이미 담당한다.
    this.server.emit('chat:system', `${user.nickname}님이 입장했습니다`);
  }

  // 클라이언트 연결 해제 시: 퇴장 알림
  handleDisconnect(client: Socket) {
    const info = this.connectedUsers.get(client.id);
    if (info) {
      this.connectedUsers.delete(client.id);
      this.server.emit('chat:system', `${info.nickname}님이 퇴장했습니다`);
    }
  }

  // 채팅 메시지 수신 → 저장 → 전체 브로드캐스트
  @SubscribeMessage('chat:message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() content: unknown,
  ) {
    const user = (client.data as { user?: User }).user;
    if (!user || typeof content !== 'string') {
      return { ok: false, reason: 'invalid' as const };
    }
    const normalized = content.trim();
    if (!normalized || normalized.length > CHAT_MESSAGE_MAX_LENGTH) {
      return { ok: false, reason: 'invalid' as const };
    }
    if (
      !this.rateLimit.check(
        // 재연결·다중 탭도 같은 한도를 공유하도록 소켓 ID가 아닌 불변 사용자 ID를 사용한다.
        // disconnect 때 삭제하지 않으므로 버킷 수는 연결 수가 아니라 메시지를 보낸 계정 수에만 비례한다.
        `chat-user:${user.id}`,
        'chat:message',
        CHAT_MESSAGE_RATE_LIMIT,
        CHAT_MESSAGE_RATE_WINDOW_MS,
      )
    ) {
      return { ok: false, reason: 'rate_limit' as const };
    }

    const msg = await this.chatService.saveMessage(user, normalized);
    this.server.emit('chat:message', {
      id: msg.id,
      nickname: user.nickname,
      allianceName: user.allianceName,
      language: user.language,
      content: msg.content,
      createdAt: msg.createdAt,
    });
    return { ok: true };
  }
}
