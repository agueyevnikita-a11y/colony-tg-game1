import { sql } from '@/lib/server/db';

export class RateLimitError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`Слишком много запросов. Повтори через ${Math.max(1, retryAfterSec)} сек.`);
    this.name = 'RateLimitError';
    this.retryAfterSec = Math.max(1, retryAfterSec);
  }
}

export async function assertRateLimitTx(tx:any,bucketKey: string, limit: number, windowSec: number) {
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindow = Math.max(1, Math.floor(windowSec));
  const rows = await tx<any[]>`
      INSERT INTO api_rate_limits(bucket_key,window_started_at,request_count)
      VALUES(${bucketKey},now(),1)
      ON CONFLICT(bucket_key) DO UPDATE SET
        window_started_at = CASE
          WHEN api_rate_limits.window_started_at <= now() - make_interval(secs => ${safeWindow}) THEN now()
          ELSE api_rate_limits.window_started_at
        END,
        request_count = CASE
          WHEN api_rate_limits.window_started_at <= now() - make_interval(secs => ${safeWindow}) THEN 1
          ELSE api_rate_limits.request_count + 1
        END,
        updated_at=now()
      RETURNING request_count,window_started_at,extract(epoch from (window_started_at + make_interval(secs => ${safeWindow}) - now()))::int AS retry_after
  `;
  const row = rows[0];
  if (Number(row?.request_count ?? 0) > safeLimit) throw new RateLimitError(Number(row?.retry_after ?? safeWindow));
  return { remaining: Math.max(0, safeLimit - Number(row?.request_count ?? 0)) };
}

export async function assertRateLimit(bucketKey: string, limit: number, windowSec: number) {
  return sql.begin(async tx=>assertRateLimitTx(tx,bucketKey,limit,windowSec));
}

export async function cleanupRateLimits() {
  await sql`DELETE FROM api_rate_limits WHERE updated_at < now()-interval '1 day'`;
}
