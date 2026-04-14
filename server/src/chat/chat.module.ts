import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './message.entity';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  // Message 엔티티 리포지토리 등록, AuthModule에서 JwtModule 가져옴
  imports: [TypeOrmModule.forFeature([Message]), AuthModule, UsersModule],
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
