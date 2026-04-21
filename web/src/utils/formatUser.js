export function formatUser(u) {
  if (!u) return '';
  const nick = u.nickname ?? '';
  const alliance = u.allianceName ?? '';
  return alliance ? `[${alliance}] ${nick}` : nick;
}
