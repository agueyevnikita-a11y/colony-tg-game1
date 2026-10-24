import { DECOR_CATALOG, decorByType, type DecorType } from './decor';

export const COMFORT_MAX = 100;
export const COMFORT_MILESTONES = [
  { target: 25, reward: '10 кристаллов' },
  { target: 50, reward: 'Постоянная рамка «Живая колония»' },
  { target: 80, reward: '25 кристаллов' },
] as const;

type Decor = { type: string };

/** Only placed game decor counts. Shop themes and monument skins are excluded. */
export function calculateComfort(decor: readonly Decor[]) {
  const counts = Object.fromEntries(Object.keys(DECOR_CATALOG).map(type => [type, 0])) as Record<DecorType, number>;
  for (const item of decor) {
    if (item && decorByType(item.type)) counts[item.type as DecorType] += 1;
  }
  let rawScore = 0;
  let unique = 0;
  let total = 0;
  for (const [type, config] of Object.entries(DECOR_CATALOG)) {
    const count = counts[type as DecorType];
    total += count;
    if (!count) continue;
    unique += 1;
    rawScore += config.comfort + (count > 1 ? Math.floor(config.comfort / 2) : 0);
  }
  const score = Math.min(COMFORT_MAX, rawScore);
  return { score, rawScore, total, unique, counts, nextMilestone: COMFORT_MILESTONES.find(item => item.target > score) ?? null };
}

/** Marginal comfort, including the overall cap and diminishing duplicates. */
export function comfortPlacementGain(decor: readonly Decor[], type: string) {
  if (!decorByType(type)) return 0;
  const current = calculateComfort(decor);
  const count = current.counts[type as DecorType];
  const base = DECOR_CATALOG[type as DecorType].comfort;
  const points = count === 0 ? base : count === 1 ? Math.floor(base / 2) : 0;
  return Math.max(0, Math.min(points, COMFORT_MAX - current.score));
}

/** Potential from two copies of each available canonical type, before costs or map space. */
export function comfortAvailableCeiling(types: readonly string[]) {
  const uniqueTypes = [...new Set(types.filter(type => decorByType(type)))];
  return calculateComfort(uniqueTypes.flatMap(type => [{ type }, { type }])).score;
}
