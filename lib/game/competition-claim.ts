export type CompetitionClaimReceipt = {
  periodId: string;
  count: number;
  crystals: number;
  cosmeticIds: string[];
};

/** A display receipt confirms only the requested week, never estimated prizes. */
export function competitionClaimReceipt(value: unknown, periodId: string): CompetitionClaimReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!['periodId', 'count', 'crystals', 'cosmeticIds'].every(key => Object.hasOwn(row, key))) return null;
  if (row.periodId !== periodId || !Number.isSafeInteger(row.count) || Number(row.count) < 0 || Number(row.count) > 2
    || !Number.isSafeInteger(row.crystals) || Number(row.crystals) < 0 || !Array.isArray(row.cosmeticIds)
    || !row.cosmeticIds.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id))
    || new Set(row.cosmeticIds).size !== row.cosmeticIds.length) return null;
  if (row.count === 0 && (row.crystals !== 0 || row.cosmeticIds.length !== 0)) return null;
  return { periodId, count: Number(row.count), crystals: Number(row.crystals), cosmeticIds: [...row.cosmeticIds] };
}
