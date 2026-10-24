export type PremiumDisplayStatus = {
  active: boolean;
  expiredNeedsRefresh: boolean;
  expiresAt: string | null;
};

/** A date never grants Premium; it can only show an expired server snapshot. */
export function premiumDisplayStatus(premium: boolean, premiumUntil: unknown, now: number): PremiumDisplayStatus {
  if (premium !== true) return { active: false, expiredNeedsRefresh: false, expiresAt: null };
  const deadline = typeof premiumUntil === 'string' && premiumUntil ? Date.parse(premiumUntil) : NaN;
  if (!Number.isFinite(deadline)) return { active: true, expiredNeedsRefresh: false, expiresAt: null };
  if (Number.isFinite(now) && deadline <= now) return { active: false, expiredNeedsRefresh: true, expiresAt: premiumUntil as string };
  return { active: true, expiredNeedsRefresh: false, expiresAt: premiumUntil as string };
}

function count(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= maximum;
}

/** Format only verified receipt fields; messages never acknowledge a pending invoice. */
export function recoveryReceiptMessage(receipt: unknown): string {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return 'Проверка завершена.';
  const result = receipt as Record<string, unknown>;
  const stateUpdated = Object.hasOwn(result, 'stateUpdated') && typeof result.stateUpdated === 'boolean' ? result.stateUpdated : undefined;
  const refreshNote = stateUpdated === false ? ' Данные колонии пока не обновлены. Обнови данные, чтобы проверить покупки.' : '';
  if (!Object.hasOwn(result, 'recovered') || !count(result.recovered, 50) || stateUpdated === undefined
    || (Object.hasOwn(result, 'scanned') && !count(result.scanned, 300))
    || (Object.hasOwn(result, 'ok') && result.ok !== true)) return `Проверка завершена.${refreshNote}`;
  if (result.recovered === 0) return `Новых подтверждённых покупок не найдено. Ожидающая оплата может ещё обрабатываться.${refreshNote}`;
  return `Восстановлено покупок: ${result.recovered}.${stateUpdated ? ' Данные колонии обновлены.' : refreshNote}`;
}
