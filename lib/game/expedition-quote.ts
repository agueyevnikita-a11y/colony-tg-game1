export type ExpeditionReward = { ore: number; parts: number; credits: number; science: number; crystals: number };

/** Validate the complete exchange before charging a decision or claiming cargo. */
export function quoteExpeditionSettlement(
  baseReward: Record<string, unknown>,
  extraReward: Record<string, unknown>,
  cost: Record<string, unknown>,
  resources: Record<string, unknown>,
  capacities: Partial<Record<'ore' | 'energy' | 'parts', number>>,
) {
  let valid = true;
  const amount = (value: unknown) => {
    if (value === undefined || value === null) return 0;
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(parsed) || parsed < 0) { valid = false; return 0; }
    return parsed;
  };
  const available = (value: unknown) => {
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  const reward: ExpeditionReward = {
    ore: amount(baseReward.ore) + amount(extraReward.ore),
    parts: amount(baseReward.parts) + amount(extraReward.parts),
    credits: amount(baseReward.credits) + amount(extraReward.credits),
    science: amount(baseReward.science) + amount(extraReward.science),
    crystals: amount(baseReward.crystals) + amount(extraReward.crystals),
  };
  const shortages: Record<string, number> = {};
  const costs: Record<string, number> = {};
  for (const resource of ['ore', 'energy', 'parts', 'credits', 'science', 'crystals']) {
    costs[resource] = amount(cost[resource]);
    const missing = costs[resource] - available(resources[resource]);
    if (missing > 0) shortages[resource] = missing;
  }
  const storageShortages: Record<string, number> = {};
  for (const resource of ['ore', 'parts'] as const) {
    if (reward[resource] === 0) continue;
    const capacity = available(capacities[resource]);
    const afterCost = Math.max(0, available(resources[resource]) - costs[resource]);
    const missing = afterCost + reward[resource] - capacity;
    if (missing > 0) storageShortages[resource] = missing;
  }
  return { reward, shortages, storageShortages, canClaim: valid && Object.keys(shortages).length === 0 && Object.keys(storageShortages).length === 0 };
}
