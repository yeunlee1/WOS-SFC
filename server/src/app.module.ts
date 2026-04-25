import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import { AppController } from './app.controller';
import { User } from './users/users.entity';
import { Message } from './chat/message.entity';
import { Notice } from './notices/notice.entity';
import { Rally } from './rallies/rally.entity';
import { Member } from './members/member.entity';
import { BoardPost } from './boards/board-post.entity';
import { Translation } from './translations/translation.entity';
import { AllianceNotice } from './alliance-notices/alliance-notice.entity';
import { RallyGroup } from './rally-groups/rally-group.entity';
import { RallyGroupMember } from './rally-groups/rally-group-member.entity';
import { UserBattleSettings } from './users/user-battle-settings.entity';
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
import { TtsModule } from './tts/tts.module';
import { AdminModule } from './admin/admin.module';
import { AllianceNoticesModule } from './alliance-notices/alliance-notices.module';
import { MeModule } from './me/me.module';
import { RallyGroupsModule } from './rally-groups/rally-groups.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 60 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // entity 자동 마이그레이션은 기본 OFF. dev에서 켜려면 .env에 TYPEORM_SYNC=true 명시.
        // production(NODE_ENV=production)에서는 TYPEORM_SYNC 값과 무관하게 항상 false — 데이터 손실 방지.
        const isProduction = configService.get<string>('NODE_ENV') === 'production';
        const allowSync = configService.get<string>('TYPEORM_SYNC') === 'true';
        return {
          type: 'mysql',
          host: configService.get<string>('DATABASE_HOST'),
          port: configService.get<number>('DATABASE_PORT', 3306),
          username: configService.get<string>('DATABASE_USER'),
          password: configService.get<string>('DATABASE_PASSWORD'),
          database: configService.get<string>('DATABASE_NAME'),
          entities: [User, Message, Notice, Rally, Member, BoardPost, Translation, AllianceNotice, RallyGroup, RallyGroupMember, UserBattleSettings],
          synchronize: !isProduction && allowSync,
        };
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', '..', 'web', 'dist'),
      exclude: ['/auth/*path', '/notices/*path', '/rallies/*path', '/members/*path',
                '/boards/*path', '/translations/*path', '/users/*path',
                '/translate/*path', '/tts-audio/*path', '/admin/*path',
                '/alliance-notices/*path', '/me/*path', '/rally-groups/*path',
                '/time', '/socket.io/*path',
                '/uploads/*path'],
      serveStaticOptions: { fallthrough: false },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: { index: false },
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
    TtsModule,
    AdminModule,
    AllianceNoticesModule,
    MeModule,
    RallyGroupsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
