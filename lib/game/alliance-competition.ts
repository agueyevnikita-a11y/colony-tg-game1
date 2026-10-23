export const COMPETITION_POINTS_PER_MODULE = 10;
export const COMPETITION_MIN_REWARD_POINTS = 20;
export const COMPETITION_MIN_TEAM_CONTRIBUTORS = 3;
export const COMPETITION_PRIZES = [
  { from: 1, to: 1, personal: 100, alliancePool: 600, label: '1 место' },
  { from: 2, to: 3, personal: 75, alliancePool: 400, label: '2–3 места' },
  { from: 4, to: 10, personal: 50, alliancePool: 250, label: '4–10 места' },
  { from: 11, to: 50, personal: 20, alliancePool: 100, label: '11–50 места' },
] as const;

export function competitionWeek(now: Date | number = Date.now()) {
  const start = new Date(now);
  if (!Number.isFinite(start.getTime())) throw new Error('Некорректная дата недели');
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return { id: `cw-${start.toISOString().slice(0, 10)}`, startsAt: start.toISOString(), endsAt: end.toISOString() };
}

export function competitionPrize(rank: number) {
  return COMPETITION_PRIZES.find(prize => Number.isInteger(rank) && rank >= prize.from && rank <= prize.to) ?? null;
}

/** Largest remainders keep the finite pool exact, with a stable ID tie-break. */
function apportion(pool: number, members: readonly { userId: string; weight: number }[]) {
  const sum = members.reduce((total, member) => total + member.weight, 0);
  if (!sum || !members.length) return new Map<string, number>();
  const rows = members.map(member => {
    const raw = pool * member.weight / sum;
    return { userId: member.userId, amount: Math.floor(raw), remainder: raw - Math.floor(raw) };
  });
  const remaining = pool - rows.reduce((total, row) => total + row.amount, 0);
  rows.sort((a, b) => b.remainder - a.remainder || a.userId.localeCompare(b.userId, 'en'));
  for (let index = 0; index < remaining; index++) rows[index].amount++;
  return new Map(rows.map(row => [row.userId, row.amount]));
}

export function allocateAlliancePool(pool: number, contributors: readonly { userId: string; points: number }[]) {
  if (!Number.isSafeInteger(pool) || pool < 0) throw new Error('Некорректный призовой фонд');
  if (new Set(contributors.map(member => member.userId)).size !== contributors.length) throw new Error('Повторный участник');
  const members = contributors.filter(member => Number.isSafeInteger(member.points) && member.points >= COMPETITION_MIN_REWARD_POINTS);
  const equalPool = Math.floor(pool * .4);
  const equal = apportion(equalPool, members.map(member => ({ userId: member.userId, weight: 1 })));
  const weighted = apportion(pool - equalPool, members.map(member => ({ userId: member.userId, weight: member.points })));
  return members.map(member => ({ ...member, crystals: (equal.get(member.userId) ?? 0) + (weighted.get(member.userId) ?? 0) }));
}

export function competitionCosmetics(kind: 'personal' | 'alliance', rank: number) {
  if (!competitionPrize(rank)) return [];
  if (kind === 'alliance') return [rank <= 3 ? 'frame_coop_team' : 'title_coop_team'];
  return rank === 1 ? ['badge_coop_champion', 'title_coop_vanguard'] : rank <= 3 ? ['frame_coop_orbit', 'title_coop_vanguard'] : ['title_coop_vanguard'];
}

export type AllianceCompetitionState = {
  available: boolean;
  period: { id: string; startsAt: string; endsAt: string };
  minimumRewardPoints: number;
  minimumTeamContributors: number;
  pointsPerModule: number;
  binding: { allianceId: string; allianceName: string } | null;
  players: { userId: string; telegramId: string; name: string; points: number; rank: number; crystals: number }[];
  alliances: { allianceId: string; name: string; points: number; rank: number | null; pool: number; contributors: number; qualifiedContributors: number }[];
  me: { points: number; rank: number | null; estimatedPersonalCrystals: number; estimatedTeamCrystals: number };
  rewards: { periodId: string; endsAt: string; kind: 'personal' | 'alliance'; rank: number; crystals: number; cosmeticIds: string[]; allianceName: string | null; claimedAt: string | null }[];
  prizes: typeof COMPETITION_PRIZES;
};
