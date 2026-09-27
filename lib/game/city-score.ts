import type { BuildingType } from '@/lib/game/config';

const BUILDING_SCORE_WEIGHT: Record<BuildingType, number> = {
  hq: 0,
  mine: 80,
  solar: 80,
  warehouse: 90,
  foundry: 120,
  habitat: 100,
  trade_hub: 140,
  research_lab: 180,
  logistics: 220,
  expedition_center: 260,
  alliance_hub: 320,
  observatory: 420,
};

export function cityScore(buildings: Array<{ type: string; level: number; status?: string }>, hqLevel: number) {
  const hqScore = Math.max(1, hqLevel) ** 2 * 1000;
  const unique = new Set<string>();
  let buildingScore = 0;
  for (const building of buildings) {
    if (building.type === 'hq') continue;
    const weight = BUILDING_SCORE_WEIGHT[building.type as BuildingType] ?? 60;
    const level = Math.max(1, Number(building.level || 1));
    unique.add(building.type);
    buildingScore += Math.round(weight * Math.pow(level, 1.35));
  }
  const varietyBonus = unique.size * 75;
  return Math.round(hqScore + buildingScore + varietyBonus);
}
