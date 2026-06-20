// 작전판 실시간 세션 상태와 드로잉 이벤트를 중계한다.
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

type OperationAck = { ok: boolean };

type OperationUser = {
  nickname: string;
  alliance: string;
  role: string;
};

type OperationParticipant = OperationUser & {
  participantId: string;
  canDraw: boolean;
  chatOpen: boolean;
};

type OperationBackground = {
  type: 'grid' | 'image';
  imageUrl: string | null;
};

type OperationElement = Record<string, unknown> & {
  id: string;
};

const MAX_ELEMENTS = 500;
const ELEMENT_JSON_BYTE_LIMIT = 20 * 1024;
const ELEMENT_ID_MAX_LENGTH = 80;
const ELEMENT_TEXT_MAX_LENGTH = 300;
const ELEMENT_COLOR_MAX_LENGTH = 32;
const ELEMENT_STRING_MAX_LENGTH = 512;
const BACKGROUND_IMAGE_URL_MAX_LENGTH = 255;
const BACKGROUND_IMAGE_URL_PREFIX = '/uploads/operation-boards/';
const ALLOWED_ELEMENT_TYPES = new Set([
  'path',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'marker',
]);

// production 환경에서 WEB_ORIGIN 미설정 시 CORS origin fallback을 막는다.
if (process.env.NODE_ENV === 'production' && !process.env.WEB_ORIGIN) {
  throw new Error(
    'WEB_ORIGIN 환경변수가 production에서 필수입니다. CORS 보안을 위해 명시적으로 설정하세요.',
  );
}
const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';

@WebSocketGateway({ cors: { origin: WEB_ORIGIN, credentials: true } })
export class OperationBoardsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;

  private connectedUsers = new Map<string, OperationUser>();
  private participants = new Map<string, OperationParticipant>();
  private elements: OperationElement[] = [];
  private background: OperationBackground = { type: 'grid', imageUrl: null };

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: Socket): void {
    const user = this.getUserFromSocket(client);
    if (!user) {
      client.disconnect();
      return;
    }
    this.connectedUsers.set(client.id, user);
  }

  handleDisconnect(client: Socket): void {
    this.connectedUsers.delete(client.id);
    const wasParticipant = this.participants.delete(client.id);
    if (wasParticipant) this.broadcastPresence();
  }

  @SubscribeMessage('operation:join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body?: { chatOpen?: boolean },
  ): OperationAck {
    const user = this.ensureUser(client);
    if (!user) {
      client.disconnect();
      return { ok: false };
    }

    const participant: OperationParticipant = {
      ...user,
      participantId: client.id,
      canDraw: this.isPrivilegedRole(user.role),
      chatOpen: body?.chatOpen === true,
    };
    this.participants.set(client.id, participant);

    client.emit('operation:state', {
      elements: [...this.elements],
      background: { ...this.background },
      participants: this.getParticipants(),
      canDraw: this.canDraw(participant),
    });
    this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:permission:update')
  handlePermissionUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { participantId?: unknown; canDraw?: unknown },
  ): OperationAck {
    const actor = this.participants.get(client.id);
    if (!actor || !this.isPrivilegedRole(actor.role)) return { ok: false };
    if (typeof body?.participantId !== 'string') return { ok: false };
    if (typeof body.canDraw !== 'boolean') return { ok: false };

    const participant = this.participants.get(body.participantId);
    if (!participant) return { ok: false };

    participant.canDraw =
      this.isPrivilegedRole(participant.role) || body.canDraw;
    this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:leave')
  handleLeave(@ConnectedSocket() client: Socket): OperationAck {
    const wasParticipant = this.participants.delete(client.id);
    if (wasParticipant) this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:chat-open')
  handleChatOpen(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatOpen?: unknown },
  ): OperationAck {
    const participant = this.participants.get(client.id);
    if (!participant || typeof body?.chatOpen !== 'boolean') {
      return { ok: false };
    }

    participant.chatOpen = body.chatOpen;
    this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:element:add')
  handleElementAdd(
    @ConnectedSocket() client: Socket,
    @MessageBody() element: unknown,
  ): OperationAck {
    if (!this.canClientDraw(client)) return { ok: false };

    const normalized = this.normalizeElement(element);
    if (!normalized) return { ok: false };

    this.elements.push(normalized);
    if (this.elements.length > MAX_ELEMENTS) {
      this.elements = this.elements.slice(-MAX_ELEMENTS);
    }
    this.server.emit('operation:element:add', normalized);
    return { ok: true };
  }

  @SubscribeMessage('operation:element:remove')
  handleElementRemove(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { id?: unknown },
  ): OperationAck {
    if (!this.canClientDraw(client)) return { ok: false };
    if (typeof body?.id !== 'string' || body.id.trim() === '') {
      return { ok: false };
    }

    this.elements = this.elements.filter((element) => element.id !== body.id);
    this.server.emit('operation:element:remove', { id: body.id });
    return { ok: true };
  }

  @SubscribeMessage('operation:clear')
  handleClear(@ConnectedSocket() client: Socket): OperationAck {
    if (!this.canClientDraw(client)) return { ok: false };

    this.elements = [];
    this.server.emit('operation:clear');
    return { ok: true };
  }

  @SubscribeMessage('operation:background:update')
  handleBackgroundUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): OperationAck {
    if (!this.canClientDraw(client)) return { ok: false };

    const background = this.normalizeBackground(body);
    if (!background) return { ok: false };

    this.background = background;
    this.server.emit('operation:background:update', background);
    return { ok: true };
  }

  private getUserFromSocket(client: Socket): OperationUser | null {
    try {
      const cookieStr = client.handshake.headers.cookie || '';
      const match = cookieStr.match(/(?:^|;\s*)access_token=([^;]+)/);
      if (!match) return null;
      const token = decodeURIComponent(match[1]);
      const payload = this.jwtService.verify(token);
      if (!payload?.nickname) return null;
      return {
        nickname: payload.nickname,
        alliance: payload.allianceName || '',
        role: payload.role || 'member',
      };
    } catch {
      return null;
    }
  }

  private ensureUser(client: Socket): OperationUser | null {
    const existing = this.connectedUsers.get(client.id);
    if (existing) return existing;

    const user = this.getUserFromSocket(client);
    if (user) this.connectedUsers.set(client.id, user);
    return user;
  }

  private getParticipants(): OperationParticipant[] {
    return Array.from(this.participants.values()).map((participant) => ({
      ...participant,
      canDraw: this.canDraw(participant),
    }));
  }

  private broadcastPresence(): void {
    this.server.emit('operation:presence', this.getParticipants());
  }

  private isPrivilegedRole(role: string): boolean {
    return role === 'admin' || role === 'developer';
  }

  private canDraw(participant: OperationParticipant): boolean {
    return this.isPrivilegedRole(participant.role) || participant.canDraw;
  }

  private canClientDraw(client: Socket): boolean {
    const participant = this.participants.get(client.id);
    return participant ? this.canDraw(participant) : false;
  }

  private normalizeElement(element: unknown): OperationElement | null {
    if (!element || typeof element !== 'object' || Array.isArray(element)) {
      return null;
    }
    if (!this.isWithinJsonByteLimit(element, ELEMENT_JSON_BYTE_LIMIT)) {
      return null;
    }

    const source = element as Record<string, unknown>;
    const id = this.normalizeRequiredString(
      source.id,
      ELEMENT_ID_MAX_LENGTH,
    );
    if (!id) return null;

    const type = this.normalizeRequiredString(
      source.type,
      ELEMENT_STRING_MAX_LENGTH,
    );
    if (!type || !ALLOWED_ELEMENT_TYPES.has(type)) return null;

    const sanitized: OperationElement = { id, type };
    for (const [key, value] of Object.entries(source)) {
      if (key === 'id' || key === 'type') continue;

      if (typeof value === 'number') {
        if (Number.isFinite(value)) sanitized[key] = value;
        continue;
      }

      if (typeof value === 'string') {
        const maxLength = this.getElementStringMaxLength(key);
        if (value.length > maxLength) return null;
        sanitized[key] = value;
        continue;
      }

      if (typeof value === 'boolean') {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private normalizeBackground(body: unknown): OperationBackground | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

    const payload = body as { type?: unknown; imageUrl?: unknown };
    if (payload.type === 'grid') return { type: 'grid', imageUrl: null };
    if (payload.type === 'image') {
      if (!this.isValidBackgroundImageUrl(payload.imageUrl)) return null;
      return {
        type: 'image',
        imageUrl: payload.imageUrl,
      };
    }
    return null;
  }

  private isWithinJsonByteLimit(value: unknown, maxBytes: number): boolean {
    try {
      const json = JSON.stringify(value);
      return (
        typeof json === 'string' &&
        Buffer.byteLength(json, 'utf8') <= maxBytes
      );
    } catch {
      return false;
    }
  }

  private normalizeRequiredString(
    value: unknown,
    maxLength: number,
  ): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.length > maxLength) return null;
    return trimmed;
  }

  private getElementStringMaxLength(key: string): number {
    if (key === 'text') return ELEMENT_TEXT_MAX_LENGTH;
    if (key === 'color') return ELEMENT_COLOR_MAX_LENGTH;
    return ELEMENT_STRING_MAX_LENGTH;
  }

  private isValidBackgroundImageUrl(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      value.length <= BACKGROUND_IMAGE_URL_MAX_LENGTH &&
      value.startsWith(BACKGROUND_IMAGE_URL_PREFIX)
    );
  }
}
