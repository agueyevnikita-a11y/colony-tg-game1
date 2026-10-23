export type ProductionResource = 'ore' | 'energy';
export type ProductionSupplyRow = {
  resource: ProductionResource;
  costPerCycle: number;
  requiredPerHour: number;
  passivePerHour: number;
  coverage: number;
  sustainable: boolean;
};

/** Compare one workshop's uninterrupted demand with passive income, never a completion ETA. */
export function productionSustainability({ cycleCost, cycleSeconds, resourceRates }: {
  cycleCost: Record<ProductionResource, number>;
  cycleSeconds: number;
  resourceRates?: Partial<Record<ProductionResource, number>>;
}): ProductionSupplyRow[] | null {
  if (!Number.isFinite(cycleSeconds) || cycleSeconds <= 0) return null;
  const rows: ProductionSupplyRow[] = [];
  for (const resource of ['ore', 'energy'] as const) {
    const cost = cycleCost[resource], income = resourceRates?.[resource];
    if (!Number.isSafeInteger(cost) || cost <= 0 || typeof income !== 'number' || !Number.isFinite(income) || income < 0) return null;
    const demand = cost * 3600 / cycleSeconds;
    if (!Number.isFinite(demand) || demand <= 0) return null;
    rows.push({ resource, costPerCycle: cost, requiredPerHour: demand, passivePerHour: income,
      coverage: Math.min(1, income / demand), sustainable: income >= demand });
  }
  return rows;
}
