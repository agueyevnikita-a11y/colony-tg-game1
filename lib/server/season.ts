import { ACTIVE_SEASON_ID, SEASON_EVENT_POINTS, SEASON_REWARDS, type SeasonReward } from '@/lib/game/season';
import { grantCosmetic } from '@/lib/server/cosmetics';

export type SeasonClaimRequest = { all: true; level?: never } | { level: number; all?: never };
export type SeasonClaimResult = {
  seasonId: string;
  count: number;
  credits: number;
  crystals: number;
  cosmeticIds: string[];
  levels: number[];
  rewards: SeasonReward[];
};

export function parseSeasonClaimRequest(value: unknown): SeasonClaimRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Укажи уровень награды или сбор готовых наград');
  const body = value as Record<string, unknown>;
  if ('all' in body) {
    if (body.all !== true || 'level' in body) throw new Error('Сбор готовых наград нельзя совмещать с уровнем');
    return { all: true };
  }
  if (typeof body.level !== 'number' || !Number.isSafeInteger(body.level) || body.level <= 0) throw new Error('Уровень награды должен быть целым положительным числом');
  return { level: body.level };
}

export async function ensureActiveSeasonProgress(tx: any, userId: string) {
  const rows = await tx<any[]>`SELECT * FROM seasons WHERE id=${ACTIVE_SEASON_ID} AND starts_at<=now() AND ends_at>now() LIMIT 1`;
  const season = rows[0];
  if (!season) return null;
  await tx`INSERT INTO season_progress(user_id,season_id,points) VALUES(${userId},${season.id},0) ON CONFLICT(user_id,season_id) DO NOTHING`;
  return season;
}

export async function addSeasonPoints(tx: any, userId: string, eventName: string, amount = 1) {
  const season = await ensureActiveSeasonProgress(tx, userId);
  if (!season) return;
  const points = Number(SEASON_EVENT_POINTS[eventName] ?? 0) * amount;
  if (points <= 0) return;
  await tx`UPDATE season_progress SET points=points+${points},updated_at=now() WHERE user_id=${userId} AND season_id=${season.id}`;
}

export async function getSeasonState(tx: any, userId: string) {
  const season = await ensureActiveSeasonProgress(tx, userId);
  if (!season) return null;
  const progress = (await tx<any[]>`SELECT * FROM season_progress WHERE user_id=${userId} AND season_id=${season.id}`)[0];
  const claims = await tx<any[]>`SELECT level,claimed_at FROM season_claims WHERE user_id=${userId} AND season_id=${season.id} ORDER BY level`;
  return { ...season, points: Number(progress?.points ?? 0), claims, rewards: SEASON_REWARDS };
}

export async function claimSeasonRewards(tx: any, userId: string, request: SeasonClaimRequest): Promise<SeasonClaimResult> {
  const selection = parseSeasonClaimRequest(request);
  // Production and all reward callers acquire these locks in the same order.
  const state = (await tx<any[]>`SELECT user_id FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
  if (!state) throw new Error('Игровой профиль не найден');
  const season = await ensureActiveSeasonProgress(tx, userId);
  if (!season) throw new Error('Сейчас нет активного сезона');
  const progress = (await tx<any[]>`SELECT points FROM season_progress WHERE user_id=${userId} AND season_id=${season.id} FOR UPDATE`)[0];
  const claims = await tx<any[]>`SELECT level FROM season_claims WHERE user_id=${userId} AND season_id=${season.id} ORDER BY level FOR UPDATE`;
  const claimed = new Set(claims.map((row: any) => Number(row.level)));
  const rewards = [...SEASON_REWARDS].sort((a, b) => a.level - b.level);
  const points = Number(progress?.points ?? 0);
  const isBulk = selection.all === true;
  if (!isBulk) {
    const reward = rewards.find(row => row.level === selection.level);
    if (!reward) throw new Error('Награда сезона не найдена');
    if (points < reward.points) throw new Error('Недостаточно сезонных очков');
    if (claimed.has(reward.level)) throw new Error('Эта награда уже получена');
  }
  const available = rewards.filter(reward => points >= reward.points && !claimed.has(reward.level) && (isBulk || reward.level === selection.level));
  const paid: SeasonReward[] = [];
  for (const reward of available) {
    const inserted = await tx<any[]>`INSERT INTO season_claims(user_id,season_id,level) VALUES(${userId},${season.id},${reward.level}) ON CONFLICT(user_id,season_id,level) DO NOTHING RETURNING level`;
    // Only a new receipt authorizes a payout, including temporary cosmetics.
    if (!inserted.length) continue;
    if (reward.cosmeticId) await grantCosmetic(tx, userId, reward.cosmeticId, `season_${season.id}`, reward.cosmeticDays);
    paid.push(reward);
  }
  const credits = paid.reduce((sum, reward) => sum + (reward.credits ?? 0), 0);
  const crystals = paid.reduce((sum, reward) => sum + (reward.crystals ?? 0), 0);
  if (credits || crystals) await tx`UPDATE game_states SET credits=credits+${credits},crystals=crystals+${crystals},updated_at=now() WHERE user_id=${userId}`;
  return { seasonId: season.id, count: paid.length, credits, crystals, cosmeticIds: paid.flatMap(reward => reward.cosmeticId ? [reward.cosmeticId] : []), levels: paid.map(reward => reward.level), rewards: paid };
}

// Preserve the original helper contract for existing internal callers.
export async function claimSeasonReward(tx: any, userId: string, level: number): Promise<SeasonReward> {
  const result = await claimSeasonRewards(tx, userId, { level });
  if (!result.rewards[0]) throw new Error('Эта награда уже получена');
  return result.rewards[0];
}
