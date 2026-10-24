import type { SeasonReward } from './season';

type NormalReward = {
  level: number;
  points: number;
  title: string;
  credits: number;
  crystals: number;
  cosmeticId: string | null;
  cosmeticDays: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function reward(value: unknown): NormalReward | null {
  if (!record(value) || !integer(value.level, 1) || !integer(value.points)
    || typeof value.title !== 'string' || !value.title.trim()) return null;
  const credits = value.credits === undefined ? 0 : value.credits;
  const crystals = value.crystals === undefined ? 0 : value.crystals;
  const cosmeticDays = value.cosmeticDays === undefined ? 0 : value.cosmeticDays;
  if (!integer(credits) || !integer(crystals) || !integer(cosmeticDays)) return null;
  const cosmeticId = value.cosmeticId === undefined ? null : value.cosmeticId;
  if (cosmeticId !== null && (typeof cosmeticId !== 'string' || !cosmeticId.trim())) return null;
  if (cosmeticId === null && (value.cosmeticId !== undefined || cosmeticDays > 0)) return null;
  return { level: value.level, points: value.points, title: value.title, credits, crystals, cosmeticId, cosmeticDays };
}

function sameReward(actual: NormalReward, expected: NormalReward) {
  return actual.level === expected.level && actual.points === expected.points && actual.title === expected.title
    && actual.credits === expected.credits && actual.crystals === expected.crystals
    && actual.cosmeticId === expected.cosmeticId && actual.cosmeticDays === expected.cosmeticDays;
}

/** Confirm only a paid subset of the ready rewards captured before the explicit claim. */
export function validSeasonClaimReceipt(value: unknown, seasonId: string, selected: readonly SeasonReward[]): boolean {
  if (typeof seasonId !== 'string' || !seasonId.trim() || !Array.isArray(selected) || !selected.length) return false;
  const selectedByLevel = new Map<number, NormalReward>();
  for (const item of selected) {
    const normal = reward(item);
    if (!normal || selectedByLevel.has(normal.level)) return false;
    selectedByLevel.set(normal.level, normal);
  }
  if (!record(value) || value.seasonId !== seasonId || !integer(value.count)
    || !integer(value.credits) || !integer(value.crystals)
    || !Array.isArray(value.levels) || !Array.isArray(value.rewards) || !Array.isArray(value.cosmeticIds)
    || value.levels.length !== value.count || value.rewards.length !== value.count) return false;

  const paid = new Map<number, NormalReward>();
  let credits = 0, crystals = 0;
  const cosmeticCounts = new Map<string, number>();
  for (const level of value.levels) {
    if (!integer(level, 1) || paid.has(level)) return false;
    const expected = selectedByLevel.get(level);
    if (!expected) return false;
    paid.set(level, expected);
    credits += expected.credits;
    crystals += expected.crystals;
    if (!Number.isSafeInteger(credits) || !Number.isSafeInteger(crystals)) return false;
    if (expected.cosmeticId) cosmeticCounts.set(expected.cosmeticId, (cosmeticCounts.get(expected.cosmeticId) ?? 0) + 1);
  }
  if (value.credits !== credits || value.crystals !== crystals) return false;

  const matchedRewards = new Set<number>();
  for (const item of value.rewards) {
    const actual = reward(item);
    if (!actual || matchedRewards.has(actual.level)) return false;
    const expected = paid.get(actual.level);
    if (!expected || !sameReward(actual, expected)) return false;
    matchedRewards.add(actual.level);
  }
  for (const cosmeticId of value.cosmeticIds) {
    if (typeof cosmeticId !== 'string') return false;
    const remaining = cosmeticCounts.get(cosmeticId) ?? 0;
    if (remaining <= 0) return false;
    cosmeticCounts.set(cosmeticId, remaining - 1);
  }
  return [...cosmeticCounts.values()].every(count => count === 0);
}
