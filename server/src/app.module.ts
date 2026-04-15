import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { User } from './users/users.entity';
import { Message } from './chat/message.entity';
import { Notice } from './notices/notice.entity';
import { Rally } from './rallies/rally.entity';
import { Member } from './members/member.entity';
import { BoardPost } from './boards/board-post.entity';
import { Translation } from './translations/translation.entity';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { NoticesModule } from './notices/notices.module';
import { RalliesModule } from './rallies/rallies.module';
import { MembersModule } from './members/members.module';
import { BoardsModule } from './boards/boards.module';
import { TranslationsModule } from './translations/translations.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TranslateModule } from './translate/translate.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DATABASE_HOST'),
        port: configService.get<number>('DATABASE_PORT', 3306),
        username: configService.get<string>('DATABASE_USER'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        database: configService.get<string>('DATABASE_NAME'),
        entities: [User, Message, Notice, Rally, Member, BoardPost, Translation],
        synchronize: configService.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', '..', 'web', 'dist'),
      exclude: ['/auth/(.*)', '/notices/(.*)', '/rallies/(.*)', '/members/(.*)',
                '/boards/(.*)', '/translations/(.*)', '/users/(.*)',
                '/translate/(.*)', '/time', '/socket.io/(.*)'],
      serveStaticOptions: { fallthrough: false },
    }),
    UsersModule,
    AuthModule,
    ChatModule,
    NoticesModule,
    RalliesModule,
    MembersModule,
    BoardsModule,
    TranslationsModule,
    RealtimeModule,
    TranslateModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
