import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { RallyGroup } from './rally-group.entity';
import { LockHolder } from '../realtime/busy-lock.service';

const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';

@WebSocketGateway({ cors: { origin: WEB_ORIGIN, credentials: true } })
export class RallyGroupsGateway {
  @WebSocketServer() server: Server;

  emitGroupUpdated(group: RallyGroup) {
    this.server.emit('rallyGroup:updated', group);
  }

  emitCountdownStart(payload: {
    groupId: string;
    startedAtServerMs: number;
    fireOffsets: { orderIndex: number; offsetMs: number; userId: number }[];
  }) {
    this.server.emit('rallyGroup:countdown:start', payload);
  }

  emitCountdownStop(groupId: string) {
    this.server.emit('rallyGroup:countdown:stop', { groupId });
  }

  emitGroupRemoved(groupId: string) {
    this.server.emit('rallyGroup:removed', { groupId });
  }

  /**
   * BusyLock holder 변경 시 모든 클라이언트에 broadcast.
   * Countdown(1번) ↔ Rally(3번) 음성 충돌 방지 게이팅의 사이드채널.
   */
  emitBusyState(holder: LockHolder | null) {
    this.server.emit('busy:state', { holder });
  }
}
