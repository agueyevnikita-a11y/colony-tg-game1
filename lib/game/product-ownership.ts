import { PRODUCTS } from './config';

type CosmeticOwnership = { cosmetic_id: string; expires_at: unknown };

export const FOUNDER_COSMETIC_IDS = ['founder_badge', 'founder_monument', 'founder_frame', 'founder_sky'] as const;

/** Temporary access never prevents buying permanent access; Premium can renew. */
export function permanentProductOwned(productId: unknown, ownerships: readonly CosmeticOwnership[]) {
  if (typeof productId !== 'string' || !Object.hasOwn(PRODUCTS, productId)) return false;
  const product = PRODUCTS[productId as keyof typeof PRODUCTS];
  const permanent = new Set(ownerships.filter((item) => item.expires_at === null).map((item) => item.cosmetic_id));
  if (product.kind === 'cosmetic') return !!product.cosmeticId && permanent.has(product.cosmeticId);
  if (product.kind === 'bundle') return FOUNDER_COSMETIC_IDS.every((id) => permanent.has(id));
  return false;
}
