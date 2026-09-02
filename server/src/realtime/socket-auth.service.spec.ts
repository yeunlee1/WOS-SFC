// 소켓 인증 공유 서비스의 캐시 범위와 인증 우회 방지를 검증한다.
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { User } from '../users/users.entity';
import { SocketAuthService } from './socket-auth.service';

const USER = {
  id: 7,
  nickname: 'memberKo',
  allianceName: 'KOR',
  language: 'ko',
  role: 'member',
} as User;

function makeSocket(id: string, token = 'valid'): Socket {
  return {
    id,
    connected: true,
    handshake: { headers: { cookie: `access_token=${token}` } },
  } as unknown as Socket;
}

describe('SocketAuthService', () => {
  let jwtService: { verify: jest.Mock };
  let usersService: { findById: jest.Mock };
  let auth: SocketAuthService;

  beforeEach(() => {
    jwtService = {
      verify: jest.fn((token: string) => {
        if (token === 'valid') return { sub: USER.id };
        throw new Error('invalid token');
      }),
    };
    usersService = { findById: jest.fn().mockResolvedValue(USER) };
    auth = new SocketAuthService(
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService,
    );
  });

  it('같은 소켓을 몇 번 물어봐도 사용자 조회는 한 번만 돈다', async () => {
    const socket = makeSocket('s1');

    await auth.resolveUser(socket);
    await auth.resolveUser(socket);
    await auth.resolveUser(socket);

    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(jwtService.verify).toHaveBeenCalledTimes(1);
  });

  it('여러 게이트웨이가 동시에 물어봐도 조회는 한 번만 돈다', async () => {
    const socket = makeSocket('s1');
    let release!: (value: User) => void;
    usersService.findById.mockReturnValueOnce(
      new Promise<User>((resolve) => {
        release = resolve;
      }),
    );

    // await 없이 같은 tick에 세 번 — Nest가 네 게이트웨이를 부르는 방식과 같다.
    const pending = [
      auth.resolveUser(socket),
      auth.resolveUser(socket),
      auth.resolveUser(socket),
    ];
    release(USER);

    await expect(Promise.all(pending)).resolves.toEqual([USER, USER, USER]);
    expect(usersService.findById).toHaveBeenCalledTimes(1);
  });

  it('캐시는 소켓을 넘지 않는다 — 다른 소켓은 다시 조회한다', async () => {
    // 밴·역할 변경은 kickUser가 소켓을 끊는 것으로 반영된다. 캐시가 소켓 수명을
    // 넘기면 끊긴 뒤 재접속한 사용자가 옛 결과로 통과해 인증 우회가 된다.
    await auth.resolveUser(makeSocket('s1'));
    await auth.resolveUser(makeSocket('s2'));

    expect(usersService.findById).toHaveBeenCalledTimes(2);
    expect(jwtService.verify).toHaveBeenCalledTimes(2);
  });

  it('토큰이 유효하지 않으면 캐시가 있어도 통과하지 못하고 DB도 건드리지 않는다', async () => {
    const good = makeSocket('s-good', 'valid');
    await expect(auth.resolveUser(good)).resolves.toEqual(USER);

    const bad = makeSocket('s-bad', 'tampered');
    await expect(auth.resolveUser(bad)).resolves.toBeNull();
    expect(auth.verifyUserId(bad)).toBeNull();
    // 앞선 소켓의 성공 결과가 새 소켓으로 새지 않는다.
    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(usersService.findById).toHaveBeenCalledWith(USER.id);
  });

  it('쿠키에 access_token이 없으면 검증도 조회도 하지 않는다', async () => {
    const socket = {
      id: 's-nocookie',
      connected: true,
      handshake: { headers: {} },
    } as unknown as Socket;

    await expect(auth.resolveUser(socket)).resolves.toBeNull();
    expect(jwtService.verify).not.toHaveBeenCalled();
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('사용자 레코드가 없으면 null', async () => {
    usersService.findById.mockResolvedValue(null);
    await expect(auth.resolveUser(makeSocket('s1'))).resolves.toBeNull();
  });

  it('조회가 실패해도 예외를 밖으로 내보내지 않는다', async () => {
    usersService.findById.mockRejectedValue(new Error('DB 순단'));
    await expect(auth.resolveUser(makeSocket('s1'))).resolves.toBeNull();
  });

  it('verifyUserId도 소켓당 한 번만 서명을 검증한다', () => {
    const socket = makeSocket('s1');

    expect(auth.verifyUserId(socket)).toBe(USER.id);
    expect(auth.verifyUserId(socket)).toBe(USER.id);
    expect(auth.verifyUserId(socket)).toBe(USER.id);

    expect(jwtService.verify).toHaveBeenCalledTimes(1);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('먼저 verifyUserId가 돌았어도 resolveUser가 서명을 다시 검증하지 않는다', async () => {
    const socket = makeSocket('s1');

    auth.verifyUserId(socket);
    await auth.resolveUser(socket);

    expect(jwtService.verify).toHaveBeenCalledTimes(1);
    expect(usersService.findById).toHaveBeenCalledTimes(1);
  });

  it('sub가 정수가 아니면 인증 실패로 다룬다', async () => {
    jwtService.verify.mockReturnValue({ sub: 'not-a-number' });
    const socket = makeSocket('s1');

    expect(auth.verifyUserId(socket)).toBeNull();
    await expect(auth.resolveUser(socket)).resolves.toBeNull();
    expect(usersService.findById).not.toHaveBeenCalled();
  });
});
