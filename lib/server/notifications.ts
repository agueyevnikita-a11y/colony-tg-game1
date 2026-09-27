export type NotificationKind = 'building_ready' | 'research_ready' | 'expedition_ready';

export async function ensureNotificationPreferences(tx: any, userId: string) {
  await tx`
    INSERT INTO notification_preferences(user_id) VALUES(${userId})
    ON CONFLICT(user_id) DO NOTHING
  `;
}

export async function getNotificationPreferences(tx: any, userId: string) {
  await ensureNotificationPreferences(tx, userId);
  return (await tx<any[]>`
    SELECT np.*, u.bot_write_allowed
    FROM notification_preferences np JOIN users u ON u.id=np.user_id
    WHERE np.user_id=${userId}
  `)[0];
}

export async function enqueueNotification(
  tx: any,
  userId: string,
  kind: NotificationKind,
  dedupeKey: string,
  scheduledAt: Date | string,
  payload: Record<string, unknown> = {},
) {
  await ensureNotificationPreferences(tx, userId);
  await tx`
    INSERT INTO notification_jobs(user_id,kind,dedupe_key,scheduled_at,payload)
    VALUES(${userId},${kind},${dedupeKey},${scheduledAt},${tx.json(payload)})
    ON CONFLICT(user_id,dedupe_key) DO UPDATE SET
      kind=EXCLUDED.kind, scheduled_at=EXCLUDED.scheduled_at, payload=EXCLUDED.payload,
      sent_at=NULL, cancelled_at=NULL, error_text=NULL
  `;
}

export function notificationText(kind: NotificationKind, payload: any) {
  if (kind === 'building_ready') return `🏗️ ${payload?.name ?? 'Строительство'} завершено. Колония ждёт твоих новых приказов.`;
  if (kind === 'research_ready') return `🧪 Исследование «${payload?.name ?? 'технология'}» завершено. Новый эффект уже активен.`;
  return `🚀 Экспедиция «${payload?.name ?? 'экспедиция'}» вернулась. Забери результат и проверь события.`;
}
