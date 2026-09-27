import './env.mjs';
import fs from 'node:fs/promises';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
let sql;
try{
  if (!url) throw new Error('DATABASE_URL is missing');
  sql = postgres(url, { max: 1, connect_timeout: 10, connection: { statement_timeout: 60000, lock_timeout: 10000 } });
  const schema=await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
  await sql.begin(async (transaction) => {
    await transaction.unsafe(schema).simple();
  });
  console.log('COLONY database schema applied successfully.');
} catch {
  // PostgreSQL errors may include connection strings or other sensitive values.
  console.error('Database initialization failed. Check DATABASE_URL, database availability, schema permissions and locks.');
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 2 }).catch(() => {
    console.error('Database connection cleanup failed.');
    process.exitCode = 1;
  });
}
