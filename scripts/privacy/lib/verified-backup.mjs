import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import postgres from 'postgres';
import { hashFile } from './operator-files.mjs';
import { accountKey } from './case-store.mjs';

const identifier=value=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(value))throw new Error('Invalid database identifier');return '"'+value+'"';};
function clientEnv(url) {
  const parsed=new URL(url);
  return {...process.env,PGHOST:parsed.hostname,PGPORT:parsed.port||'5432',PGUSER:decodeURIComponent(parsed.username),PGPASSWORD:decodeURIComponent(parsed.password),PGDATABASE:parsed.pathname.slice(1)};
}
async function command(binary,args,url,output) {
  await new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{env:clientEnv(url),windowsHide:true,stdio:['ignore',output??'ignore','pipe']});
    // Raw PostgreSQL diagnostics may contain data. Retain only the exit status.
    child.stderr.resume();child.on('error',()=>reject(new Error(`${binary} could not start`)));
    child.on('exit',code=>code===0?resolve():reject(new Error(`${binary} failed; exit status ${code}`)));
  });
}
export async function databaseFingerprints(sql) {
  const tables=await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`;
  const result={};
  for(const {table_name:name}of tables){
    const hash=crypto.createHash('sha256');let count=0;
    for await(const batch of sql.unsafe(`SELECT to_jsonb(t)::text AS row FROM public.${identifier(name)} t ORDER BY to_jsonb(t)::text`).cursor(100)){
      for(const row of batch){hash.update(row.row+'\n');count++;}
    }
    result[name]={count,sha256:hash.digest('hex')};
  }
  return result;
}
export async function assertNoErasedIdentities(sql,erasedCases) {
  const keys=new Set(erasedCases.map(record=>record.accountKey));const ids=new Set(erasedCases.map(record=>record.userId));
  for(const user of await sql`SELECT id,telegram_id FROM users`) {
    if(ids.has(user.id)||keys.has(accountKey(Number(user.telegram_id))))throw new Error('An erased account has returned to the database; sanitize it before backup');
  }
  if(!ids.size)return;
  const tables=await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`;
  for(const {table_name:name}of tables)for(const id of [...ids,...keys]){
    const [row]=await sql.unsafe(`SELECT EXISTS(SELECT 1 FROM public.${identifier(name)} t WHERE to_jsonb(t)::text ILIKE $1) AS found`,[`%${id}%`]);
    if(row.found)throw new Error('Residual erased-account references require manual review before backup');
  }
}
export async function createVerifiedBackup({sql,databaseUrl,backupRoot,erasedCases}) {
  const stat=await fs.lstat(backupRoot);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(backupRoot)!==path.resolve(backupRoot))throw new Error('Invalid backup root');
  const basename=`colony-privacy-${new Date().toISOString().replace(/[-:.]/g,'')}-${crypto.randomBytes(5).toString('hex')}.dump`;
  const filename=path.join(backupRoot,basename);const partial=filename+'.partial';
  const handle=await fs.open(partial,'wx',0o600);let source;
  try {
    await sql.begin('isolation level repeatable read read only',async tx=>{
      const [{snapshot}]=await tx`SELECT pg_export_snapshot() AS snapshot`;
      await assertNoErasedIdentities(tx,erasedCases);
      source=await databaseFingerprints(tx);
      await command('pg_dump',['--format=custom','--no-owner','--no-acl',`--snapshot=${snapshot}`],databaseUrl,handle.fd);
    });
    await handle.sync();
  } finally {await handle.close();}
  const restoredName=`colony_privacy_check_${crypto.randomBytes(8).toString('hex')}`;
  const restoredUrl=new URL(databaseUrl);restoredUrl.pathname='/'+restoredName;
  const admin=postgres(databaseUrl,{max:1,onnotice(){}});let restored;let created=false;
  try {
    await admin.unsafe(`CREATE DATABASE ${identifier(restoredName)} TEMPLATE template0`);created=true;
    await command('pg_restore',['--dbname',restoredName,'--no-owner','--no-acl','--exit-on-error','--single-transaction',partial],restoredUrl.toString());
    restored=postgres(restoredUrl.toString(),{max:1,onnotice(){}});
    const restoredFingerprints=await restored.begin('isolation level repeatable read read only',databaseFingerprints);
    if(JSON.stringify(source)!==JSON.stringify(restoredFingerprints))throw new Error('Restored backup differs from the exported snapshot');
  } finally {
    if(restored)await restored.end({timeout:3});
    // Only this fresh, randomly named scratch database is ever dropped here.
    if(created)await admin.unsafe(`DROP DATABASE ${identifier(restoredName)}`);
    await admin.end({timeout:3});
  }
  await fs.rename(partial,filename);
  const metadata=await hashFile(filename);
  await fs.writeFile(filename+'.sha256',`${metadata.sha256}  ${basename}\n`,{flag:'wx',mode:0o600});
  return {path:filename,...metadata,restoreVerified:true,erasedRequestIds:erasedCases.map(record=>record.id).sort(),verifiedAt:new Date().toISOString(),tables:source};
}
