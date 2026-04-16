// server/src/realtime/realtime.gateway.ts
import {
  WebSocketGateway, WebSocketServer,
  OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Inject, forwardRef } from '@nestjs/common';
import { NoticesService } from '../notices/notices.service';
import { RalliesService } from '../rallies/rallies.service';
import { MembersService } from '../members/members.service';
import { BoardsService } from '../boards/boards.service';

interface OnlineUser {
  nickname: string;
  alliance: string;
  role: string;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  // socketId → OnlineUser
  private onlineMap = new Map<string, OnlineUser>();

  // 카운트다운 상태 (인메모리)
  private countdown = { active: false, startedAt: 0, totalSeconds: 0 };

  constructor(
    private jwtService: JwtService,
    @Inject(forwardRef(() => NoticesService)) private noticesService: NoticesService,
    @Inject(forwardRef(() => RalliesService)) private ralliesService: RalliesService,
    @Inject(forwardRef(() => MembersService)) private membersService: MembersService,
    @Inject(forwardRef(() => BoardsService)) private boardsService: BoardsService,
  ) {}

  private getUserFromSocket(client: Socket): OnlineUser | null {
    try {
      const token = client.handshake.auth?.token;
      if (!token) return null;
      const payload = this.jwtService.verify(token);
      return {
        nickname: payload.nickname,
        alliance: payload.allianceName || '',
        role: payload.role || 'member',
      };
    } catch {
      return null;
    }
  }

  async handleConnection(client: Socket) {
    const user = this.getUserFromSocket(client);
    if (!user) { client.disconnect(); return; }

    this.onlineMap.set(client.id, user);
    this.broadcastOnline();

    // 초기 데이터 전송
    const [notices, rallies, members, boards] = await Promise.all([
      this.noticesService.findAll(),
      this.ralliesService.findAll(),
      this.membersService.findAll(),
      this.boardsService.findAllGrouped(),
    ]);

    client.emit('notices:updated', notices.map(this.formatNotice));
    client.emit('rallies:updated', rallies.map(this.formatRally));
    client.emit('members:updated', members.map(this.formatMember));
    for (const [alliance, posts] of Object.entries(boards)) {
      client.emit(`board:updated:${alliance}`, posts.map(this.formatBoardPost));
    }

    // 현재 카운트다운 상태 전송
    client.emit('countdown:state', this.countdown);
  }

  @SubscribeMessage('countdown:start')
  handleCountdownStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() totalSeconds: number,
  ) {
    const user = this.getUserFromSocket(client);
    if (!user || !['admin', 'developer', 'SFC'].includes(user.role)) return;
    if (typeof totalSeconds !== 'number' || totalSeconds < 1 || totalSeconds > 600) return;

    this.countdown = { active: true, startedAt: Date.now(), totalSeconds };
    this.server.emit('countdown:state', this.countdown);
  }

  @SubscribeMessage('countdown:stop')
  handleCountdownStop(@ConnectedSocket() client: Socket) {
    const user = this.getUserFromSocket(client);
    if (!user || !['admin', 'developer', 'SFC'].includes(user.role)) return;

    this.countdown = { active: false, startedAt: 0, totalSeconds: 0 };
    this.server.emit('countdown:state', this.countdown);
  }

  handleDisconnect(client: Socket) {
    this.onlineMap.delete(client.id);
    this.broadcastOnline();
  }

  broadcastOnline() {
    const users = Array.from(this.onlineMap.values());
    this.server.emit('online:updated', users);
  }

  async broadcastNotices() {
    const notices = await this.noticesService.findAll();
    this.server.emit('notices:updated', notices.map(this.formatNotice));
  }

  async broadcastRallies() {
    const rallies = await this.ralliesService.findAll();
    this.server.emit('rallies:updated', rallies.map(this.formatRally));
  }

  async broadcastMembers() {
    const members = await this.membersService.findAll();
    this.server.emit('members:updated', members.map(this.formatMember));
  }

  async broadcastBoard(alliance: string) {
    const posts = await this.boardsService.findByAlliance(alliance);
    this.server.emit(`board:updated:${alliance}`, posts.map(this.formatBoardPost));
  }

  private formatNotice(n: any) {
    return {
      id: n.id,
      source: n.source,
      title: n.title,
      content: n.content,
      authorNick: n.authorNick,
      lang: n.lang,
      createdAt: n.createdAt instanceof Date
        ? n.createdAt.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
        : String(n.createdAt),
    };
  }

  private formatRally(r: any) {
    return {
      id: r.id,
      name: r.name,
      endTimeUTC: Number(r.endTimeUTC),
      totalSeconds: r.totalSeconds,
    };
  }

  private formatMember(m: any) {
    return { id: m.id, name: m.name, role: m.role, notes: m.notes };
  }

  private formatBoardPost(p: any) {
    return {
      id: p.id,
      alliance: p.alliance,
      nickname: p.nickname,
      userAlliance: p.userAlliance,
      content: p.content,
      lang: p.lang,
      createdAt: p.createdAt instanceof Date
        ? p.createdAt.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
        : String(p.createdAt),
    };
  }
}
