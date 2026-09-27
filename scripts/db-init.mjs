import './env.mjs';
import fs from 'node:fs/promises';
import postgres from 'postgres';

const url=process.env.DATABASE_URL;
if(!url) throw new Error('DATABASE_URL is missing');
const sql=postgres(url,{max:1});
try{
  const schema=await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
  await sql.begin(async (transaction) => {
    await transaction.unsafe(schema).simple();
  });
  console.log('COLONY database schema applied successfully.');
}finally{await sql.end();}
