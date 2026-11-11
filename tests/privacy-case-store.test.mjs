import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {accountKey,initPrivacyStore,assertPrivacyStoreReady,readAccountCase,saveAccountCase,newAccountCase,isClosedCase,listAccountCases} from '../scripts/privacy/lib/case-store.mjs';

async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'colony-case-test-'));
  const before={secret:process.env.ACCOUNT_ERASURE_SECRET,directory:process.env.ACCOUNT_CLOSURE_DIR};
  process.env.ACCOUNT_ERASURE_SECRET=crypto.randomBytes(32).toString('hex');process.env.ACCOUNT_CLOSURE_DIR=directory;
  t.after(async()=>{
    if(before.secret===undefined)delete process.env.ACCOUNT_ERASURE_SECRET;else process.env.ACCOUNT_ERASURE_SECRET=before.secret;
    if(before.directory===undefined)delete process.env.ACCOUNT_CLOSURE_DIR;else process.env.ACCOUNT_CLOSURE_DIR=before.directory;
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('colony-case-test-'));
    await fs.rm(directory,{recursive:true,force:true});
  });
  await initPrivacyStore();const key=accountKey(712345678901);const userId=crypto.randomUUID();
  return {directory,key,userId,file:path.join(directory,key+'.json'),record:()=>newAccountCase(key,userId)};
}

test('privacy store requires explicit initialization and refuses silent key rotation',async t=>{
  const f=await fixture(t);await assert.rejects(initPrivacyStore());
  process.env.ACCOUNT_ERASURE_SECRET=crypto.randomBytes(32).toString('hex');await assert.rejects(assertPrivacyStoreReady());
  assert.deepEqual((await fs.readdir(f.directory)).sort(),['meta.json']);
});
test('closure journal is signed and reading a case does not write or store raw identity',async t=>{
  const f=await fixture(t);const saved=await saveAccountCase(f.record(),'self_closure_requested',{instruction:'close_account_and_request_erasure'});
  const bytes=await fs.readFile(f.file,'utf8');assert.equal(bytes.includes('712345678901'),false);assert.equal(bytes.includes(process.env.ACCOUNT_ERASURE_SECRET),false);
  assert.equal(isClosedCase(await readAccountCase(f.key)),true);assert.equal((await listAccountCases())[0].id,saved.id);
  assert.equal(await fs.readFile(f.file,'utf8'),bytes);
});
test('a missing case recovers the acknowledged closed state from its journal',async t=>{
  const f=await fixture(t);await saveAccountCase(f.record(),'self_closure_requested');
  await fs.rename(f.file,f.file+'.held');assert.equal(isClosedCase(await readAccountCase(f.key)),true);assert.equal((await listAccountCases()).length,1);
});
test('missing and stale case files recover exact erasure and completion timestamps from signed journal events',async t=>{
  const f=await fixture(t);
  const executionStartedAt='2026-11-10T12:00:00.000Z';
  const activeDataErasedAt='2026-11-10T12:00:01.234Z';
  const completedAt='2026-11-11T13:04:05.678Z';
  const started=await saveAccountCase({...f.record(),executionStartedAt},'active_erasure_started');
  const stale=await fs.readFile(f.file);
  const erased=await saveAccountCase({...started,status:'copies_pending',activeDataErasedAt},'active_data_erased');
  await fs.rename(f.file,f.file+'.held');
  let recovered=await readAccountCase(f.key);
  assert.equal(recovered.status,'copies_pending');
  assert.equal(recovered.executionStartedAt,executionStartedAt);
  assert.equal(recovered.activeDataErasedAt,activeDataErasedAt);
  assert.equal(recovered.completedAt,undefined);
  await fs.writeFile(f.file,stale);
  recovered=await readAccountCase(f.key);
  assert.equal(recovered.activeDataErasedAt,activeDataErasedAt);
  const completed=await saveAccountCase({...erased,status:'completed',completedAt},'operator_completion_attested');
  await fs.writeFile(f.file,stale);
  recovered=await readAccountCase(f.key);
  assert.equal(recovered.status,'completed');
  assert.equal(recovered.revision,completed.revision);
  assert.equal(recovered.executionStartedAt,executionStartedAt);
  assert.equal(recovered.activeDataErasedAt,activeDataErasedAt);
  assert.equal(recovered.completedAt,completedAt);
  await fs.unlink(f.file);
  recovered=await readAccountCase(f.key);
  assert.equal(recovered.activeDataErasedAt,activeDataErasedAt);
  assert.equal(recovered.completedAt,completedAt);
  const latest=JSON.parse((await fs.readFile(path.join(f.directory,'events.jsonl'),'utf8')).trim().split('\n').at(-1)).value;
  assert.equal(latest.activeDataErasedAt,activeDataErasedAt);
  assert.equal(latest.completedAt,completedAt);
});
test('an older matching meta/case pair cannot overrule the newer closure journal',async t=>{
  const f=await fixture(t);let record=await saveAccountCase({...f.record(),status:'cancelled'},'self_closure_cancelled');
  const meta=await fs.readFile(path.join(f.directory,'meta.json'));const oldCase=await fs.readFile(f.file);
  await saveAccountCase({...record,status:'requested'},'self_closure_requested');
  await fs.writeFile(path.join(f.directory,'meta.json'),meta);await fs.writeFile(f.file,oldCase);
  await assert.rejects(readAccountCase(f.key));
});
test('damaged case and journal signatures fail closed',async t=>{
  const f=await fixture(t);await saveAccountCase(f.record(),'self_closure_requested');
  const bytes=await fs.readFile(f.file);await fs.writeFile(f.file,'{}');await assert.rejects(readAccountCase(f.key));await fs.writeFile(f.file,bytes);
  await fs.writeFile(path.join(f.directory,'events.jsonl'),'{}\n');await assert.rejects(readAccountCase(f.key));
});
test('a failed case-file replacement keeps the durable request closed',async t=>{
  const f=await fixture(t);const rename=fs.rename;
  fs.rename=async(from,to)=>{if(to===f.file)throw new Error('synthetic failure');return rename(from,to);};
  try {await assert.rejects(saveAccountCase(f.record(),'self_closure_requested'));}finally{fs.rename=rename;}
  assert.equal(isClosedCase(await readAccountCase(f.key)),true);assert.equal((await fs.readdir(f.directory)).includes('write.lock'),false);
});
test('a fresh request after cancellation has a new ID and monotonic ledger revision',async t=>{
  const f=await fixture(t);const first=await saveAccountCase(f.record(),'self_closure_requested');
  const cancelled=await saveAccountCase({...first,status:'cancelled'},'self_closure_cancelled');assert.equal(isClosedCase(await readAccountCase(f.key)),false);
  const next=await saveAccountCase(f.record(),'self_closure_requested');assert.notEqual(next.id,first.id);assert.ok(next.revision>cancelled.revision);assert.equal(isClosedCase(await readAccountCase(f.key)),true);
});
