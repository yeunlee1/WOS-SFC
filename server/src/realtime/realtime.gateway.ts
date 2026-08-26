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
import { BusyLockService, LockHolder } from './busy-lock.service';
import { UsersService } from '../users/users.service';
import { SOCKET_CORS_OPTIONS } from './socket-cors.options';

interface OnlineUser {
  nickname: string;
  alliance: string;
  role: string;
}

// setTimeout 자동 해제 여유 — countdown 총 시간 + 1초 후 lock 자동 release.
const COUNTDOWN_AUTO_RELEASE_GRACE_MS = 1000;

// countdown ack 응답 타입.
// `forbidden`은 의도적으로 제외 — 권한 없는 사용자에게 reason 노출 보안 우려.
// 권한 거부 시 `{ ok: false }`만 반환.
type CountdownAck =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid' | 'rate_limit' | 'busy';
      holder?: LockHolder | null;
    };

@WebSocketGateway({ cors: SOCKET_CORS_OPTIONS })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;

  private onlineMap = new Map<string, OnlineUser>();
  private countdown = { active: false, startedAt: 0, totalSeconds: 0 };

  // socket → 마지막 message 패킷의 engine.io 수신 시각.
  // time:ping의 t1을 핸들러 진입보다 앞선 시점으로 잡기 위한 것. socket 인스턴스가
  // GC되면 항목도 함께 사라지도록 WeakMap을 쓴다 (disconnect 시 별도 정리 불필요).
  private readonly packetReceivedAt = new WeakMap<object, number>();

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private readyNegotiation: ReadyNegotiationService,
    private rateLimit: WsRateLimitService,
    private busyLock: BusyLockService,
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
  private async getUserFromSocket(client: Socket): Promise<OnlineUser | null> {
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

  /**
   * engine.io 패킷 수신 시각 기록기를 붙인다.
   * socket.io 디코딩과 Nest 디스패치 파이프라인보다 앞선 시점이라, time:ping의 t1을
   * 핸들러 진입 시각보다 이르게 잡을 수 있다. 한 tick에 여러 패킷이 몰려 들어오면
   * 저장값이 뒤 패킷의 것일 수 있으나, 그 경우에도 항상 핸들러 진입 시각 이하이므로
   * 폴백보다 나빠지지 않는다.
   * engine.io 내부 구조가 다르거나(테스트 stub 등) 실패하면 조용히 폴백한다.
   */
  private trackPacketArrival(client: Socket): void {
    try {
      const conn = (client as unknown as { conn?: { on?: unknown } }).conn;
      if (!conn || typeof conn.on !== 'function') return;
      (conn.on as (e: string, cb: (p: unknown) => void) => void)(
        'packet',
        (packet: unknown) => {
          if ((packet as { type?: string })?.type === 'message') {
            this.packetReceivedAt.set(client, Date.now());
          }
        },
      );
    } catch {
      // 수신 시각을 못 잡아도 t1은 핸들러 진입 시각으로 폴백된다
    }
  }

  async handleConnection(client: Socket) {
    // await 이전에 붙인다 — 인증 조회 중 도착한 패킷도 시각이 기록되도록.
    this.trackPacketArrival(client);
    const user = await this.getUserFromSocket(client);
    if (!client.connected) return;
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
    client.emit('busy:state', { holder: this.busyLock.getHolder() });
  }

  // 시간 동기화용 ws ping/pong — REST `/time` 대비 HTTP overhead 5~20ms 절약.
  // 클라이언트가 ack callback으로 응답을 받아 NTP 4-timestamp 알고리즘에 사용.
  // Rate limit: 분당 30회 (정상 5초 주기 sync는 분당 12회 — 충분히 여유, abuse 차단).
  //
  // t1/t2의 의미 (clockSync.js와 짝을 이룸):
  //   rtt    = (t3 - t0) - (t2 - t1)        ← 서버 체류 시간을 왕복에서 뺀다
  //   offset = ((t1 - t0) + (t2 - t3)) / 2  ← 남은 왕복이 대칭이라 가정
  // 따라서 t2 - t1은 "서버가 이 요청을 붙들고 있던 시간"이어야 한다.
  // 이전 구현은 t1과 t2를 연속 두 줄에서 찍어 t2 - t1이 항상 0이었고, 서버 체류
  // 시간이 통째로 네트워크 지연으로 오인되어 그 절반이 offset 오차로 들어갔다.
  // 지금은 t1을 engine.io 패킷 수신 시각(없으면 핸들러 진입 시각)으로, t2를 응답
  // 직전으로 잡아 소켓 디코딩·디스패치·rate limit 처리 시간이 t2 - t1에 포함된다.
  //
  // 한계 — 패킷이 NIC에 도착한 뒤 libuv가 JS 콜백을 부르기까지의 대기는 JS에서
  // 관측할 수 없어 여전히 RTT로 계산된다. 이 핸들러로 줄일 수 있는 부분이 아니다.
  @SubscribeMessage('time:ping')
  handleTimePing(
    @ConnectedSocket() client: Socket,
  ): { utc: number; t1: number; t2: number } | null {
    const enteredAt = Date.now();
    const t1 = this.packetReceivedAt.get(client) ?? enteredAt;
    if (!this.rateLimit.check(client.id, 'time:ping', 30, 60_000)) return null;
    const t2 = Date.now();
    return { utc: t2, t1, t2 };
  }

  @SubscribeMessage('countdown:start')
  async handleCountdownStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() totalSeconds: number,
  ): Promise<CountdownAck | { ok: false }> {
    const user =
      this.onlineMap.get(client.id) ?? (await this.getUserFromSocket(client));
    if (!client.connected) return { ok: false };
    if (!user || !['admin', 'developer'].includes(user.role)) {
      return { ok: false }; // 권한 거부 — 사유 노출 안 함
    }
    if (
      typeof totalSeconds !== 'number' ||
      !Number.isInteger(totalSeconds) ||
      totalSeconds < 1 ||
      totalSeconds > 600
    ) {
      return { ok: false, reason: 'invalid' };
    }
    // Rate limit: 분당 5회 — 정상 SFC 사용 충분, ReadyNegotiation probe 폭증 방지.
    if (!this.rateLimit.check(client.id, 'countdown:start', 5, 60_000)) {
      return { ok: false, reason: 'rate_limit' };
    }

    // BusyLock 게이팅 — Countdown(1번) ↔ Rally(3번) 음성 충돌 방지.
    // probe 이전에 잠금 획득 — probe 중 동시 시작 race를 차단.
    const acquired = this.busyLock.tryAcquire(
      { type: 'countdown' },
      totalSeconds * 1000 + COUNTDOWN_AUTO_RELEASE_GRACE_MS,
      () => this.handleCountdownAutoExpire(),
    );
    if (!acquired) {
      return {
        ok: false,
        reason: 'busy',
        holder: this.busyLock.getHolder(),
      };
    }

    // 단계 5: probe 라운드트립으로 클라이언트 RTT 분포(p95)를 재고 startedAt을 정한다.
    //
    // 보장하는 것 — 느린 클라이언트도 첫 슬롯 시각 전에 스케줄을 끝낼 여유(grace).
    //   즉 "느린 사용자만 첫 숫자를 통째로 놓치는" 것을 막는다.
    // 보장하지 못하는 것 — 디바이스 간 발화 정렬 정확도. 각 클라이언트는 서버
    //   절대시각을 자기 시계 추정(timeOffset)으로 환산해 발화하므로, 모두에게 값이
    //   같은 startedAt은 상대 정렬 계산에서 소거된다. 실제 정렬 오차는 시계 offset
    //   추정 오차 + 타이머 지터 + 오디오 출력 지연이 결정하며 본 협상으로 줄지 않는다.
    //   (과거 주석의 "±30ms 보장"은 사실이 아니었다.)
    //
    // onlineMap 키를 넘겨 인증된 소켓만 probe 한다 — 미인증 소켓은 클라이언트가
    // 'time:probe' 핸들러를 아직 등록하지 않아 구조적으로 ack하지 않는다.
    // SFC가 클릭 후 대기하는 비용 — UX 트레이드오프.
    // probe 실패 시 lock leak 방지 — 자동 release 후 재throw.
    let startedAt: number;
    try {
      startedAt = await this.readyNegotiation.negotiateStartedAt(
        this.server,
        new Set(this.onlineMap.keys()),
      );
    } catch (err) {
      this.busyLock.release({ type: 'countdown' });
      this.server.emit('busy:state', { holder: null });
      throw err;
    }

    // race 가드 — negotiateStartedAt await 도중 다른 admin이 stop 호출하여
    // lock이 풀렸거나 다른 holder로 점유된 경우, countdown.active=true를 lock 없이
    // 설정하면 게이팅 우회가 가능해진다. 따라서 holder가 여전히 'countdown'인지 재확인.
    // 일치하지 않으면 abort + ack { ok: false, reason: 'busy', holder } 반환,
    // countdown 상태/broadcast는 변경 안 함 (stop 측이 이미 idle broadcast 완료).
    const currentHolder = this.busyLock.getHolder();
    if (!currentHolder || currentHolder.type !== 'countdown') {
      return {
        ok: false,
        reason: 'busy',
        holder: currentHolder,
      };
    }

    this.countdown = { active: true, startedAt, totalSeconds };
    this.server.emit('countdown:state', {
      ...this.countdown,
      serverEmitAt: Date.now(),
    });
    this.server.emit('busy:state', { holder: this.busyLock.getHolder() });
    return { ok: true };
  }

  @SubscribeMessage('countdown:stop')
  async handleCountdownStop(
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean }> {
    const user =
      this.onlineMap.get(client.id) ?? (await this.getUserFromSocket(client));
    if (!client.connected) return { ok: false };
    if (!user || !['admin', 'developer'].includes(user.role))
      return { ok: false };

    // holder 가드 — 다른 type(rally)이 lock을 잡고 있으면 countdown stop은 영향 X.
    // 단, 내부 countdown 상태는 어차피 idle이므로 추가 변경 없이 ack만 반환.
    const holder = this.busyLock.getHolder();
    if (holder && holder.type !== 'countdown') {
      return { ok: false };
    }

    this.busyLock.release({ type: 'countdown' });
    this.countdown = { active: false, startedAt: 0, totalSeconds: 0 };
    this.server.emit('countdown:state', {
      ...this.countdown,
      serverEmitAt: Date.now(),
    });
    this.server.emit('busy:state', { holder: null });
    return { ok: true };
  }

  /**
   * setTimeout 만료 시 호출 — 카운트다운 시간이 끝났는데 사용자가 stop을 안 누른 경우
   * 자동으로 active=false로 reset하여 모든 클라이언트 동기화.
   * 이 시점에 BusyLockService 내부 holder는 이미 null (autoRelease가 holder→null 후 콜백 호출).
   */
  private handleCountdownAutoExpire(): void {
    this.countdown = { active: false, startedAt: 0, totalSeconds: 0 };
    this.server.emit('countdown:state', {
      ...this.countdown,
      serverEmitAt: Date.now(),
    });
    this.server.emit('busy:state', { holder: null });
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
    const socketIds = Array.from(this.onlineMap.entries())
      .filter(([, user]) => user.nickname === nickname)
      .map(([socketId]) => socketId);
    for (const socketId of socketIds) {
      const socket = this.server.sockets.sockets.get(socketId);
      socket?.disconnect();
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
