import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';

@WebSocketGateway({ cors: { origin: WEB_ORIGIN, credentials: true } })
export class RallyGroupsGateway {
  @WebSocketServer() server: Server;

  emitGroupUpdated(group: any) {
    this.server.emit('rallyGroup:updated', group);
  }

  emitCountdownStart(payload: { groupId: string; startedAtServerMs: number; fireOffsets: { orderIndex: number; offsetMs: number; userId: number }[] }) {
    this.server.emit('rallyGroup:countdown:start', payload);
  }

  emitCountdownStop(groupId: string) {
    this.server.emit('rallyGroup:countdown:stop', { groupId });
  }
}
