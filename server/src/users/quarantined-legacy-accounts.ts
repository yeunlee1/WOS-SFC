// 공개 저장소에 자격증명이 노출됐던 레거시 개발 계정을 인증 경로에서 격리한다.
const QUARANTINED_LEGACY_ACCOUNT_NICKNAMES = new Set([
  'devdevko',
  'devadminko',
  'devadminzh',
  'devadminen',
  'devadminja',
  'devmemberko',
  'devmemberzh',
  'devmemberen',
  'devmemberja',
]);

export function isQuarantinedLegacyAccount(
  nickname: string | null | undefined,
): boolean {
  return (
    typeof nickname === 'string' &&
    QUARANTINED_LEGACY_ACCOUNT_NICKNAMES.has(nickname.toLowerCase())
  );
}
