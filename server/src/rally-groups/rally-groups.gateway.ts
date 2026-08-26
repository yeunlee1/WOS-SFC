import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { RallyGroup } from './rally-group.entity';
import { LockHolder } from '../realtime/busy-lock.service';
import { SOCKET_CORS_OPTIONS } from '../realtime/socket-cors.options';

/** rallyGroup:countdown:start 페이로드 — 재접속 스냅샷도 같은 형태를 그대로 쓴다. */
export type RallyCountdownPayload = {
  groupId: string;
  startedAtServerMs: number;
  fireOffsets: { orderIndex: number; offsetMs: number; userId: number }[];
};

@WebSocketGateway({ cors: SOCKET_CORS_OPTIONS })
export class RallyGroupsGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  /**
   * groupId → 진행 중 카운트다운 스냅샷.
   * emitCountdownStart로 채우고 stop/removed에서 지운다.
   * 재접속 복구 전용 — DB에는 fireOffsets가 없어서(그룹/멤버로부터 매번 재계산) 메모리에 둔다.
   * 그룹 최대 6개라 상한이 작고, 서버 재시작 시엔 RallyGroupsService.onModuleInit가
   * DB의 stale 'running'을 idle로 되돌리므로 이 캐시가 비는 것과 상태가 일치한다.
   */
  private runningCountdowns = new Map<string, RallyCountdownPayload>();

  /**
   * groupId → 마지막으로 broadcast한 'running' 상태 그룹.
   * 소켓만 끊겼다 붙은 클라이언트는 스토어의 group.state가 끊기기 전 값(대개 'idle')이라
   * 카운트다운 페이로드만 받아서는 카운트다운 UI가 렌더되지 않는다
   * (RallyGroupPanel: running = g.state === 'running' && !!countdown).
   * 이미 전체 broadcast한 것과 같은 객체를 재사용하므로 추가 DB 조회가 없다.
   */
  private runningGroups = new Map<string, RallyGroup>();

  constructor(private readonly jwtService: JwtService) {}

  /**
   * 재접속 복구 — 진행 중인 집결 그룹 카운트다운을 접속한 소켓 하나에만 되돌려준다.
   * 이벤트명과 페이로드가 최초 시작과 동일해서 클라이언트 스케줄러가 그대로 소비한다.
   * 여기서는 절대시각의 원본(startedAtServerMs + offsetMs)만 되돌려주고,
   * 이미 지난 슬롯을 건너뛰는 책임은 클라이언트 스케줄러(rallyGroupPlayer)에 있다.
   * 모든 슬롯이 지난 스냅샷은 아예 보내지 않는다 — collectLiveSnapshots 참조.
   *
   * 100명 동시 재접속 부하를 키우지 않으려고 동기 처리로 유지한다 —
   * DB 조회 없이 메모리 Map만 읽고, JWT는 서명 검증(동기 HMAC)만 한다.
   * 사용자 존재 확인(DB)은 같은 소켓에 대해 RealtimeGateway가 이미 수행하며,
   * 거기서 실패하면 소켓이 끊긴다.
   */
  handleConnection(client: Socket): void {
    if (!this.hasValidToken(client)) return;
    for (const payload of this.collectLiveSnapshots(Date.now())) {
      // 그룹 상태를 먼저 — 스냅샷이 도착한 시점에 이미 running으로 렌더될 수 있어야 한다.
      const group = this.runningGroups.get(payload.groupId);
      if (group) client.emit('rallyGroup:updated', group);
      client.emit('rallyGroup:countdown:start', payload);
    }
  }

  emitGroupUpdated(group: RallyGroup) {
    if (group?.id) {
      if (group.state === 'running') this.runningGroups.set(group.id, group);
      else this.runningGroups.delete(group.id);
    }
    this.server.emit('rallyGroup:updated', group);
  }

  emitCountdownStart(payload: RallyCountdownPayload) {
    this.runningCountdowns.set(payload.groupId, payload);
    this.server.emit('rallyGroup:countdown:start', payload);
  }

  emitCountdownStop(groupId: string) {
    this.runningCountdowns.delete(groupId);
    this.server.emit('rallyGroup:countdown:stop', { groupId });
  }

  emitGroupRemoved(groupId: string) {
    this.runningCountdowns.delete(groupId);
    this.runningGroups.delete(groupId);
    this.server.emit('rallyGroup:removed', { groupId });
  }

  /**
   * BusyLock holder 변경 시 모든 클라이언트에 broadcast.
   * Countdown(1번) ↔ Rally(3번) 음성 충돌 방지 게이팅의 사이드채널.
   */
  emitBusyState(holder: LockHolder | null) {
    this.server.emit('busy:state', { holder });
  }

  /**
   * 아직 남은 슬롯이 있는 스냅샷만 반환하고, 만료된 것은 캐시에서 제거한다.
   * 만료 기준 = 마지막 발화 시각(startedAtServerMs + 최대 offsetMs)이 지났는지.
   * handleAutoIdle이 DB 오류로 emitCountdownStop까지 못 간 경우에도
   * 종료된 카운트다운이 새 접속자에게 새지 않게 하는 안전망이다.
   */
  private collectLiveSnapshots(nowMs: number): RallyCountdownPayload[] {
    const live: RallyCountdownPayload[] = [];
    for (const [groupId, payload] of this.runningCountdowns) {
      const lastFireAtMs =
        payload.startedAtServerMs +
        Math.max(0, ...payload.fireOffsets.map((f) => f.offsetMs));
      if (nowMs > lastFireAtMs) {
        this.runningCountdowns.delete(groupId);
        this.runningGroups.delete(groupId);
        continue;
      }
      live.push(payload);
    }
    return live;
  }

  /** httpOnly 쿠키의 access_token 서명만 확인 — DB 조회 없음. */
  private hasValidToken(client: Socket): boolean {
    try {
      const cookieStr = client.handshake.headers.cookie || '';
      const match = cookieStr.match(/(?:^|;\s*)access_token=([^;]+)/);
      if (!match) return false;
      const payload = this.jwtService.verify<{ sub?: number }>(
        decodeURIComponent(match[1]),
      );
      return Number.isInteger(payload.sub);
    } catch {
      return false;
    }
  }
}
