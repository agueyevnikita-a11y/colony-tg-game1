import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants, createReadStream } from 'node:fs';
import { privacyConfig } from './case-store.mjs';

export const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const signature = value => crypto.createHmac('sha256',privacyConfig().secret).update('privacy-operation-v1\n'+JSON.stringify(value)).digest('hex');
export async function operationsDirectory() {
  const directory=process.env.PRIVACY_OPERATIONS_DIR || '';
  if (!path.isAbsolute(directory)) throw new Error('Private operations directory is not configured');
  const resolved=path.resolve(directory); const stat=await fs.lstat(resolved);
  if (!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(resolved)!==resolved) throw new Error('Invalid operations directory');
  return resolved;
}
export async function writeOperation(kind,content) {
  if (!/^[a-z-]+$/.test(kind)) throw new Error('Invalid operation kind');
  const directory=await operationsDirectory();
  const value={version:1,kind,id:crypto.randomUUID(),createdAt:new Date().toISOString(),content};
  const filename=path.join(directory,`${kind}-${value.id}.json`);
  const handle=await fs.open(filename,'wx',0o600);
  try {await handle.writeFile(JSON.stringify({value,signature:signature(value)})+'\n');await handle.sync();} finally {await handle.close();}
  return {filename,document:value};
}
export async function readOperation(filename,kind) {
  const directory=await operationsDirectory();
  if (!path.isAbsolute(filename)||path.dirname(path.resolve(filename))!==directory||!/^[-a-z]+-[a-f0-9-]{36}\.json$/.test(path.basename(filename))) throw new Error('Operation is outside its private directory');
  const handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try {
    const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>4_000_000) throw new Error('Invalid operation file');
    const envelope=JSON.parse(await handle.readFile('utf8'));
    if (!/^[a-f0-9]{64}$/.test(envelope.signature||'')||!crypto.timingSafeEqual(Buffer.from(envelope.signature,'hex'),Buffer.from(signature(envelope.value),'hex'))||envelope.value.kind!==kind||envelope.value.version!==1) throw new Error('Operation signature or kind mismatch');
    return envelope.value;
  } finally {await handle.close();}
}
export async function hashFile(filename) {
  const hash=crypto.createHash('sha256');let size=0;
  for await(const chunk of createReadStream(filename,{flags:constants.O_RDONLY|(constants.O_NOFOLLOW||0)})){size+=chunk.length;hash.update(chunk);}
  return {sha256:hash.digest('hex'),size};
}
