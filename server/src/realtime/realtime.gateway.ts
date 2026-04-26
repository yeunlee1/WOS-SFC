// server/src/realtime/realtime.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Inject, forwardRef } from '@nestjs/common';
import { NoticesService } from '../notices/notices.service';
import { RalliesService } from '../rallies/rallies.service';
import { MembersService } from '../members/members.service';
import { BoardsService } from '../boards/boards.service';
import { AllianceNoticesService } from '../alliance-notices/alliance-notices.service';
import { ReadyNegotiationService } from './ready-negotiation.service';
import { WsRateLimitService } from './ws-rate-limit.service';

interface OnlineUser {
  nickname: string;
  alliance: string;
  role: string;
}

// production 환경에서 WEB_ORIGIN 미설정 시 실수로 모든 origin을 허용하는 fallback이 되지 않도록 에러.
if (process.env.NODE_ENV === 'production' && !process.env.WEB_ORIGIN) {
  throw new Error(
    'WEB_ORIGIN 환경변수가 production에서 필수입니다. CORS 보안을 위해 명시적으로 설정하세요.',
  );
}
const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';

@WebSocketGateway({ cors: { origin: WEB_ORIGIN, credentials: true } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;

  private onlineMap = new Map<string, OnlineUser>();
  private countdown = { active: false, startedAt: 0, totalSeconds: 0 };

  constructor(
    private jwtService: JwtService,
    private readyNegotiation: ReadyNegotiationService,
    private rateLimit: WsRateLimitService,
    @Inject(forwardRef(() => NoticesService))
    private noticesService: NoticesService,
    @Inject(forwardRef(() => RalliesService))
    private ralliesService: RalliesService,
    @Inject(forwardRef(() => MembersService))
    private membersService: MembersService,
    @Inject(forwardRef(() => BoardsService))
    private boardsService: BoardsService,
    @Inject(forwardRef(() => AllianceNoticesService))
    private allianceNoticesService: AllianceNoticesService,
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
    if (!user) {
      client.disconnect();
      return;
    }

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
      const allianceNotices =
        await this.allianceNoticesService.findByAlliance(a);
      client.emit(
        `alliance-notice:updated:${a}`,
        allianceNotices.map(this.formatAllianceNotice),
      );
    }

    client.emit('countdown:state', {
      ...this.countdown,
      serverEmitAt: Date.now(),
    });
  }

  // 시간 동기화용 ws ping/pong — REST `/time` 대비 HTTP overhead 5~20ms 절약.
  // 클라이언트가 ack callback으로 응답을 받아 NTP 4-timestamp 알고리즘에 사용.
  // Rate limit: 분당 30회 (정상 5초 주기 sync는 분당 12회 — 충분히 여유, abuse 차단).
  @SubscribeMessage('time:ping')
  handleTimePing(
    @ConnectedSocket() client: Socket,
  ): { utc: number; t1: number; t2: number } | null {
    if (!this.rateLimit.check(client.id, 'time:ping', 30, 60_000)) return null;
    const t1 = Date.now();
    const t2 = Date.now();
    return { utc: t2, t1, t2 };
  }

  @SubscribeMessage('countdown:start')
  async handleCountdownStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() totalSeconds: number,
  ) {
    const user = this.getUserFromSocket(client);
    if (!user || !['admin', 'developer'].includes(user.role)) return;
    if (
      typeof totalSeconds !== 'number' ||
      !Number.isInteger(totalSeconds) ||
      totalSeconds < 1 ||
      totalSeconds > 600
    )
      return;
    // Rate limit: 분당 5회 — 정상 SFC 사용 충분, ReadyNegotiation probe 폭증 방지.
    if (!this.rateLimit.check(client.id, 'countdown:start', 5, 60_000)) return;

    // 단계 5: probe 라운드트립으로 모든 클라이언트의 maxRTT 측정 후 startedAt 결정.
    // → 모든 디바이스가 정확히 같은 절대 시각에 TTS 발화 시작 (±30ms 보장).
    // SFC가 클릭 후 0.5~1초 대기 비용 — UX 트레이드오프.
    const startedAt = await this.readyNegotiation.negotiateStartedAt(
      this.server,
    );

    this.countdown = { active: true, startedAt, totalSeconds };
    this.server.emit('countdown:state', {
      ...this.countdown,
      serverEmitAt: Date.now(),
    });
  }

  @SubscribeMessage('countdown:stop')
  handleCountdownStop(@ConnectedSocket() client: Socket) {
    const user = this.getUserFromSocket(client);
    if (!user || !['admin', 'developer'].includes(user.role)) return;

    this.countdown = { active: false, startedAt: 0, totalSeconds: 0 };
    this.server.emit('countdown:state', {
      ...this.countdown,
      serverEmitAt: Date.now(),
    });
  }

  handleDisconnect(client: Socket) {
    this.onlineMap.delete(client.id);
    this.rateLimit.cleanup(client.id);
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
    this.server.emit(
      `board:updated:${alliance}`,
      posts.map(this.formatBoardPost),
    );
  }

  async broadcastAllianceNotice(alliance: string) {
    const notices = await this.allianceNoticesService.findByAlliance(alliance);
    this.server.emit(
      `alliance-notice:updated:${alliance}`,
      notices.map(this.formatAllianceNotice),
    );
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
      createdAt:
        n.createdAt instanceof Date
          ? n.createdAt.toLocaleString('ko-KR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
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
      createdAt:
        n.createdAt instanceof Date
          ? n.createdAt.toLocaleString('ko-KR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
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
      createdAt:
        p.createdAt instanceof Date
          ? p.createdAt.toLocaleString('ko-KR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : String(p.createdAt),
    };
  }
}
