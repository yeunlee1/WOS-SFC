import { ExecutionContext, Injectable, Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { staticServingModules } from './static-serving';
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
import { OperationBoard } from './operation-boards/operation-board.entity';
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
import { OperationBoardsModule } from './operation-boards/operation-boards.module';
import { createRateLimitTracker } from './common/rate-limit-tracker';

// 전역 요청 한도에서 제외할 경로 접두사.
// /tts-audio/:lang/:key 는 핸들러 하나로 mp3 를 통째로 서빙한다. 카운트다운 준비
// (Countdown.jsx의 primeCountdownAudio)가 1..totalSeconds-1 을 한 번에 요청하므로
// 600초 카운트다운이면 접속 한 번에 599건이 같은 핸들러로 몰린다. 여기에 기본
// 60회/분이 걸리면 음성이 통째로 깨진다.
// 대신 tts.constants 의 화이트리스트(parseTtsLang/parseTtsKey)가 임의 텍스트 합성을
// 막고 있고, 응답은 1시간 캐시가 걸린 정적 mp3라 ServeStatic 으로 서빙되는 파일들과
// 노출 수준이 같다.
const THROTTLE_EXEMPT_PATH_PREFIXES = ['/tts-audio/'];

/**
 * 전역 요청 한도 가드.
 *
 * APP_GUARD 등록이 없어서 @UseGuards(ThrottlerGuard) 를 직접 붙인 네 곳
 * (/time, /auth/signup, /auth/login, /auth/refresh) 말고는 모두 한도가 없었다.
 * 전역 등록으로 나머지 REST 라우트에 기본 한도를 씌우되, 아래 세 경우는 건너뛴다.
 *
 * 1. http 가 아닌 컨텍스트 — WsContextCreator 가 전역 가드를 @SubscribeMessage
 *    핸들러에도 그대로 붙인다. ThrottlerGuard 는 응답 객체에 res.header() 를
 *    호출하는데 ws 컨텍스트의 두 번째 인자는 메시지 본문이라 함수가 없다.
 *    time:ping / countdown:start 같은 실시간 경로가 여기서 깨진다.
 *    ws 쪽 한도는 WsRateLimitService 가 이미 따로 맡고 있다.
 * 2. 라우트나 컨트롤러가 자체 ThrottlerGuard 를 선언한 경우 — 전역과 지역이 같은 키
 *    (sha256(클래스-핸들러-이름-추적자))로 각각 한 번씩 세어 한도가 절반이 된다.
 *    /auth/refresh 20회가 10회로, /time 90회가 45회로 줄어든다. 그쪽에 맡긴다.
 * 3. THROTTLE_EXEMPT_PATH_PREFIXES 에 해당하는 대량 응답 경로.
 *
 * ServeStaticModule(web/dist, /uploads)은 express.static 미들웨어라 Nest 가드가
 * 아예 실행되지 않으므로 별도 예외가 필요 없다.
 */
@Injectable()
export class GlobalThrottlerGuard extends ThrottlerGuard {
  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(this.isExempt(context));
  }

  private isExempt(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    if (this.hasOwnThrottlerGuard(context)) return true;

    const req = context.switchToHttp().getRequest<{
      originalUrl?: string;
      url?: string;
    }>();
    const path = req?.originalUrl ?? req?.url ?? '';
    return THROTTLE_EXEMPT_PATH_PREFIXES.some((prefix) =>
      path.startsWith(prefix),
    );
  }

  /** 핸들러 또는 컨트롤러가 @UseGuards 로 ThrottlerGuard 를 직접 선언했는가. */
  private hasOwnThrottlerGuard(context: ExecutionContext): boolean {
    const declared = [
      ...(this.reflector.get<unknown[]>(
        GUARDS_METADATA,
        context.getHandler(),
      ) ?? []),
      ...(this.reflector.get<unknown[]>(GUARDS_METADATA, context.getClass()) ??
        []),
    ];
    return declared.some(
      (guard) =>
        guard === ThrottlerGuard ||
        guard instanceof ThrottlerGuard ||
        (typeof guard === 'function' &&
          guard.prototype instanceof ThrottlerGuard),
    );
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // 요청 한도 추적자를 IP 단독에서 "인증된 사용자 = 사용자 ID / 그 외 = 클라이언트 IP" 로 바꾼다.
    // 기본 추적자(req.ip)만 쓰면 TLS 종단 프록시 뒤의 동시 접속자 전원이 버킷 하나를 공유한다.
    //
    // 100명 규모 실측 근거 —
    // - /auth/refresh 20회/분: 액세스 토큰 수명이 1시간이라 작전 준비 시간대에 로그인한 100명의 토큰이
    //   한 시간 뒤 같은 몇 분 안에 몰려 만료된다. IP 공유 상태에서는 20명분만 통과하고 나머지가 429 →
    //   web/src/api/index.js 가 auth:expired 를 쏘아 작전 도중 강제 로그아웃된다.
    //   사용자 단위로 쪼개면 1인당 20회/분이고, 웹 클라이언트는 동시 refresh 를 refreshPromise 로
    //   1건에 합치므로 정상 사용자의 실제 사용량은 분당 1~2회다. 여유 10배 이상.
    // - /time 90회/분: web/src/clockSync.js 는 ws ping 을 우선 쓰고 미연결·실패 시 /time 으로 폴백하며,
    //   동기화 1회에 샘플 5개(RTT 편차가 크면 3개 추가)를 모은다. 폴백이 걸린 상태에서 IP 를 공유하면
    //   90회는 전체 합산 11~18회 동기화분뿐이라 100명이 동시에 붙는 순간 앞선 몇 명이 다 소진한다.
    //   사용자 단위로 쪼개면 1인당 분당 11~18회 동기화로 충분하다.
    // - /auth/login 10회/분, /auth/signup 5회/10분은 인증 전이라 IP 기반을 유지한다.
    //   trust proxy 설정(main.ts)으로 req.ip 가 프록시 주소가 아닌 실제 클라이언트 주소가 되므로
    //   프록시 뒤 100명이 한 버킷을 공유하던 문제는 사라진다.
    // - 아래 60회/분은 @Throttle 이 없는 라우트용 기본값이다. 현재 ThrottlerGuard 를 붙인 라우트
    //   (/time, /auth/login, /auth/signup, /auth/refresh)는 모두 자체 @Throttle 을 갖고 있어
    //   이 값이 실제로 적용되는 라우트는 없다.
    ThrottlerModule.forRootAsync({
      imports: [AuthModule],
      inject: [JwtService],
      useFactory: (jwtService: JwtService) => ({
        throttlers: [{ name: 'default', ttl: 60000, limit: 60 }],
        getTracker: createRateLimitTracker(jwtService),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // entity 자동 마이그레이션은 기본 OFF. dev에서 켜려면 .env에 TYPEORM_SYNC=true 명시.
        // production(NODE_ENV=production)에서는 TYPEORM_SYNC 값과 무관하게 항상 false — 데이터 손실 방지.
        const isProduction =
          configService.get<string>('NODE_ENV') === 'production';
        const allowSync = configService.get<string>('TYPEORM_SYNC') === 'true';
        return {
          type: 'mysql',
          host: configService.get<string>('DATABASE_HOST'),
          port: configService.get<number>('DATABASE_PORT', 3306),
          username: configService.get<string>('DATABASE_USER'),
          password: configService.get<string>('DATABASE_PASSWORD'),
          database: configService.get<string>('DATABASE_NAME'),
          entities: [
            User,
            Message,
            Notice,
            Rally,
            Member,
            BoardPost,
            Translation,
            AllianceNotice,
            RallyGroup,
            RallyGroupMember,
            OperationBoard,
          ],
          // 커넥션 풀 크기를 명시한다. 미지정이면 TypeORM이 mysql2 기본값
          // connectionLimit=10을 그대로 쓰고, queueLimit 기본값은 0(무제한 대기열)이라
          // 초과분이 실패 대신 "무한 대기"로 나타나 원인 파악이 어렵다.
          // 소켓 1건 접속마다 스냅샷 조회가 여러 건 발생하고(연맹 게시판 5 + 연맹 공지 5
          // + 공지/집결/멤버 3 + 사용자 조회), 100명이 동시에 재접속하면 순간 수백 건이
          // 몰린다. 20이면 조회당 평균 수 ms 기준으로 순간 유입을 흡수한다.
          // DB의 max_connections를 넘기면 안 되므로 배포별로 DATABASE_POOL_SIZE로 조정한다.
          poolSize: configService.get<number>('DATABASE_POOL_SIZE', 20),
          synchronize: !isProduction && allowSync,
        };
      },
    }),
    // 업로드 서빙이 web/dist 보다 먼저여야 한다 — 순서 근거는 static-serving.ts 참고.
    ...staticServingModules(),
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
    OperationBoardsModule,
  ],
  controllers: [AppController],
  // 전역 요청 한도. 키가 (컨트롤러, 핸들러, 추적자)별로 갈리므로 아래 60회/분은
  // "사용자 1인이 라우트 하나에 분당 60회"다. 라우트 전체를 합친 예산이 아니다.
  // - 정상 사용의 최대치는 채팅 번역(/translate)인데 그쪽은 자체적으로 사용자당
  //   60회/분(TRANSLATION_REQUEST_RATE_LIMIT)을 이미 걸고 있어 값이 겹칠 뿐 새로
  //   막히는 것이 없다.
  // - 화면 로드형 라우트(/notices, /alliance-notices, /boards, /members,
  //   /rally-groups, /operation-boards, /me/battle-settings)는 접속 시 1~2회,
  //   갱신은 웹소켓 broadcast로 받으므로 분당 60회와 자릿수가 다르다.
  // - /admin/*, /users/:nickname/role 은 관리자 수동 조작이라 분당 60회를 넘지 않는다.
  // - 대량 경로 /tts-audio 는 GlobalThrottlerGuard 에서 제외한다(위 주석 참고).
  providers: [{ provide: APP_GUARD, useClass: GlobalThrottlerGuard }],
})
export class AppModule {}
