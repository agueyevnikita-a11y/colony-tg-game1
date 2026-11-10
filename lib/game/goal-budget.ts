export type GoalResource = 'ore' | 'energy' | 'parts' | 'credits' | 'science';
export type GoalCost = Partial<Record<GoalResource, number>>;
export type GoalStorageLimit = {
  resource: 'ore' | 'energy' | 'parts';
  capacity: number;
  reserved: number;
  usableCapacity: number;
  required: number;
  shortfall: number;
};
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
function knownCapacity(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Paid outputs are future stock, never current funds or a reason to pay for them twice. */
export function goalBudget(input: GoalBudgetInput) {
  const cost: GoalCost = {}, missing: GoalCost = {}, capacityMissing: GoalCost = {};
  const storageLimits: GoalStorageLimit[] = [];
  for (const resource of RESOURCES) {
    const required = amount(input.cost[resource]);
    if (!required) continue;
    cost[resource] = required;
    const gap = Math.ceil(Math.max(0, required - amount(input.resources[resource])));
    if (!gap) continue;
    missing[resource] = gap;
    // Partial supply shipments need not fit their whole stage in storage at once.
    if (!input.partialDelivery && (resource === 'ore' || resource === 'energy' || resource === 'parts')) {
      const capacity = knownCapacity(input.caps?.[resource]);
      const reserveValue = input.escrow?.[resource];
      const reserved = reserveValue === undefined ? 0 : knownCapacity(reserveValue);
      if (capacity === null || reserved === null) continue;
      const usableCapacity = Math.max(0, capacity - reserved);
      if (required > usableCapacity) {
        const shortfall = Math.ceil(required - usableCapacity);
        capacityMissing[resource] = shortfall;
        storageLimits.push({ resource, capacity, reserved, usableCapacity, required, shortfall });
      }
    }
  }
  const foundries = new Set((input.buildings ?? []).filter(building => building.type === 'foundry').map(building => building.id));
  const queuedParts = Math.floor((input.jobs ?? []).reduce((sum, job) => foundries.has(job.building_id) ? sum + amount(job.parts_reward) : sum, 0));
  const partsToProduce = Math.max(0, (missing.parts ?? 0) - queuedParts);
  const deliverable = RESOURCES.some(resource => amount(cost[resource]) > 0 && amount(input.resources[resource]) >= 1);
  return { cost, missing, capacityMissing, storageLimits, queuedParts, partsToProduce, deliverable };
}
