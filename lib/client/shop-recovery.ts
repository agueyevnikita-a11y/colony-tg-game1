export type ShopRecoveryReceipt = {
  recovered?: unknown;
  scanned?: unknown;
  ok?: unknown;
  stateUpdated: boolean;
};

type RecoveryActions = {
  recover: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
  isCurrentOwner: () => boolean;
};

/** Recovery may succeed even when refreshing the visible session fails. */
export async function recoverShopPurchases({ recover, refresh, isCurrentOwner }: RecoveryActions): Promise<ShopRecoveryReceipt> {
  // A failed recovery remains an error and must never trigger another recovery.
  const response = await recover();
  const receipt: ShopRecoveryReceipt = { stateUpdated: false };
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    for (const key of ['recovered', 'scanned', 'ok'] as const) {
      if (Object.hasOwn(response, key)) receipt[key] = (response as Record<string, unknown>)[key];
    }
  }
  try {
    if (!isCurrentOwner()) return receipt;
    await refresh();
    return { ...receipt, stateUpdated: isCurrentOwner() === true };
  } catch {
    return receipt;
  }
}
