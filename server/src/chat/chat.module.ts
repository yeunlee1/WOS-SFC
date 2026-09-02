import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './message.entity';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  // Message 엔티티 리포지토리 등록.
  // RealtimeModule에서 WsRateLimitService와 SocketAuthService(소켓 인증 공유)를 가져온다.
  imports: [TypeOrmModule.forFeature([Message]), RealtimeModule],
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
