import assert from 'node:assert/strict';
import test from 'node:test';
import { contractCompletionReceipt } from '../lib/game/contract-receipt.ts';

const receipt = { contractId:'contract-a', resource:'ore', amount:320, credits:950 };

test('contract feedback uses the exact server receipt rather than the displayed estimate', () => {
  assert.deepEqual(contractCompletionReceipt({ok:true,result:receipt}, 'contract-a'), receipt);
  assert.deepEqual(contractCompletionReceipt({ok:true,result:{...receipt,resource:'parts',amount:40,credits:1080}}, 'contract-a'),
    {...receipt,resource:'parts',amount:40,credits:1080});
});

test('missing, foreign or malformed receipts cannot hide a contract as successfully completed', () => {
  for (const value of [undefined,null,[],{},receipt,{ok:false,result:receipt},{ok:true,result:[]},
    {ok:true,result:{...receipt,contractId:'contract-b'}},{ok:true,result:{...receipt,resource:'crystals'}},
    ...[0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1,'320'].map(amount=>({ok:true,result:{...receipt,amount}})),
    ...[-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1,'950'].map(credits=>({ok:true,result:{...receipt,credits}}))]) {
    assert.equal(contractCompletionReceipt(value,'contract-a'), null);
  }
  assert.equal(contractCompletionReceipt({ok:true,result:receipt},''),null);
  assert.deepEqual(contractCompletionReceipt({ok:true,result:{...receipt,credits:0}},'contract-a'),{...receipt,credits:0});
});
