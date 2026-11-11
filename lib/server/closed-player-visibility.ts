import { accountKey, isClosedCase, listAccountCases } from '@/scripts/privacy/lib/case-store.mjs';

/** Resolve closure identities without exposing the internal Telegram IDs. */
export async function closedPlayerIds(tx: any): Promise<string[]> {
  // An explicitly unconfigured local toy environment has no real privacy store.
  // Storage errors in a configured environment, including development, still fail closed.
  if(process.env.NODE_ENV==='development'&&!process.env.ACCOUNT_ERASURE_SECRET&&!process.env.ACCOUNT_CLOSURE_DIR)return [];
  try {
    // Do not turn an unavailable or damaged privacy ledger into an empty list.
    const closed = (await listAccountCases()).filter(isClosedCase);
    if (!closed.length) return [];
    const ids = new Set(closed.map(record => record.userId));
    const keys = new Set(closed.map(record => record.accountKey));
    // A restored database may use a different game UUID for the same identity.
    const users = await tx<{ id: string; telegram_id: string | number }[]>`SELECT id,telegram_id FROM users`;
    for (const user of users) {
      const telegramId = Number(user.telegram_id);
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0) throw new Error('Не удалось проверить доступность профилей');
      if (keys.has(accountKey(telegramId))) ids.add(user.id);
    }
    return [...ids];
  } catch {
    throw new Error('Профили колоний временно недоступны. Попробуйте позже.');
  }
}
