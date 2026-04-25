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
import { AllianceNoticesService } from '../alliance-notices/alliance-notices.service';

interface OnlineUser {
  nickname: string;
  alliance: string;
  role: string;
}

const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';

@WebSocketGateway({ cors: { origin: WEB_ORIGIN, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private onlineMap = new Map<string, OnlineUser>();
  private countdown = { active: false, startedAt: 0, totalSeconds: 0 };

  // 카운트다운 시작 시 startedAt을 현재 시각이 아니라 STARTUP_GRACE_MS 미래로 결정.
  // 모든 클라이언트가 broadcast를 도착 받기 전에 미래 슬롯을 schedule할 수 있도록 보장 —
  // TTS 동기 발화의 핵심 보장. 값이 너무 크면 SFC 클릭 후 시작 지연 체감, 너무 작으면
  // 느린 네트워크 클라이언트가 첫 슬롯 놓침. 500ms는 일반적 RTT(50~300ms) + 마진.
  private static readonly STARTUP_GRACE_MS = 500;

  constructor(
    private jwtService: JwtService,
    @Inject(forwardRef(() => NoticesService)) private noticesService: NoticesService,
    @Inject(forwardRef(() => RalliesService)) private ralliesService: RalliesService,
    @Inject(forwardRef(() => MembersService)) private membersService: MembersService,
    @Inject(forwardRef(() => BoardsService)) private boardsService: BoardsService,
    @Inject(forwardRef(() => AllianceNoticesService)) private allianceNoticesService: AllianceNoticesService,
  ) {}

  // httpOnly 쿠키에서 access_token 파싱 후 JWT 검증
  private getUserFromSocket(client: Socket): OnlineUser | null {
    try {
      const cookieStr = client.handshake.headers.cookie || '';
      const match = cookieStr.match(/(?:^|;\s*)access_token=([^;]+)/);
      if (!match) return null;
      const token = decodeURIComponent(match[1]);
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

    for (const a of ['KOR', 'NSL', 'JKY', 'GPX', 'UFO']) {
      const allianceNotices = await this.allianceNoticesService.findByAlliance(a);
      client.emit(`alliance-notice:updated:${a}`, allianceNotices.map(this.formatAllianceNotice));
    }

    client.emit('countdown:state', { ...this.countdown, serverEmitAt: Date.now() });
  }

  // 시간 동기화용 ws ping/pong — REST `/time` 대비 HTTP overhead 5~20ms 절약.
  // 클라이언트가 ack callback으로 응답을 받아 NTP 4-timestamp 알고리즘에 사용.
  @SubscribeMessage('time:ping')
  handleTimePing(): { utc: number; t1: number; t2: number } {
    const t1 = Date.now();
    const t2 = Date.now();
    return { utc: t2, t1, t2 };
  }

  @SubscribeMessage('countdown:start')
  handleCountdownStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() totalSeconds: number,
  ) {
    const user = this.getUserFromSocket(client);
    if (!user || !['admin', 'developer', 'SFC'].includes(user.role)) return;
    if (typeof totalSeconds !== 'number' || totalSeconds < 1 || totalSeconds > 600) return;

    this.countdown = {
      active: true,
      startedAt: Date.now() + RealtimeGateway.STARTUP_GRACE_MS,
      totalSeconds,
    };
    this.server.emit('countdown:state', { ...this.countdown, serverEmitAt: Date.now() });
  }

  @SubscribeMessage('countdown:stop')
  handleCountdownStop(@ConnectedSocket() client: Socket) {
    const user = this.getUserFromSocket(client);
    if (!user || !['admin', 'developer', 'SFC'].includes(user.role)) return;

    this.countdown = { active: false, startedAt: 0, totalSeconds: 0 };
    this.server.emit('countdown:state', { ...this.countdown, serverEmitAt: Date.now() });
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

  // 특정 닉네임의 유저 소켓을 강제 종료 (Admin 벤 기능에서 호출)
  kickUser(nickname: string): void {
    for (const [socketId, user] of this.onlineMap.entries()) {
      if (user.nickname === nickname) {
        const socket = this.server.sockets.sockets.get(socketId);
        socket?.disconnect();
        break;
      }
    }
  }

  async broadcastBoard(alliance: string) {
    const posts = await this.boardsService.findByAlliance(alliance);
    this.server.emit(`board:updated:${alliance}`, posts.map(this.formatBoardPost));
  }

  async broadcastAllianceNotice(alliance: string) {
    const notices = await this.allianceNoticesService.findByAlliance(alliance);
    this.server.emit(`alliance-notice:updated:${alliance}`, notices.map(this.formatAllianceNotice));
  }

  private formatAllianceNotice(n: any) {
    return {
      id: n.id,
      alliance: n.alliance,
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
      imageUrls: p.imageUrls || [],
      createdAt: p.createdAt instanceof Date
        ? p.createdAt.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
        : String(p.createdAt),
    };
  }
}
