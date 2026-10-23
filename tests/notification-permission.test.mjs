import assert from 'node:assert/strict';
import test from 'node:test';
import { requestTelegramWriteAccess } from '../lib/client/telegram.ts';

const app = requestWriteAccess => ({ initData:'signed-fixture', version:'6.9', ready(){}, expand(){}, requestWriteAccess });

test('notification access rejects missing or old Telegram before opening a permission request', async () => {
  let calls=0;
  for(const value of [undefined,app(undefined),{...app(()=>calls++),initData:''},{...app(()=>calls++),version:'6.8'}]) {
    await assert.rejects(requestTelegramWriteAccess(value), /актуального Telegram/);
  }
  assert.equal(calls,0);
});

test('notification permission accepts only an explicit positive callback and ignores later callbacks', async () => {
  let callback;
  const result=requestTelegramWriteAccess(app(cb=>{callback=cb;}));
  callback(false); callback(true);
  assert.equal(await result,false);
  assert.equal(await requestTelegramWriteAccess(app(cb=>cb(true))),true);
  assert.equal(await requestTelegramWriteAccess(app(cb=>cb('true'))),false);
});

test('notification timeout cannot be revived by a late grant or interfere with a new request', async () => {
  let oldCallback,newCallback;
  await assert.rejects(requestTelegramWriteAccess(app(cb=>{oldCallback=cb;}),undefined,5), /пока не ответил/);
  const current=requestTelegramWriteAccess(app(cb=>{newCallback=cb;}));
  oldCallback(true); newCallback(false);
  assert.equal(await current,false);
});

test('unmount cancellation ignores a later Telegram grant and a pre-cancelled request never opens', async () => {
  const controller=new AbortController();let callback,calls=0;
  const pending=requestTelegramWriteAccess(app(cb=>{calls++;callback=cb;}),controller.signal);
  const rejected=assert.rejects(pending,/отменён/);
  controller.abort();callback(true);await rejected;
  await assert.rejects(requestTelegramWriteAccess(app(()=>calls++),controller.signal),/отменён/);
  assert.equal(calls,1);
});

test('synchronous Telegram failures release the permission attempt for an explicit retry', async () => {
  await assert.rejects(requestTelegramWriteAccess(app(()=>{throw new Error('SDK failure');})),/Не удалось запросить/);
  assert.equal(await requestTelegramWriteAccess(app(cb=>cb(true))),true);
});
