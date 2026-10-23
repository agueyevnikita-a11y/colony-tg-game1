export type SupplyProductionPlan = {
  requiredParts: number;
  stockParts: number;
  queuedParts: number;
  missingParts: number;
  neededCycles: number;
  suggestedCycles: number;
  batchParts: number;
  remainingAfterBatch: number;
  surplusParts: number;
};

/** Suggest a batch from the actual workshop quote; this never starts an order. */
export function supplyProductionPlan({ requiredParts, currentParts, queuedParts, cycleParts, freeSlots }: {
  requiredParts: number; currentParts: number; queuedParts: number; cycleParts: number; freeSlots: number;
}): SupplyProductionPlan {
  if (![requiredParts, currentParts, queuedParts, cycleParts, freeSlots].every(Number.isSafeInteger)
      || requiredParts < 0 || currentParts < 0 || queuedParts < 0 || cycleParts < 1 || freeSlots < 0 || freeSlots > 12) {
    throw new Error('Не удалось рассчитать производственную цель');
  }
  const missingParts = Math.max(0, requiredParts - currentParts - queuedParts);
  const neededCycles = Math.ceil(missingParts / cycleParts);
  const suggestedCycles = Math.min(neededCycles, freeSlots);
  const batchParts = suggestedCycles * cycleParts;
  if (!Number.isSafeInteger(batchParts)) throw new Error('Не удалось рассчитать производственную цель');
  return { requiredParts, stockParts: currentParts, queuedParts, missingParts, neededCycles, suggestedCycles, batchParts,
    remainingAfterBatch: Math.max(0, missingParts - batchParts), surplusParts: Math.max(0, batchParts - missingParts) };
}
