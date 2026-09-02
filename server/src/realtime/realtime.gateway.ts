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
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { NoticesService } from '../notices/notices.service';
import { RalliesService } from '../rallies/rallies.service';
import { MembersService } from '../members/members.service';
import { BoardsService } from '../boards/boards.service';
import { AllianceNoticesService } from '../alliance-notices/alliance-notices.service';
import { ReadyNegotiationService } from './ready-negotiation.service';
import { WsRateLimitService } from './ws-rate-limit.service';
import { BusyLockService, LockHolder } from './busy-lock.service';
import { SocketAuthService } from './socket-auth.service';
import { SOCKET_CORS_OPTIONS } from './socket-cors.options';

interface OnlineUser {
  nickname: string;
  alliance: string;
  role: string;
}

// setTimeout 자동 해제 여유 — countdown 실제 종료 시각 + 1초 후 lock 자동 release.
const COUNTDOWN_AUTO_RELEASE_GRACE_MS = 1000;

// 접속 스냅샷으로 내려보내는 연맹 목록. 방출 순서를 이 순서로 고정한다.
const SNAPSHOT_ALLIANCES = ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'] as const;

// 접속 1건이 수백 행을 직렬화한다. toLocaleString(옵션 객체)은 호출마다 Intl 포매터를
// 새로 만들어 행당 약 30µs가 들지만, 포매터를 한 번 만들어 재사용하면 약 1µs다
// (이 PC에서 20,000회 평균 30.8µs → 1.05µs, 2,000개 날짜 표본에서 출력 문자열 불일치 0건).
// 100명 동시 재접속이면 이 차이가 이벤트 루프 동기 블로킹으로 누적돼 카운트다운
// broadcast를 밀어낸다.
//
// 한계 — 로케일이 'ko-KR'로 고정이라 다국어 사용자에게도 한국어 표기가 나간다.
// 서버가 문자열 대신 epoch ms를 보내고 표시를 클라이언트에 맡기는 것이 옳지만
// 이벤트 계약 변경이라 여기서는 다루지 않는다.
const KO_DATETIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short',
  timeStyle: 'short',
  // 컨테이너는 UTC 라 고정하지 않으면 공지·게시글 시각이 9시간 이르게 보인다.
  // DB 비교는 UTC 그대로 두고 표시만 KST 로 고정한다(앱 컨테이너에 TZ 를 넣지 말 것).
  timeZone: 'Asia/Seoul',
});

/**
 * online:updated 를 묶는 시간 창(ms). operation-boards.gateway.ts 의 PRESENCE_COALESCE_MS 와 같은 근거 —
 * 재배포 뒤 100명이 재접속하면 k번째 접속이 k명에게 k명분 목록을 보내 총량이 제곱으로 는다.
 * 접속자 목록은 늦어도 되는 정보라 120ms 지연은 화면에서 구분되지 않는다.
 */
export const ONLINE_COALESCE_MS = 120;

/** createdAt 표시 문자열. Date면 캐시된 포매터, 그 밖에는 그대로 문자열화. */
export function formatCreatedAt(value: unknown): string {
  return value instanceof Date
    ? KO_DATETIME_FORMAT.format(value)
    : String(value);
}

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

  private readonly logger = new Logger(RealtimeGateway.name);

  private onlineMap = new Map<string, OnlineUser>();
  private countdown = { active: false, startedAt: 0, totalSeconds: 0 };

  // socket → 마지막 message 패킷의 engine.io 수신 시각.
  // time:ping의 t1을 핸들러 진입보다 앞선 시점으로 잡기 위한 것. socket 인스턴스가
  // GC되면 항목도 함께 사라지도록 WeakMap을 쓴다 (disconnect 시 별도 정리 불필요).
  private readonly packetReceivedAt = new WeakMap<object, number>();

  constructor(
    private socketAuth: SocketAuthService,
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

  // 인증은 SocketAuthService가 소켓당 한 번만 수행한다 — 같은 소켓에 붙는 다른
  // 게이트웨이들과 조회 결과를 나눠 쓴다. 실패는 예전처럼 null이다.
  private async getUserFromSocket(client: Socket): Promise<OnlineUser | null> {
    const currentUser = await this.socketAuth.resolveUser(client);
    if (!currentUser) return null;
    return {
      nickname: currentUser.nickname,
      alliance: currentUser.allianceName || '',
      role: currentUser.role,
    };
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

  /**
   * 접속 진입점. 본체에서 새어 나온 예외를 여기서 전부 잡는다.
   *
   * Nest의 web-sockets-controller는 `subscribe((args) => instance.handleConnection(...args))`
   * 로 호출만 하고 반환된 Promise를 버린다(catch 없음). 그래서 여기서 reject가 새면
   * unhandled rejection이 되고, Node 기본값(--unhandled-rejections=throw)에서
   * uncaughtException으로 승격되어 프로세스가 종료된다. 저장소에 전역
   * unhandledRejection 핸들러도 없다(2026-08-27 확인). DB 순단 한 번에 서버가
   * 죽지 않도록 소켓만 정리하고 살아남는다.
   */
  async handleConnection(client: Socket) {
    // await 이전에 붙인다 — 인증 조회 중 도착한 패킷도 시각이 기록되도록.
    this.trackPacketArrival(client);
    try {
      await this.sendConnectionSnapshot(client);
    } catch (err) {
      this.logger.error(
        `handleConnection 실패 — 소켓 ${client.id}만 정리한다`,
        err instanceof Error ? err.stack : String(err),
      );
      this.cleanupFailedConnection(client);
    }
  }

  /** 접속 스냅샷 전송 본체. 실패는 handleConnection이 잡는다. */
  private async sendConnectionSnapshot(client: Socket): Promise<void> {
    const user = await this.getUserFromSocket(client);
    if (!client.connected) return;
    if (!user) {
      client.disconnect();
      return;
    }

    this.onlineMap.set(client.id, user);
    this.broadcastOnline();

    // 스냅샷 조회를 한 번에 띄운다. 순차 await면 왕복이 직렬로 쌓여
    // 100명 동시 재접속에서 커넥션 풀 대기열이 길어지고 지연으로 나타난다.
    // Promise.all은 입력 순서를 보존하므로 방출 순서는 그대로다.
    const [notices, rallies, members, boards, allianceNoticeLists] =
      await Promise.all([
        this.noticesService.findAll(),
        this.ralliesService.findAll(),
        this.membersService.findAll(),
        this.boardsService.findAllGrouped(),
        Promise.all(
          SNAPSHOT_ALLIANCES.map((a) =>
            this.allianceNoticesService.findByAlliance(a),
          ),
        ),
      ]);

    client.emit('notices:updated', notices.map(this.formatNotice));
    client.emit('rallies:updated', rallies.map(this.formatRally));
    client.emit('members:updated', members.map(this.formatMember));
    for (const [alliance, posts] of Object.entries(boards)) {
      client.emit(`board:updated:${alliance}`, posts.map(this.formatBoardPost));
    }

    SNAPSHOT_ALLIANCES.forEach((a, i) => {
      client.emit(
        `alliance-notice:updated:${a}`,
        allianceNoticeLists[i].map(this.formatAllianceNotice),
      );
    });

    client.emit('countdown:state', {
      ...this.countdown,
      serverEmitAt: Date.now(),
    });
    client.emit('busy:state', { holder: this.busyLock.getHolder() });
  }

  /** 접속 처리 실패 시 소켓만 정리한다 — 프로세스는 살아 있어야 한다. */
  private cleanupFailedConnection(client: Socket): void {
    try {
      this.onlineMap.delete(client.id);
      this.rateLimit.cleanup(client.id);
      this.broadcastOnline();
    } catch {
      // 정리 중 예외는 삼킨다 — 아래 disconnect까지는 반드시 시도한다.
    }
    try {
      client.disconnect();
    } catch {
      // 이미 끊긴 소켓
    }
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
    // 여기서 거는 자동 해제 시각은 잠정값이다. 실제 시작 시각(startedAt)은 probe가
    // 끝나야 정해지므로 확정 뒤 reschedule로 다시 잡는다(아래).
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

    // 자동 해제 시각을 startedAt 확정 뒤로 다시 잡는다.
    // tryAcquire 시점을 기준으로 두면 probe 소요 + grace 만큼(최악 약 1.7초) 일찍
    // 발화한다. 조기 발화는 countdown:state{active:false} broadcast → 클라이언트가
    // 오디오를 끊고 "중지되었습니다"를 재생하므로(Countdown.jsx), 마지막 "1"과
    // 개인 "출발"이 잘린다. rally 경로도 같은 목적으로 reschedule을 쓴다.
    this.busyLock.reschedule(
      { type: 'countdown' },
      startedAt +
        totalSeconds * 1000 +
        COUNTDOWN_AUTO_RELEASE_GRACE_MS -
        Date.now(),
      () => this.handleCountdownAutoExpire(),
    );

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
   *
   * 조기 발화 방어 — 아직 종료 시각이 남았으면 상태를 그대로 두고 잠금과 타이머만
   * 다시 잡는다. 조기 broadcast는 100명이 출발해야 하는 순간에 오디오를 끊는다.
   */
  private handleCountdownAutoExpire(): void {
    const remainingMs = this.countdownRemainingMs();
    if (
      remainingMs > 0 &&
      this.busyLock.tryAcquire({ type: 'countdown' }, remainingMs, () =>
        this.handleCountdownAutoExpire(),
      )
    ) {
      return;
    }

    this.countdown = { active: false, startedAt: 0, totalSeconds: 0 };
    this.server.emit('countdown:state', {
      ...this.countdown,
      serverEmitAt: Date.now(),
    });
    // 정상 경로에서는 holder가 이미 null이다. 재획득에 실패한 경우(다른 holder 점유)에
    // null을 단정해 broadcast하면 그 holder의 점유가 잘못 해제된 것처럼 보이므로
    // 실제 holder를 그대로 싣는다.
    this.server.emit('busy:state', { holder: this.busyLock.getHolder() });
  }

  /** 자동 해제까지 남은 시간(ms). 진행 중이 아니면 0. */
  private countdownRemainingMs(): number {
    const { active, startedAt, totalSeconds } = this.countdown;
    if (!active || !startedAt || !totalSeconds) return 0;
    return (
      startedAt +
      totalSeconds * 1000 +
      COUNTDOWN_AUTO_RELEASE_GRACE_MS -
      Date.now()
    );
  }

  handleDisconnect(client: Socket) {
    this.onlineMap.delete(client.id);
    this.rateLimit.cleanup(client.id);
    this.broadcastOnline();
  }

  private onlineBroadcastTimer: NodeJS.Timeout | null = null;

  /** 접속 목록 방출. 창 안의 연속 호출은 마지막 상태 하나로 합쳐진다. */
  broadcastOnline() {
    if (this.onlineBroadcastTimer) return;
    this.onlineBroadcastTimer = setTimeout(() => {
      this.onlineBroadcastTimer = null;
      this.server.emit('online:updated', Array.from(this.onlineMap.values()));
    }, ONLINE_COALESCE_MS);
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
      createdAt: formatCreatedAt(n.createdAt),
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
      createdAt: formatCreatedAt(n.createdAt),
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
      createdAt: formatCreatedAt(p.createdAt),
    };
  }
}
