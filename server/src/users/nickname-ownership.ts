// 닉네임 재사용 계정이 이전 계정의 작성물을 소유자로 오인받지 않게 판별한다.
export function hasOriginalNicknameOwnership(
  user: { nickname: string; createdAt: Date },
  authorNickname: string,
  authoredAt: Date,
): boolean {
  if (user.nickname !== authorNickname) return false;

  const accountCreatedAt = new Date(user.createdAt).getTime();
  const contentCreatedAt = new Date(authoredAt).getTime();
  return (
    Number.isFinite(accountCreatedAt) &&
    Number.isFinite(contentCreatedAt) &&
    accountCreatedAt < contentCreatedAt
  );
}
