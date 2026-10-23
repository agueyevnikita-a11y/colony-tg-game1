export type PremiumHold = { purchaseId: string };

const PURCHASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Session storage is untrusted; a hold contains only one canonical purchase identity. */
export function parsePremiumHold(raw: unknown): PremiumHold | null {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'purchaseId')) return null;
    const purchaseId = (value as { purchaseId?: unknown }).purchaseId;
    return typeof purchaseId === 'string' && purchaseId.length === 36 && PURCHASE_ID.test(purchaseId)
      ? { purchaseId: purchaseId.toLowerCase() } : null;
  } catch {
    return null;
  }
}

/** Only a matching server-confirmed receipt clears this particular pending renewal. */
export function premiumHoldConfirmed(hold: PremiumHold | null, paidIds: unknown): boolean {
  const parsed = parsePremiumHold(hold);
  return parsed !== null && Array.isArray(paidIds) && paidIds.includes(parsed.purchaseId);
}
