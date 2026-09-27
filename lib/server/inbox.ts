import { APP_VERSION } from '@/lib/version';

export async function pushInbox(
  tx: any,
  userId: string,
  input: { kind?: string; dedupeKey: string; title: string; body: string; metadata?: Record<string, unknown>; expiresAt?: Date | string | null },
) {
  await tx`
    INSERT INTO game_inbox(user_id,kind,dedupe_key,title,body,metadata,expires_at)
    VALUES(${userId},${input.kind ?? 'system'},${input.dedupeKey},${input.title},${input.body},${tx.json(input.metadata ?? {})},${input.expiresAt ?? null})
    ON CONFLICT(user_id,dedupe_key) DO NOTHING
  `;
}

export async function ensureWelcomeInbox(tx: any, userId: string) {
  await pushInbox(tx,userId,{
    dedupeKey:'welcome_v10',
    title:'Добро пожаловать в COLONY Beta',
    body:'COLONY развивается вместе с первыми игроками. Здесь будут появляться системные сообщения, результаты важных событий и заметки теста.',
    metadata:{ version:APP_VERSION },
  });
}

export async function getInbox(tx: any, userId: string) {
  const items = await tx<any[]>`
    SELECT id,kind,title,body,metadata,read_at,created_at
    FROM game_inbox
    WHERE user_id=${userId} AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at DESC LIMIT 30
  `;
  const unread = items.filter((x:any)=>!x.read_at).length;
  return { items, unread };
}
