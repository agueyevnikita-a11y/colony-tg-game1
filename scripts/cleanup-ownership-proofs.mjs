import './env.mjs';
import postgres from 'postgres';

let sql;
try {
  if (!process.env.DATABASE_URL) throw new Error('Missing database');
  sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });
  // Only the new verification records; never game accounts, requests or backups.
  const deleted = await sql`DELETE FROM account_ownership_proofs WHERE issued_at < now()-interval '6 days' RETURNING id`;
  await sql`DELETE FROM api_rate_limits WHERE bucket_key LIKE 'support-proof:%' AND updated_at < now()-interval '1 day'`;
  console.log(`Expired ownership verification records removed: ${deleted.length}`);
} catch {
  console.error('Ownership verification cleanup failed; no credentials or request details are logged.');
  process.exitCode = 1;
} finally { if (sql) await sql.end({ timeout: 2 }); }
