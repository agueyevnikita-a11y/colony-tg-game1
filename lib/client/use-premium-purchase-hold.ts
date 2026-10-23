'use client';

import { useCallback, useEffect, useState } from 'react';
import { parsePremiumHold, premiumHoldConfirmed, type PremiumHold } from './purchase-holds';

function readHold(ownerKey: string): PremiumHold | null {
  try { return parsePremiumHold(sessionStorage.getItem(`${ownerKey}:premium`)); } catch { return null; }
}

function saveHold(ownerKey: string, hold: PremiumHold) {
  try { sessionStorage.setItem(`${ownerKey}:premium`, JSON.stringify(hold)); } catch { /* Keep the in-memory hold. */ }
}

function removeConfirmedHold(ownerKey: string, hold: PremiumHold) {
  try {
    // A late confirmation must not remove a newer renewal stored for the same player.
    if (readHold(ownerKey)?.purchaseId === hold.purchaseId) sessionStorage.removeItem(`${ownerKey}:premium`);
  } catch { /* Confirmed in memory even when browser storage is unavailable. */ }
}

/** Remember the particular paid/pending invoice, separately for each signed-in player. */
export function usePremiumPurchaseHold(ownerKey: string, paidIds: unknown): {
  pending: boolean;
  remember: (hold: PremiumHold) => void;
} {
  const [holds, setHolds] = useState<Map<string, PremiumHold | null>>(() => new Map());
  const hold = ownerKey ? holds.get(ownerKey) ?? null : null;

  useEffect(() => {
    if (!ownerKey) return;
    setHolds(previous => {
      if (previous.has(ownerKey)) return previous;
      return new Map(previous).set(ownerKey, readHold(ownerKey));
    });
  }, [ownerKey]);

  useEffect(() => {
    if (!hold || !premiumHoldConfirmed(hold, paidIds)) return;
    removeConfirmedHold(ownerKey, hold);
    setHolds(previous => previous.get(ownerKey)?.purchaseId === hold.purchaseId
      ? new Map(previous).set(ownerKey, null) : previous);
  }, [ownerKey, hold, paidIds]);

  const remember = useCallback((value: PremiumHold) => {
    const parsed = parsePremiumHold(value);
    if (!ownerKey || !parsed) return;
    // Persist before returning: Telegram may close/reload the page in this callback.
    saveHold(ownerKey, parsed);
    setHolds(previous => previous.get(ownerKey)?.purchaseId === parsed.purchaseId
      ? previous : new Map(previous).set(ownerKey, parsed));
  }, [ownerKey]);

  return { pending: !!hold && !premiumHoldConfirmed(hold, paidIds), remember };
}
