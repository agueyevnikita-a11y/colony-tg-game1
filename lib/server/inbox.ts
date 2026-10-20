import { APP_VERSION } from '@/lib/version';
import type { InboxFilter, InboxItem, InboxPage, InboxPageQuery } from '@/lib/game/inbox';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
type Cursor = { date: string; id: string };

function parsePageQuery(input: unknown): { filter: InboxFilter; limit: number; cursor: Cursor | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Некорректный запрос почты');
  const query = input as Record<string, unknown>;
  const filter = query.filter ?? 'all';
  const limit = query.limit ?? 5;
  if (filter !== 'all' && filter !== 'unread') throw new Error('Неизвестный фильтр почты');
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 30) throw new Error('На странице может быть от 1 до 30 сообщений');
  let cursor: Cursor | null = null;
  if (query.cursor !== undefined && query.cursor !== null) {
    if (typeof query.cursor !== 'string' || query.cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error('Некорректная страница почты');
    try {
      const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (decoded.v !== 1 || typeof decoded.date !== 'string' || !CURSOR_DATE.test(decoded.date)
        || !Number.isFinite(Date.parse(decoded.date)) || typeof decoded.id !== 'string' || !UUID.test(decoded.id)) throw new Error();
      cursor = { date: decoded.date, id: decoded.id };
    } catch { throw new Error('Некорректная страница почты'); }
  }
  return { filter, limit: Number(limit), cursor };
}

/** Count and page in one statement, using the same database snapshot. */
export async function getInboxPage(tx: any, userId: string, input: InboxPageQuery = {}): Promise<InboxPage> {
  const { filter, limit, cursor } = parsePageQuery(input);
  // Send cursor dates as TEXT first: postgres.js otherwise serializes an
  // inferred timestamptz through JavaScript Date, truncating microseconds.
  const [result] = await tx`
    WITH counts AS (
      SELECT count(*)::integer AS total,count(*) FILTER(WHERE read_at IS NULL)::integer AS unread
      FROM game_inbox
      WHERE user_id=${userId} AND (expires_at IS NULL OR expires_at > now())
    ), page AS (
      SELECT id,kind,title,body,metadata,read_at,created_at,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_date
      FROM game_inbox
      WHERE user_id=${userId} AND (expires_at IS NULL OR expires_at > now())
        AND (${filter === 'all'} OR read_at IS NULL)
        AND (${cursor === null} OR (created_at,id) < ((${cursor?.date ?? null}::text)::timestamptz,${cursor?.id ?? null}::uuid))
      ORDER BY created_at DESC,id DESC LIMIT ${limit + 1}
    )
    SELECT total,unread,
      CASE WHEN ${filter === 'all'} THEN total ELSE unread END AS matching_total,
      COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS items
    FROM counts
  `;
  const rows = result.items as (InboxItem & { cursor_date: string })[];
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(({ cursor_date: _cursorDate, ...item }) => item),
    total: Number(result.total), unread: Number(result.unread), matchingTotal: Number(result.matching_total),
    filter, limit, hasMore,
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ v: 1, date: last.cursor_date, id: last.id })).toString('base64url') : null,
  };
}

export async function getInboxCounts(tx: any, userId: string): Promise<{ total: number; unread: number }> {
  const [result] = await tx`
    SELECT count(*)::integer AS total,count(*) FILTER(WHERE read_at IS NULL)::integer AS unread
    FROM game_inbox WHERE user_id=${userId} AND (expires_at IS NULL OR expires_at > now())
  `;
  return { total: Number(result.total), unread: Number(result.unread) };
}

/** Only explicit, valid selections can be marked read; foreign and expired rows stay untouched. */
export async function readInboxSelection(tx: any, userId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Выбери сообщения для чтения');
  const body = input as Record<string, unknown>;
  // Kept for older open clients. The current interface always sends visible IDs.
  if (body.all === true && body.id === undefined && body.ids === undefined) {
    const rows = await tx`
      UPDATE game_inbox SET read_at=now()
      WHERE user_id=${userId} AND read_at IS NULL AND (expires_at IS NULL OR expires_at > now())
      RETURNING id
    `;
    return { readCount: rows.length, inboxCounts: await getInboxCounts(tx, userId) };
  }
  const ids = body.ids !== undefined ? body.ids : body.id !== undefined ? [body.id] : null;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 30 || ids.some(id => typeof id !== 'string' || !UUID.test(id))) {
    throw new Error('Выбери от 1 до 30 сообщений');
  }
  const selected = [...new Set(ids as string[])];
  const rows = await tx`
    UPDATE game_inbox SET read_at=now()
    WHERE user_id=${userId} AND id IN ${tx(selected)} AND read_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    RETURNING id
  `;
  return { readCount: rows.length, inboxCounts: await getInboxCounts(tx, userId) };
}

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
  return getInboxPage(tx, userId, { limit: 5 });
}
