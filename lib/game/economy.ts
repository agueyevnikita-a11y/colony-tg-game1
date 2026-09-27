import {
  BUILDINGS,
  DEFAULT_OFFLINE_CAP_HOURS,
  PREMIUM_OFFLINE_CAP_HOURS,
  PREMIUM_PRODUCTION_MULTIPLIER,
  type BuildingType,
  type ResourceCost,
} from './config';

export function levelMultiplier(level: number, factor = 1.55) {
  return Math.pow(factor, Math.max(0, level - 1));
}

export function passiveRate(type: BuildingType, level: number) {
  const p = BUILDINGS[type].passive;
  if (!p) return null;
  return { resource: p.resource, perHour: Math.floor(p.perHour * levelMultiplier(level, 1.45)) };
}

export function upgradeCost(type: BuildingType, currentLevel: number): ResourceCost {
  const base = BUILDINGS[type].baseBuildCost;
  const factor = Math.pow(1.6, currentLevel);
  const scale = (v?: number) => v ? Math.ceil(v * factor / 10) * 10 : undefined;
  return {
    ore: scale(base.ore),
    energy: scale(base.energy),
    parts: scale(base.parts),
    credits: scale(base.credits),
  };
}

export function buildTimeSec(type: BuildingType, targetLevel = 1, isPremium = false) {
  const base = BUILDINGS[type].baseBuildTimeSec;
  const raw = base * Math.pow(1.5, Math.max(0, targetLevel - 1));
  return Math.max(5, Math.ceil(raw * (isPremium ? 0.95 : 1)));
}

export function storageCaps(warehouseLevels: number[]) {
  const total = warehouseLevels.reduce((a, b) => a + b, 0);
  return {
    ore: 2000 + total * 1500,
    energy: 1200 + total * 900,
    parts: 800 + total * 600,
  };
}

export function calculatePassiveGain(params: {
  buildings: Array<{ type: BuildingType; level: number; status: string }>;
  hoursElapsed: number;
  premium: boolean;
  offlineCapBonusHours?: number;
  resourceMultipliers?: Partial<Record<'ore' | 'energy' | 'credits', number>>;
}) {
  const cap = (params.premium ? PREMIUM_OFFLINE_CAP_HOURS : DEFAULT_OFFLINE_CAP_HOURS) + Number(params.offlineCapBonusHours ?? 0);
  const hours = Math.max(0, Math.min(params.hoursElapsed, cap));
  const multiplier = params.premium ? PREMIUM_PRODUCTION_MULTIPLIER : 1;
  const gain = { ore: 0, energy: 0, credits: 0 };

  for (const b of params.buildings) {
    if (b.status !== 'active') continue;
    const rate = passiveRate(b.type, b.level);
    if (!rate) continue;
    const resourceMultiplier = Number(params.resourceMultipliers?.[rate.resource] ?? 1);
    // Keep sub-unit production so frequent session refreshes do not erase income.
    // The server carries the fractional part across ticks before storing integers.
    gain[rate.resource] += rate.perHour * hours * multiplier * resourceMultiplier;
  }
  return gain;
}

export function hasResources(state: Record<string, number>, cost: ResourceCost) {
  return Object.entries(cost).every(([key, value]) => !value || (state[key] ?? 0) >= value);
}
