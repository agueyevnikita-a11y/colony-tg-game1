export type GoalResource = 'ore' | 'energy' | 'parts' | 'credits' | 'science';
export type GoalCost = Partial<Record<GoalResource, number>>;
export type GoalBudgetInput = {
  cost: GoalCost;
  resources: Record<string, unknown>;
  caps?: Record<string, unknown>;
  escrow?: Record<string, unknown>;
  buildings?: readonly { id: string; type: string }[];
  jobs?: readonly { building_id: string; parts_reward: unknown }[];
  partialDelivery?: boolean;
};
const RESOURCES: readonly GoalResource[] = ['ore', 'energy', 'parts', 'credits', 'science'];
function amount(value: unknown) {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Paid outputs are future stock, never current funds or a reason to pay for them twice. */
export function goalBudget(input: GoalBudgetInput) {
  const cost: GoalCost = {}, missing: GoalCost = {}, capacityMissing: GoalCost = {};
  for (const resource of RESOURCES) {
    const required = amount(input.cost[resource]);
    if (!required) continue;
    cost[resource] = required;
    const gap = Math.ceil(Math.max(0, required - amount(input.resources[resource])));
    if (!gap) continue;
    missing[resource] = gap;
    // Partial supply shipments need not fit their whole stage in storage at once.
    if (!input.partialDelivery && ['ore', 'energy', 'parts'].includes(resource) && input.caps?.[resource] !== undefined) {
      const usableCap = Math.max(0, amount(input.caps[resource]) - amount(input.escrow?.[resource]));
      if (required > usableCap) capacityMissing[resource] = Math.ceil(required - usableCap);
    }
  }
  const foundries = new Set((input.buildings ?? []).filter(building => building.type === 'foundry').map(building => building.id));
  const queuedParts = Math.floor((input.jobs ?? []).reduce((sum, job) => foundries.has(job.building_id) ? sum + amount(job.parts_reward) : sum, 0));
  const partsToProduce = Math.max(0, (missing.parts ?? 0) - queuedParts);
  const deliverable = RESOURCES.some(resource => amount(cost[resource]) > 0 && amount(input.resources[resource]) >= 1);
  return { cost, missing, capacityMissing, queuedParts, partsToProduce, deliverable };
}
