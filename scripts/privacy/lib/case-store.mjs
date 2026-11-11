import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export const PRIVACY_CAPABILITY = 1;
export const CASE_STATUSES = new Set(['requested','cancelled','active_data_erased','copies_pending','completed']);
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function privacyConfig() {
  const secret = process.env.ACCOUNT_ERASURE_SECRET || '';
  const directory = process.env.ACCOUNT_CLOSURE_DIR || '';
  if (!HEX.test(secret) || !path.isAbsolute(directory)) throw new Error('Privacy storage is not configured');
  return { secret, directory: path.resolve(directory) };
}

export function accountKey(telegramId) {
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) throw new Error('Invalid account identity');
  return crypto.createHmac('sha256', privacyConfig().secret).update(`colony-account-v1:${telegramId}`).digest('hex');
}

const signed = value => {
  const { secret } = privacyConfig();
  return { value, signature: crypto.createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex') };
};

async function readSigned(filename) {
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2_000_000) throw new Error('Invalid privacy record');
    const envelope = JSON.parse(await handle.readFile('utf8'));
    const expected = signed(envelope.value).signature;
    if (!HEX.test(envelope.signature || '') || !crypto.timingSafeEqual(Buffer.from(envelope.signature,'hex'), Buffer.from(expected,'hex'))) throw new Error('Invalid privacy record signature');
    return envelope.value;
  } finally { await handle.close(); }
}

async function atomicSigned(filename, value) {
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(signed(value))+'\n'); await handle.sync(); }
  finally { await handle.close(); }
  try {
    await fs.rename(temporary, filename);
    if (process.platform !== 'win32' && process.getuid?.() === 0 && /^\d+$/.test(process.env.PRIVACY_RECORD_UID || '')) {
      const uid=Number(process.env.PRIVACY_RECORD_UID); await fs.chown(filename,uid,uid);
    }
    if (process.platform !== 'win32') {
      const dir = await fs.open(path.dirname(filename), 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    }
  } catch (error) { await fs.unlink(temporary).catch(()=>{}); throw error; }
}

export async function initPrivacyStore() {
  const { directory, secret } = privacyConfig();
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid privacy directory');
  const names = await fs.readdir(directory);
  if (names.length) throw new Error('Privacy initialization requires an empty directory');
  await atomicSigned(path.join(directory,'meta.json'), { version:1, installationId:crypto.randomUUID(), createdAt:new Date().toISOString(), entries:{}, keyId:crypto.createHash('sha256').update(secret).digest('hex') });
}

export async function assertPrivacyStoreReady() {
  const { directory, secret } = privacyConfig();
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid privacy directory');
  const meta = await readSigned(path.join(directory,'meta.json'));
  if (meta.version !== 1 || !meta.entries || typeof meta.entries!=='object' || meta.keyId !== crypto.createHash('sha256').update(secret).digest('hex')) throw new Error('Privacy key mismatch');
  if(Object.entries(meta.entries).some(([key,value])=>!HEX.test(key)||!Number.isInteger(value)||value<2))throw new Error('Invalid privacy index');
  return meta;
}

function validCase(record) {
  if (!record || record.version !== 1 || !HEX.test(record.accountKey || '') || !UUID.test(record.userId || '')
    || !UUID.test(record.id || '') || !CASE_STATUSES.has(record.status) || !Array.isArray(record.events)
    || !Number.isInteger(record.revision) || record.revision < 1) throw new Error('Invalid closure case');
  return record;
}

export async function readAccountCase(key) {
  if (!HEX.test(key)) throw new Error('Invalid account key');
  const meta=await assertPrivacyStoreReady();
  const filename = path.join(privacyConfig().directory, `${key}.json`);
  let record;
  try { record = await readSigned(filename); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const expected=meta.entries[key];
  const events=await journalEvents(key);
  const latest=events.at(-1);
  if (!record || record.revision!==expected || !latest || latest.caseRevision!==expected) {
    if (!expected && !record && !latest) return null;
    if (!latest || latest.caseRevision!==expected) throw new Error('Privacy case or journal is incomplete');
    record={version:1,revision:latest.caseRevision,id:latest.requestId,accountKey:key,userId:latest.userId,status:latest.status,requestedAt:latest.requestedAt,updatedAt:latest.at,events,executionStartedAt:latest.executionStartedAt,activeDataErasedAt:latest.activeDataErasedAt,completedAt:latest.completedAt};
  }
  if (record.accountKey !== key) throw new Error('Privacy record identity mismatch');
  return validCase(record);
}

export async function listAccountCases() {
  const meta=await assertPrivacyStoreReady();
  const result = [];
  for (const key of Object.keys(meta.entries)) result.push(await readAccountCase(key));
  return result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveAccountCase(record, action, details = {}) {
  validCase(record);
  const { directory } = privacyConfig();
  const lockPath=path.join(directory,'write.lock');let lock;
  try { lock=await fs.open(lockPath,'wx',0o600); } catch { throw new Error('Privacy writer is busy; operator must review an abandoned lock'); }
  try {
  const meta=await assertPrivacyStoreReady();
  const revision=Math.max(record.revision,Number(meta.entries[record.accountKey]||0))+1;
  const event = { id:crypto.randomUUID(), at:new Date().toISOString(), requestId:record.id, userId:record.userId, accountKey:record.accountKey, status:record.status, caseRevision:revision, requestedAt:record.requestedAt, executionStartedAt:record.executionStartedAt, activeDataErasedAt:record.activeDataErasedAt, completedAt:record.completedAt, action, details };
  const updated = { ...record, revision, updatedAt:event.at, events:[...record.events,event] };
  // A missing case cannot be mistaken for an account that never requested closure.
  await atomicSigned(path.join(directory,'meta.json'),{...meta,entries:{...meta.entries,[record.accountKey]:revision}});
  // Append the system event before acknowledging the matching durable case.
  const log = await fs.open(path.join(directory,'events.jsonl'), constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW || 0), 0o600);
  try { await log.write(JSON.stringify(signed(event))+'\n'); await log.sync(); }
  finally { await log.close(); }
  await atomicSigned(path.join(directory, `${record.accountKey}.json`), updated);
  return updated;
  } finally { await lock.close(); await fs.unlink(lockPath); }
}

async function journalEvents(key) {
  const filename=path.join(privacyConfig().directory,'events.jsonl');let handle;
  try {handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));} catch(error) {if(error.code==='ENOENT')return [];throw error;}
  try {
    const stat=await handle.stat();if(!stat.isFile()||stat.size>50_000_000)throw new Error('Privacy journal needs operator review');
    const source=await handle.readFile('utf8');const result=[];
    for(const line of source.split('\n')){
      if(!line)continue;const envelope=JSON.parse(line);const expected=signed(envelope.value).signature;
      if(!HEX.test(envelope.signature||'')||!crypto.timingSafeEqual(Buffer.from(envelope.signature,'hex'),Buffer.from(expected,'hex')))throw new Error('Invalid privacy journal signature');
      if(envelope.value.accountKey===key)result.push(envelope.value);
    }
    return result;
  } finally {await handle.close();}
}

export function newAccountCase(key, userId) {
  const now = new Date().toISOString();
  return { version:1, revision:1, id:crypto.randomUUID(), accountKey:key, userId, status:'requested', requestedAt:now, updatedAt:now, events:[] };
}

export function publicCase(record) {
  if (!record) return null;
  return { id:record.id, status:record.status, requestedAt:record.requestedAt, updatedAt:record.updatedAt };
}

export const isClosedCase = record => !!record && record.status !== 'cancelled';
