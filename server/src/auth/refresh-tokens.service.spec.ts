// jti 해시가 결정적이고 발급 시 만료 행이 정리되는지 확인한다.
import { RefreshTokensService, hashRefreshJti } from './refresh-tokens.service';

it('같은 jti 는 같은 sha256 해시를 낸다', () => {
  expect(hashRefreshJti('abc')).toBe(hashRefreshJti('abc'));
  expect(hashRefreshJti('abc')).toHaveLength(64);
  expect(hashRefreshJti('abc')).not.toBe(hashRefreshJti('abd'));
});

it('issue 는 그 사용자의 만료 행을 먼저 지우고 새 행을 넣는다', async () => {
  const repo = {
    delete: jest.fn(async () => undefined),
    insert: jest.fn(async () => undefined),
    find: jest.fn(async () => []),
  };
  const service = new RefreshTokensService(repo as never);
  const jti = await service.issue(7);
  expect(jti).toHaveLength(36);
  expect(repo.delete).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
  expect(repo.insert).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 7, tokenHash: hashRefreshJti(jti) }),
  );
});
