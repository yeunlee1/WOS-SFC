// 소켓 1건의 인증을 한 번만 수행하고 그 결과를 여러 게이트웨이가 나눠 쓰게 한다.
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

/** 소켓 하나의 인증 결과. 소켓 객체와 수명을 같이 한다. */
type SocketAuthEntry = {
  /** 서명 검증으로 얻은 사용자 ID. undefined 는 아직 검증 전이라는 뜻이다. */
  userId?: number | null;
  /** 사용자 레코드 조회. 진행 중이면 뒤늦게 온 게이트웨이가 같은 Promise 를 기다린다. */
  userLookup?: Promise<User | null>;
};

/**
 * 네 게이트웨이(realtime, chat, operation-boards, rally-groups)는 모두 네임스페이스
 * 없는 @WebSocketGateway 라 같은 기본 네임스페이스를 쓴다. Nest 는 그 소켓 하나에
 * 대해 네 handleConnection 을 전부 부른다(2026-08-27 실제 소켓으로 실측 — 사용자
 * 조회 3회, 서명 검증 4회). 100명이 동시에 재접속하면 중복분만 200회의 쿼리가 되고
 * 커넥션 풀은 20이라 그 대기가 카운트다운 broadcast 를 밀어낸다.
 *
 * 캐시 수명을 소켓 수명으로 잡은 근거 —
 * - 판단 근거인 쿠키는 handshake 헤더라 소켓이 사는 동안 바뀌지 않는다. 같은 소켓에
 *   대해 다시 검증해도 나오는 값이 같다.
 * - 역할 변경과 밴은 AdminService 가 kickUser 로 그 사용자의 소켓을 끊어서 반영한다.
 *   소켓이 끊기면 이 캐시도 소켓과 함께 사라지므로 재접속은 반드시 새로 인증한다.
 * - 캐시를 사용자 ID 나 토큰 문자열로 잡으면 끊긴 뒤 재접속한 사용자가 옛 결과로
 *   통과해 인증 우회가 된다. 그래서 키는 반드시 소켓 객체다.
 *
 * 이벤트마다 재검증하지 않는 것은 기존 계약 그대로다 — RealtimeGateway 는 onlineMap,
 * ChatGateway 는 client.data.user, OperationBoardsGateway 는 connectedUsers 로 이미
 * 접속 시점의 역할을 소켓이 끊길 때까지 그대로 쓴다. 여기서 재검증을 새로 넣으면
 * 이 트랙이 줄이려는 조회가 오히려 늘어난다.
 */
@Injectable()
export class SocketAuthService {
  /**
   * 소켓 객체를 키로 쓴다. 소켓이 GC 되면 항목도 함께 사라지므로 disconnect 때
   * 따로 정리할 것이 없고, 캐시가 소켓 수명을 넘겨 다른 접속으로 샐 수 없다.
   */
  private readonly cache = new WeakMap<object, SocketAuthEntry>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * httpOnly 쿠키의 access_token 서명을 확인해 사용자 ID를 돌려준다. DB 는 건드리지 않는다.
   * 같은 소켓에 대해서는 처음 한 번만 실제로 검증한다.
   */
  verifyUserId(client: Socket): number | null {
    const entry = this.entryFor(client);
    if (entry.userId === undefined) {
      entry.userId = this.verifyCookieToken(client);
    }
    return entry.userId;
  }

  /**
   * 인증된 사용자 레코드. 토큰이 유효하지 않거나 사용자가 없으면 null 이다.
   * 같은 소켓에 대해서는 조회가 한 번만 돈다 — 여러 게이트웨이가 같은 tick 에
   * 불러도 진행 중인 Promise 를 함께 기다린다.
   */
  resolveUser(client: Socket): Promise<User | null> {
    const entry = this.entryFor(client);
    if (!entry.userLookup) {
      entry.userLookup = this.lookupUser(client);
    }
    return entry.userLookup;
  }

  /**
   * 조회 실패를 예외 대신 null 로 돌려준다.
   * 기존 게이트웨이들도 각자의 try/catch 로 실패를 null(=접속 거부)로 다뤘으므로
   * 호출부에서 보이는 결과가 달라지지 않는다.
   */
  private async lookupUser(client: Socket): Promise<User | null> {
    const userId = this.verifyUserId(client);
    if (userId === null) return null;
    try {
      return (await this.usersService.findById(userId)) ?? null;
    } catch {
      return null;
    }
  }

  private entryFor(client: Socket): SocketAuthEntry {
    const existing = this.cache.get(client);
    if (existing) return existing;
    const created: SocketAuthEntry = {};
    this.cache.set(client, created);
    return created;
  }

  /** 쿠키 파싱과 JWT 서명·만료 검증. 어느 단계에서 실패하든 null 이다. */
  private verifyCookieToken(client: Socket): number | null {
    try {
      const cookieStr = client.handshake.headers.cookie || '';
      const match = cookieStr.match(/(?:^|;\s*)access_token=([^;]+)/);
      if (!match) return null;
      const token = decodeURIComponent(match[1]);
      const payload = this.jwtService.verify<{ sub?: number }>(token);
      return Number.isInteger(payload.sub) ? payload.sub! : null;
    } catch {
      return null;
    }
  }
}
