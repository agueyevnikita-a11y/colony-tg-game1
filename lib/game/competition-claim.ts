export type CompetitionClaimReceipt = {
  periodId: string;
  count: number;
  crystals: number;
  cosmeticIds: string[];
};

export type CompetitionAwardSnapshot = {
  kind: 'personal' | 'alliance';
  crystals: number;
  cosmeticIds: readonly string[];
};

export type ConfirmedCompetitionClaim = CompetitionClaimReceipt & {
  paidKinds: ('personal' | 'alliance')[];
  complete: boolean;
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

/** Match actual aggregate payment to a unique subset of this week's unclaimed awards. */
export function competitionClaimForAwards(value: unknown, periodId: string, awards: readonly CompetitionAwardSnapshot[]): ConfirmedCompetitionClaim | null {
  const receipt = competitionClaimReceipt(value, periodId);
  if (!receipt || !Array.isArray(awards) || awards.length < 1 || awards.length > 2
    || new Set(awards.map(award => award?.kind)).size !== awards.length
    || awards.some(award => !award || (award.kind !== 'personal' && award.kind !== 'alliance')
      || !Number.isSafeInteger(award.crystals) || award.crystals < 0 || !Array.isArray(award.cosmeticIds)
      || award.cosmeticIds.some((id: unknown) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      || new Set(award.cosmeticIds).size !== award.cosmeticIds.length)) return null;
  if (receipt.count === 0) return { ...receipt, paidKinds: [], complete: false };
  const matching: CompetitionAwardSnapshot[][] = [];
  for (let mask = 1; mask < 2 ** awards.length; mask++) {
    const selected = awards.filter((_award, index) => mask & (1 << index));
    if (selected.length !== receipt.count || selected.reduce((sum, award) => sum + award.crystals, 0) !== receipt.crystals) continue;
    const cosmetics = new Set(selected.flatMap(award => [...award.cosmeticIds]));
    if (cosmetics.size === receipt.cosmeticIds.length && receipt.cosmeticIds.every(id => cosmetics.has(id))) matching.push(selected);
  }
  // An ambiguous partial receipt must not claim ownership of either award.
  if (matching.length !== 1) return null;
  return { ...receipt, paidKinds: matching[0].map(award => award.kind), complete: receipt.count === awards.length };
}
