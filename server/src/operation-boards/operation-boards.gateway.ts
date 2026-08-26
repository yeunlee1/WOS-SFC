// 작전판 실시간 세션 상태와 드로잉 이벤트를 중계한다.
import { randomUUID } from 'node:crypto';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { SOCKET_CORS_OPTIONS } from '../realtime/socket-cors.options';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import { isOperationBoardBackgroundUrl } from './operation-board-upload.options';
import {
  MAX_OPERATION_ELEMENTS,
  MAX_OPERATION_ELEMENTS_BYTES,
  normalizeOperationElement,
  operationElementBytes,
  validateOperationElements,
  type OperationElement,
} from './operation-board-elements';

type OperationAck = { ok: boolean; reason?: string };

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

type RateRule = { limit: number; windowMs: number };

/**
 * 작전판 이벤트를 격리하는 room 이름.
 * 네임스페이스가 아니라 room 이라 접속 URL 은 바뀌지 않는다 —
 * 작전판을 열지 않은 접속자는 드로잉 이벤트를 한 건도 받지 않는다.
 */
export const OPERATION_BOARD_ROOM = 'operation-board';

/**
 * presence 브로드캐스트를 묶는 시간 창(ms).
 *
 * 근거 — presence 는 참가자 전체 목록을 담은 스냅샷이라 한 건의 크기가 참가자 수에
 * 비례한다. room 격리로 작전판을 열지 않은 접속자는 이미 제외됐지만, 100명이 작전
 * 직전에 탭을 함께 여는 경우는 그대로 남는다. 그때 k번째 입장이 k명에게 k명분 목록을
 * 보내므로 총량이 참가자 수의 제곱으로 늘고(100명이면 접속자 1인당 약 650KB),
 * 그 바이트가 카운트다운과 같은 웹소켓을 지나며 "출발" 신호를 뒤로 밀어낸다.
 *
 * 창을 두면 그 구간의 입퇴장이 한 건으로 합쳐진다. 참가자 목록은 늦어도 되는 정보라
 * 120ms 지연은 화면에서 구분되지 않는다. 카운트다운·드로잉 이벤트에는 적용하지 않는다.
 */
export const PRESENCE_COALESCE_MS = 120;

/**
 * 이벤트별 요청 제한.
 *
 * 드로잉 근거 — 캔버스는 pointerdown~pointerup 한 획을 요소 1개로 보낸다.
 * pointermove 는 로컬 draft 만 갱신하고 전송하지 않는다.
 * 사람이 낼 수 있는 최대 속도는 마커 연타 기준 초당 8회 정도라
 * 초당 12회(10초에 120회)면 정상 드로잉을 끊지 않으면서 폭주는 막는다.
 * 지우개도 탭 1회당 1건이라 같은 값을 쓴다.
 */
const RATE_RULES = {
  'operation:join': { limit: 20, windowMs: 60_000 },
  'operation:leave': { limit: 30, windowMs: 60_000 },
  'operation:chat-open': { limit: 30, windowMs: 60_000 },
  'operation:permission:update': { limit: 120, windowMs: 60_000 },
  'operation:element:add': { limit: 120, windowMs: 10_000 },
  'operation:element:remove': { limit: 120, windowMs: 10_000 },
  'operation:clear': { limit: 10, windowMs: 60_000 },
  'operation:background:update': { limit: 20, windowMs: 60_000 },
  'operation:board:replace': { limit: 6, windowMs: 60_000 },
} satisfies Record<string, RateRule>;

export const OPERATION_REJECT_REASONS = {
  rateLimited: '작전판 요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.',
  forbidden: '작전판을 바꿀 권한이 없습니다.',
  invalidElement: '작전판 요소 형식이 올바르지 않습니다.',
  invalidBackground: '작전판 배경 형식이 올바르지 않습니다.',
  tooManyElements: `작전판 요소는 최대 ${MAX_OPERATION_ELEMENTS}개까지만 유지됩니다. 저장 후 지우기를 해주세요.`,
  tooLarge: `작전판 데이터가 상한(${Math.floor(MAX_OPERATION_ELEMENTS_BYTES / 1000)}KB)을 넘었습니다. 저장 후 지우기를 해주세요.`,
};

function rejectionReason(rejection: 'invalid' | 'too-many' | 'too-large') {
  if (rejection === 'too-many') return OPERATION_REJECT_REASONS.tooManyElements;
  if (rejection === 'too-large') return OPERATION_REJECT_REASONS.tooLarge;
  return OPERATION_REJECT_REASONS.invalidElement;
}

@WebSocketGateway({ cors: SOCKET_CORS_OPTIONS })
export class OperationBoardsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer() server: Server;

  private connectedUsers = new Map<string, OperationUser>();
  private participants = new Map<string, OperationParticipant>();
  private elements: OperationElement[] = [];
  private elementsBytes = 0;
  private background: OperationBackground = { type: 'grid', imageUrl: null };
  /** 예약된 presence 브로드캐스트. 창이 열려 있는 동안만 값이 있다. */
  private presenceTimer: NodeJS.Timeout | null = null;

  /**
   * 프로세스가 살아 있는 동안만 유지되는 라이브 세션 식별자.
   * 라이브 작전판은 메모리에만 있어 재배포·크래시로 사라진다.
   * 클라이언트는 이 값이 바뀐 것을 보고 "초기화됐다"를 사용자에게 알린다.
   */
  private readonly sessionId = randomUUID();

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly rateLimit: WsRateLimitService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const user = await this.getUserFromSocket(client);
    if (!client.connected) return;
    if (!user) {
      client.disconnect();
      return;
    }
    this.connectedUsers.set(client.id, user);
  }

  handleDisconnect(client: Socket): void {
    this.connectedUsers.delete(client.id);
    const wasParticipant = this.participants.delete(client.id);
    this.rateLimit.cleanup(client.id);
    if (wasParticipant) this.broadcastPresence();
  }

  @SubscribeMessage('operation:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body?: { chatOpen?: boolean },
  ): Promise<OperationAck> {
    const limited = this.checkRate(client, 'operation:join');
    if (limited) return limited;

    const user = await this.ensureUser(client);
    if (!client.connected || !user) {
      if (!client.connected) return { ok: false };
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
    void client.join(OPERATION_BOARD_ROOM);

    client.emit('operation:state', {
      elements: [...this.elements],
      background: { ...this.background },
      participants: this.getParticipants(),
      canDraw: this.canDraw(participant),
      sessionId: this.sessionId,
    });
    this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:permission:update')
  handlePermissionUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { participantId?: unknown; canDraw?: unknown },
  ): OperationAck {
    const limited = this.checkRate(client, 'operation:permission:update');
    if (limited) return limited;

    const actor = this.participants.get(client.id);
    if (!actor || !this.isPrivilegedRole(actor.role)) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.forbidden };
    }
    if (typeof body?.participantId !== 'string') return { ok: false };
    if (typeof body.canDraw !== 'boolean') return { ok: false };

    const participant = this.participants.get(body.participantId);
    if (!participant) return { ok: false };

    const nextCanDraw = this.isPrivilegedRole(participant.role) || body.canDraw;
    // 값이 그대로면 뿌리지 않는다 — presence 는 참가자 전원의 전체 목록이라 한 번이 비싸다.
    if (participant.canDraw === nextCanDraw) return { ok: true };

    participant.canDraw = nextCanDraw;
    this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:leave')
  handleLeave(@ConnectedSocket() client: Socket): OperationAck {
    const limited = this.checkRate(client, 'operation:leave');
    if (limited) return limited;

    const wasParticipant = this.participants.delete(client.id);
    void client.leave(OPERATION_BOARD_ROOM);
    if (wasParticipant) this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:chat-open')
  handleChatOpen(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatOpen?: unknown },
  ): OperationAck {
    const limited = this.checkRate(client, 'operation:chat-open');
    if (limited) return limited;

    const participant = this.participants.get(client.id);
    if (!participant || typeof body?.chatOpen !== 'boolean') {
      return { ok: false };
    }
    // 웹 훅은 마운트 직후 join 과 같은 값으로 chat-open 을 한 번 더 보낸다.
    // 그 중복까지 presence 전체 목록을 다시 뿌리면 접속자 수만큼 낭비가 곱해진다.
    if (participant.chatOpen === body.chatOpen) return { ok: true };

    participant.chatOpen = body.chatOpen;
    this.broadcastPresence();
    return { ok: true };
  }

  @SubscribeMessage('operation:element:add')
  handleElementAdd(
    @ConnectedSocket() client: Socket,
    @MessageBody() element: unknown,
  ): OperationAck {
    const limited = this.checkRate(client, 'operation:element:add');
    if (limited) return limited;
    if (!this.canClientDraw(client)) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.forbidden };
    }

    const normalized = normalizeOperationElement(element);
    if (!normalized) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.invalidElement };
    }

    // 상한을 넘기면 조용히 가장 오래된 요소를 잘라내지 않고 거절 사실을 알린다.
    if (this.elements.length >= MAX_OPERATION_ELEMENTS) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.tooManyElements };
    }
    const bytes = operationElementBytes(normalized);
    if (this.elementsBytes + bytes > MAX_OPERATION_ELEMENTS_BYTES) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.tooLarge };
    }

    this.elements.push(normalized);
    this.elementsBytes += bytes;
    this.broadcast('operation:element:add', normalized);
    return { ok: true };
  }

  @SubscribeMessage('operation:element:remove')
  handleElementRemove(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { id?: unknown },
  ): OperationAck {
    const limited = this.checkRate(client, 'operation:element:remove');
    if (limited) return limited;
    if (!this.canClientDraw(client)) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.forbidden };
    }
    if (typeof body?.id !== 'string' || body.id.trim() === '') {
      return { ok: false };
    }

    const kept: OperationElement[] = [];
    let removedBytes = 0;
    for (const element of this.elements) {
      if (element.id === body.id)
        removedBytes += operationElementBytes(element);
      else kept.push(element);
    }
    this.elements = kept;
    this.elementsBytes = Math.max(0, this.elementsBytes - removedBytes);
    this.broadcast('operation:element:remove', { id: body.id });
    return { ok: true };
  }

  @SubscribeMessage('operation:clear')
  handleClear(@ConnectedSocket() client: Socket): OperationAck {
    const limited = this.checkRate(client, 'operation:clear');
    if (limited) return limited;
    if (!this.canClientManage(client)) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.forbidden };
    }

    this.elements = [];
    this.elementsBytes = 0;
    this.broadcast('operation:clear');
    return { ok: true };
  }

  /**
   * 저장본 불러오기 — 요소를 하나씩 보내면 500개 저장본이 브로드캐스트 500건이 되어
   * 카운트다운 경로까지 밀린다. 배경과 요소를 한 이벤트로 통째로 교체한다.
   */
  @SubscribeMessage('operation:board:replace')
  handleBoardReplace(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { elements?: unknown; background?: unknown },
  ): OperationAck {
    const limited = this.checkRate(client, 'operation:board:replace');
    if (limited) return limited;
    if (!this.canClientManage(client)) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.forbidden };
    }

    const validated = validateOperationElements(body?.elements ?? []);
    if (validated.rejection) {
      return { ok: false, reason: rejectionReason(validated.rejection) };
    }

    const background =
      body?.background === undefined
        ? { type: 'grid' as const, imageUrl: null }
        : this.normalizeBackground(body.background);
    if (!background) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.invalidBackground };
    }

    this.elements = validated.elements;
    this.elementsBytes = validated.bytes;
    this.background = background;
    this.broadcast('operation:board:replace', {
      elements: [...this.elements],
      background: { ...this.background },
    });
    return { ok: true };
  }

  @SubscribeMessage('operation:background:update')
  handleBackgroundUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): OperationAck {
    const limited = this.checkRate(client, 'operation:background:update');
    if (limited) return limited;
    if (!this.canClientManage(client)) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.forbidden };
    }

    const background = this.normalizeBackground(body);
    if (!background) {
      return { ok: false, reason: OPERATION_REJECT_REASONS.invalidBackground };
    }

    this.background = background;
    this.broadcast('operation:background:update', background);
    return { ok: true };
  }

  /** 요청 제한에 걸리면 거절 ack 를, 통과하면 null 을 돌려준다. */
  private checkRate(
    client: Socket,
    event: keyof typeof RATE_RULES,
  ): OperationAck | null {
    const rule = RATE_RULES[event];
    if (this.rateLimit.check(client.id, event, rule.limit, rule.windowMs)) {
      return null;
    }
    return { ok: false, reason: OPERATION_REJECT_REASONS.rateLimited };
  }

  /** 작전판 room 안으로만 브로드캐스트한다. */
  private broadcast(event: string, payload?: unknown): void {
    if (payload === undefined) this.server.to(OPERATION_BOARD_ROOM).emit(event);
    else this.server.to(OPERATION_BOARD_ROOM).emit(event, payload);
  }

  private async getUserFromSocket(
    client: Socket,
  ): Promise<OperationUser | null> {
    try {
      const cookieStr = client.handshake.headers.cookie || '';
      const match = cookieStr.match(/(?:^|;\s*)access_token=([^;]+)/);
      if (!match) return null;
      const token = decodeURIComponent(match[1]);
      const payload = this.jwtService.verify<{ sub?: number }>(token);
      if (!Number.isInteger(payload.sub)) return null;
      const currentUser = await this.usersService.findById(payload.sub!);
      if (!currentUser) return null;
      return {
        nickname: currentUser.nickname,
        alliance: currentUser.allianceName || '',
        role: currentUser.role,
      };
    } catch {
      return null;
    }
  }

  private async ensureUser(client: Socket): Promise<OperationUser | null> {
    if (!client.connected) return null;
    const existing = this.connectedUsers.get(client.id);
    if (existing) return existing;

    const user = await this.getUserFromSocket(client);
    if (!client.connected) return null;
    if (user) this.connectedUsers.set(client.id, user);
    return user;
  }

  private getParticipants(): OperationParticipant[] {
    return Array.from(this.participants.values()).map((participant) => ({
      ...participant,
      canDraw: this.canDraw(participant),
    }));
  }

  /**
   * 참가자 목록 브로드캐스트를 예약한다.
   *
   * 창이 이미 열려 있으면 예약을 겹치지 않는다. 창이 닫힐 때 그 시점의 전체 목록을
   * 새로 만들어 보내므로, 창 안에서 일어난 입퇴장·권한 변경이 모두 반영된 한 건이 나간다.
   * 스냅샷을 통째로 보내는 이벤트라 중간 상태를 건너뛰어도 결과가 달라지지 않는다.
   */
  private broadcastPresence(): void {
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.broadcast('operation:presence', this.getParticipants());
    }, PRESENCE_COALESCE_MS);
    // 남은 예약 하나 때문에 프로세스 종료가 늦어지지 않게 한다.
    this.presenceTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (!this.presenceTimer) return;
    clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
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

  private canClientManage(client: Socket): boolean {
    const participant = this.participants.get(client.id);
    return participant ? this.isPrivilegedRole(participant.role) : false;
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

  private isValidBackgroundImageUrl(value: unknown): value is string {
    return isOperationBoardBackgroundUrl(value);
  }
}
