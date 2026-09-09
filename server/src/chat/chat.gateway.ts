// 채팅 소켓 게이트웨이 — 메시지 저장·방송, 서버 푸시 번역, 소켓별 대상 언어, 히스토리(번역 동봉).
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService, ChatUser } from './chat.service';
import { SocketAuthService } from '../realtime/socket-auth.service';
import { WsRateLimitService } from '../realtime/ws-rate-limit.service';
import { User } from '../users/users.entity';
import { SOCKET_CORS_OPTIONS } from '../realtime/socket-cors.options';
import { ChatTranslationService } from '../translate/chat-translation.service';
import { effectiveLang, Lang, TARGET_LANGS } from '../translate/script-detect';

const CHAT_MESSAGE_MAX_LENGTH = 500;
const CHAT_MESSAGE_RATE_LIMIT = 30;
const CHAT_MESSAGE_RATE_WINDOW_MS = 60_000;

type ConnectedUser = {
  nickname: string;
  language: string;
  /** 이 소켓이 번역받을 언어. null 은 자동번역 꺼짐. 웹이 chat:language 로 보고한다(설계 3.1). */
  targetLang: Lang | null;
};

type ChatSocketData = {
  user?: ChatUser;
  /** 등록(handleConnection 완료) 전에 도착한 chat:language 보고. 등록 시 초기값으로 쓴다. */
  pendingTargetLang?: Lang | null;
};

@WebSocketGateway({ cors: SOCKET_CORS_OPTIONS })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // socket.id → { nickname, language, targetLang }
  private connectedUsers = new Map<string, ConnectedUser>();

  constructor(
    private readonly socketAuth: SocketAuthService,
    private readonly chatService: ChatService,
    private readonly rateLimit: WsRateLimitService,
    private readonly translation: ChatTranslationService,
  ) {}

  /** 접속 소켓이 보고한 대상 언어 집합(null 제외). 메시지 번역 대상과 히스토리 동봉 언어의 근원이다. */
  onlineTargetLangs(): Set<Lang> {
    const langs = new Set<Lang>();
    for (const entry of this.connectedUsers.values()) {
      if (entry.targetLang) langs.add(entry.targetLang);
    }
    return langs;
  }

  // 클라이언트 연결 시: JWT 검증 → 유저 확인 → 히스토리(번역 동봉) 전송
  // 인증 실패만 연결을 끊는다. 이 소켓은 RealtimeGateway(전투 카운트다운)와 같은
  // 기본 네임스페이스를 공유하므로 채팅 내부 오류로 끊으면 전투 기능까지 죽는다.
  async handleConnection(client: Socket) {
    // 쿠키 파싱·서명 검증·사용자 조회는 SocketAuthService가 소켓당 한 번만 한다.
    // 어느 단계에서 실패하든 null이 오므로, 예전처럼 인증 실패는 곧 disconnect다.
    const user: User | null = await this.socketAuth.resolveUser(client);

    if (!client.connected) return;
    if (!user) {
      client.disconnect();
      return;
    }

    const data = client.data as ChatSocketData;
    // 소켓 수명 동안 남는 객체에 passwordHash 가 실리지 않게 필요한 필드만 투영한다(A-S6).
    data.user = {
      id: user.id,
      nickname: user.nickname,
      allianceName: user.allianceName,
      language: user.language,
      role: user.role,
    };
    // 웹은 connect 직후 chat:language 를 보내는데 위 사용자 조회보다 먼저 올 수 있다.
    // 그 보고를 버리면 계정 언어로 번역을 받게 되므로 보관해 둔 값을 초기값으로 쓴다.
    const targetLang =
      data.pendingTargetLang !== undefined
        ? data.pendingTargetLang
        : effectiveLang(user.language);
    delete data.pendingTargetLang;
    this.connectedUsers.set(client.id, {
      nickname: user.nickname,
      language: user.language,
      targetLang,
    });

    // 최근 메시지 히스토리 전송. 접속자 언어 집합 ∪ 이 소켓 언어의 번역을 쿼리 1회로 붙인다.
    // 조회가 실패해도 소켓을 끊지 않는다 — 채팅은 부가 기능이고, 여기서 끊으면
    // 클라이언트가 'io server disconnect'를 인증 실패로 읽어 앱 전체가 로그아웃된다.
    try {
      const history = await this.chatService.getRecentMessages();
      if (!client.connected) return;
      const langs = this.onlineTargetLangs();
      if (targetLang) langs.add(targetLang);
      const translations = await this.translation.attachHistory(history, langs);
      if (!client.connected) return;
      client.emit(
        'chat:history',
        history.map((m) => ({
          id: m.id,
          nickname: m.user.nickname,
          allianceName: m.user.allianceName,
          language: m.user.language,
          content: m.content,
          createdAt: m.createdAt,
          translations: translations.get(m.id) ?? {},
        })),
      );
    } catch {
      if (!client.connected) return;
      client.emit('chat:system', { kind: 'history_error' });
    }
    // 입장 알림은 보내지 않는다(C-5). 온라인 목록은 RealtimeGateway 의 'online:updated'가
    // 담당하고, 입퇴장 표시는 웹이 그 diff 로 만든다.
  }

  // 클라이언트 연결 해제 시: 소켓별 대상 언어 정리. 퇴장 알림은 보내지 않는다(C-5).
  handleDisconnect(client: Socket) {
    this.connectedUsers.delete(client.id);
  }

  /** 웹이 접속 직후·UI 언어 변경·자동번역 토글 때 보내는 대상 언어. 잘못된 값은 무시한다. */
  @SubscribeMessage('chat:language')
  handleLanguage(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    if (!body || typeof body !== 'object' || !('lang' in body)) return;
    const { lang } = body as { lang: unknown };
    const targetLang: Lang | null | undefined =
      lang === null
        ? null
        : typeof lang === 'string' && (TARGET_LANGS as readonly string[]).includes(lang)
          ? (lang as Lang)
          : undefined;
    if (targetLang === undefined) return;

    const entry = this.connectedUsers.get(client.id);
    if (entry) {
      entry.targetLang = targetLang;
    } else {
      (client.data as ChatSocketData).pendingTargetLang = targetLang;
    }
  }

  // 채팅 메시지 수신 → 저장 → 전체 브로드캐스트 → (await 없이) 번역 후 chat:translation 방송
  @SubscribeMessage('chat:message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() content: unknown,
  ) {
    const user = (client.data as ChatSocketData).user;
    if (!user || typeof content !== 'string') {
      return { ok: false, reason: 'invalid' as const };
    }
    const normalized = content.trim();
    // String.length 는 UTF-16 코드 유닛이라 이모지가 2로 세어진다. 코드 포인트로 센다(A-A2).
    // 웹 입력창도 같은 계수(Array.from(s).length)와 maxLength 를 쓴다.
    if (!normalized || Array.from(normalized).length > CHAT_MESSAGE_MAX_LENGTH) {
      return { ok: false, reason: 'invalid' as const };
    }
    if (
      !this.rateLimit.check(
        // 재연결·다중 탭도 같은 한도를 공유하도록 소켓 ID가 아닌 불변 사용자 ID를 사용한다.
        // disconnect 때 삭제하지 않으므로 버킷 수는 연결 수가 아니라 메시지를 보낸 계정 수에만 비례한다.
        `chat-user:${user.id}`,
        'chat:message',
        CHAT_MESSAGE_RATE_LIMIT,
        CHAT_MESSAGE_RATE_WINDOW_MS,
      )
    ) {
      return { ok: false, reason: 'rate_limit' as const };
    }

    // 저장 예외를 밖으로 던지면 Nest 가 exception 이벤트만 보내고 ack 를 부르지 않아
    // 웹이 5초 타임아웃까지 기다린다(C-4). 여기서 잡아 즉시 실패 ack 를 돌려준다.
    let msg: { id: number; content: string; createdAt: Date };
    try {
      msg = await this.chatService.saveMessage(user, normalized);
    } catch (error) {
      this.logger.warn(
        `메시지 저장 실패(user=${user.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false, reason: 'failed' as const };
    }
    this.server.emit('chat:message', {
      id: msg.id,
      nickname: user.nickname,
      allianceName: user.allianceName,
      language: user.language,
      content: msg.content,
      createdAt: msg.createdAt,
    });
    void this.translateAndPush({ id: msg.id, content: msg.content });
    return { ok: true };
  }

  /** 접속자 언어로 번역해 전체에 방송한다. 대상이 0이어도 translations:{} 를 보내 웹이 폴백 타이머를 걸지 않게 한다(O). */
  private async translateAndPush(msg: { id: number; content: string }): Promise<void> {
    try {
      const result = await this.translation.translateForMessage(msg, this.onlineTargetLangs());
      const payload: {
        id: number;
        translations: Partial<Record<Lang, string>>;
        failed?: Lang[];
        error?: 'provider' | 'limit';
      } = { id: msg.id, translations: result.translations };
      if (result.failed.length > 0) {
        payload.failed = result.failed;
        if (result.error) payload.error = result.error;
      }
      this.server.emit('chat:translation', payload);
    } catch (error) {
      this.logger.warn(
        `메시지 ${msg.id} 번역 방송 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
