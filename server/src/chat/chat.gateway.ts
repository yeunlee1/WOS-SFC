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
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { ChatService } from './chat.service';

// 모든 출처에서 WebSocket 연결 허용
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // socket.id → 유저 닉네임 매핑
  private connectedUsers = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly chatService: ChatService,
  ) {}

  // 클라이언트 연결 시: JWT 검증 → 유저 확인 → 히스토리 전송
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      if (!token) {
        client.disconnect();
        return;
      }

      // JWT 페이로드 검증
      const payload = this.jwtService.verify(token);
      const user = await this.usersService.findByNickname(payload.nickname);
      if (!user) {
        client.disconnect();
        return;
      }

      // 유저 정보를 소켓 객체에 저장
      (client as any).user = user;
      this.connectedUsers.set(client.id, user.nickname);

      // 최근 7일치 메시지 히스토리 전송
      const history = await this.chatService.getRecentMessages();
      client.emit(
        'chat:history',
        history.map((m) => ({
          id: m.id,
          nickname: m.user.nickname,
          allianceName: m.user.allianceName,
          content: m.content,
          createdAt: m.createdAt,
        })),
      );

      // 전체에게 입장 알림 및 온라인 목록 갱신
      this.server.emit('chat:system', `${user.nickname}님이 입장했습니다`);
      this.server.emit(
        'chat:online',
        Array.from(this.connectedUsers.values()),
      );
    } catch {
      client.disconnect();
    }
  }

  // 클라이언트 연결 해제 시: 퇴장 알림 및 온라인 목록 갱신
  handleDisconnect(client: Socket) {
    const nickname = this.connectedUsers.get(client.id);
    if (nickname) {
      this.connectedUsers.delete(client.id);
      this.server.emit('chat:system', `${nickname}님이 퇴장했습니다`);
      this.server.emit(
        'chat:online',
        Array.from(this.connectedUsers.values()),
      );
    }
  }

  // 채팅 메시지 수신 → 저장 → 전체 브로드캐스트
  @SubscribeMessage('chat:message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() content: string,
  ) {
    const user = (client as any).user;
    if (!user || !content?.trim()) return;

    const msg = await this.chatService.saveMessage(user, content.trim());
    this.server.emit('chat:message', {
      id: msg.id,
      nickname: user.nickname,
      allianceName: user.allianceName,
      content: msg.content,
      createdAt: msg.createdAt,
    });
  }
}
