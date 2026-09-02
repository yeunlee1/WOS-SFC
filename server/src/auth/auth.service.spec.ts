// 두 기기 동시 로그인·회전·부분 로그아웃이 refresh 토큰 테이블로 올바르게 동작하는지 검증한다.
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FindOperator } from 'typeorm';
import { AuthService } from './auth.service';
import { RefreshToken } from './refresh-token.entity';
import { MAX_SESSIONS_PER_USER, RefreshTokensService } from './refresh-tokens.service';

// bcrypt 는 네이티브 모듈이라 spyOn 이 안 된다(속성 재정의 불가). 비밀번호 대조는 이 스펙의 관심사가 아니다.
jest.mock('bcrypt', () => ({
  compare: jest.fn(async () => true),
  hash: jest.fn(async () => 'hashed'),
}));

const user = {
  id: 1,
  nickname: 'alice',
  role: 'member',
  allianceName: 'KOR',
  language: 'ko',
  passwordHash: 'hash',
};

/** TypeORM Repository 의 실제 호출 형태(where 객체, FindOperator, id 배열 삭제)를 흉내 낸 메모리 저장소. */
function makeRepoFake() {
  const rows: RefreshToken[] = [];
  let nextId = 1;
  const matches = (row: RefreshToken, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const actual = (row as unknown as Record<string, unknown>)[key];
      if (value instanceof FindOperator) {
        return (
          value.type === 'lessThan' &&
          (actual as Date).getTime() < (value.value as Date).getTime()
        );
      }
      return actual === value;
    });
  return {
    rows,
    insert: jest.fn(async (row: Partial<RefreshToken>) => {
      rows.push({ id: nextId++, createdAt: new Date(), ...row } as RefreshToken);
    }),
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) => matches(row, where)) ?? null,
    ),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((row) => matches(row, where)).sort((a, b) => b.id - a.id),
    ),
    update: jest.fn(async (id: number, patch: Partial<RefreshToken>) => {
      Object.assign(rows.find((row) => row.id === id) as RefreshToken, patch);
    }),
    delete: jest.fn(async (criteria: number[] | Record<string, unknown>) => {
      const victims = Array.isArray(criteria)
        ? rows.filter((row) => criteria.includes(row.id))
        : rows.filter((row) => matches(row, criteria));
      for (const victim of victims) rows.splice(rows.indexOf(victim), 1);
    }),
  };
}

describe('AuthService 기기별 refresh 토큰', () => {
  let service: AuthService;
  let repo: ReturnType<typeof makeRepoFake>;
  const usersService = {
    findByNickname: jest.fn(async () => user),
    findById: jest.fn(async () => user),
  };

  beforeEach(() => {
    repo = makeRepoFake();
    service = new AuthService(
      usersService as never,
      new JwtService({ secret: 'auth-service-spec-secret' }),
      new RefreshTokensService(repo as never),
    );
  });

  const login = () => service.login({ nickname: 'alice', password: 'pw' });

  it('두 기기가 각자의 토큰으로 모두 갱신할 수 있다', async () => {
    const pc = await login();
    const phone = await login();
    await expect(service.refreshTokens(pc.refreshToken)).resolves.toMatchObject({ user: { id: 1 } });
    await expect(service.refreshTokens(phone.refreshToken)).resolves.toMatchObject({ user: { id: 1 } });
  });

  it('회전된 옛 토큰은 다시 쓸 수 없다', async () => {
    const pc = await login();
    await service.refreshTokens(pc.refreshToken);
    await expect(service.refreshTokens(pc.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('한 기기의 로그아웃은 다른 기기를 유지한다', async () => {
    const pc = await login();
    const phone = await login();
    await service.logout(1, pc.refreshToken);
    await expect(service.refreshTokens(pc.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refreshTokens(phone.refreshToken)).resolves.toBeDefined();
  });

  it('만료된 행은 거부한다', async () => {
    const pc = await login();
    repo.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.refreshTokens(pc.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('상한을 넘으면 가장 오래된 세션이 지워진다', async () => {
    const first = await login();
    for (let i = 0; i < MAX_SESSIONS_PER_USER; i += 1) await login();
    expect(repo.rows).toHaveLength(MAX_SESSIONS_PER_USER);
    await expect(service.refreshTokens(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh 쿠키 없이 로그아웃하면 아무 세션도 지우지 않는다', async () => {
    await login();
    await service.logout(1, undefined);
    expect(repo.rows).toHaveLength(1);
  });

  it('access 토큰을 refresh 자리에 넣으면 거부한다', async () => {
    const pc = await login();
    await expect(service.refreshTokens(pc.accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
