import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverShopPurchases } from '../lib/client/shop-recovery.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a recovery error propagates unchanged without refreshing or retrying', async () => {
  const failure = new Error('Synthetic recovery failure');
  let recoveries = 0, refreshes = 0, ownerChecks = 0;
  await assert.rejects(recoverShopPurchases({
    recover: async () => { recoveries++; throw failure; },
    refresh: async () => { refreshes++; },
    isCurrentOwner: () => { ownerChecks++; return true; },
  }), error => error === failure);
  assert.deepEqual({ recoveries, refreshes, ownerChecks }, { recoveries: 1, refreshes: 0, ownerChecks: 0 });
});

test('successful recovery and refresh expose only receipt fields with confirmed view status', async () => {
  const source = Object.freeze({ ok: true, recovered: 2, scanned: 100, message: 'Raw provider text', invoice: 'private', stateUpdated: false });
  const calls = [];
  const receipt = await recoverShopPurchases({
    recover: async () => { calls.push('recover'); return source; },
    refresh: async () => { calls.push('refresh'); return { state: 'fresh' }; },
    isCurrentOwner: () => true,
  });
  assert.deepEqual(calls, ['recover', 'refresh']);
  assert.deepEqual(receipt, { ok: true, recovered: 2, scanned: 100, stateUpdated: true });
  assert.equal(Object.hasOwn(receipt, 'message'), false);
  assert.equal(Object.hasOwn(receipt, 'invoice'), false);
  assert.equal(source.stateUpdated, false, 'The original API response remains unchanged');
});

test('a refresh failure preserves the successful recovery receipt without retrying recovery', async () => {
  let recoveries = 0, refreshes = 0;
  const receipt = await recoverShopPurchases({
    recover: async () => { recoveries++; return { ok: true, recovered: 3, scanned: 200 }; },
    refresh: async () => { refreshes++; throw new Error('Synthetic session refresh failure'); },
    isCurrentOwner: () => true,
  });
  assert.deepEqual(receipt, { ok: true, recovered: 3, scanned: 200, stateUpdated: false });
  assert.deepEqual({ recoveries, refreshes }, { recoveries: 1, refreshes: 1 });
});

test('changing owner while recovery is pending prevents the follow-up refresh', async () => {
  const recovery = deferred();
  let owner = 'first', refreshes = 0;
  const pending = recoverShopPurchases({
    recover: () => recovery.promise,
    refresh: async () => { refreshes++; },
    isCurrentOwner: () => owner === 'first',
  });
  owner = 'second';
  recovery.resolve({ recovered: 1, scanned: 10 });
  assert.deepEqual(await pending, { recovered: 1, scanned: 10, stateUpdated: false });
  assert.equal(refreshes, 0);
});

test('changing owner while the session refresh is pending never confirms the new owner view', async () => {
  const refreshStarted = deferred(), refreshed = deferred();
  let sameOwner = true, recoveries = 0, refreshes = 0;
  const pending = recoverShopPurchases({
    recover: async () => { recoveries++; return { recovered: 2, scanned: 20 }; },
    refresh: () => { refreshes++; refreshStarted.resolve(); return refreshed.promise; },
    isCurrentOwner: () => sameOwner,
  });
  await refreshStarted.promise;
  sameOwner = false;
  refreshed.resolve({ state: 'response for old owner' });
  assert.deepEqual(await pending, { recovered: 2, scanned: 20, stateUpdated: false });
  assert.deepEqual({ recoveries, refreshes }, { recoveries: 1, refreshes: 1 });
});

test('unknown recovery responses do not invent a zero count or copy messages', async () => {
  const array = Object.assign([], { recovered: 2, scanned: 10, ok: true });
  for (const response of [undefined, null, false, true, 0, 2, 'paid', [], array]) {
    let refreshes = 0;
    const receipt = await recoverShopPurchases({
      recover: async () => response,
      refresh: async () => { refreshes++; },
      isCurrentOwner: () => true,
    });
    assert.deepEqual(receipt, { stateUpdated: true });
    assert.equal(Object.hasOwn(receipt, 'recovered'), false);
    assert.equal(refreshes, 1);
  }
});

test('only own receipt keys are selected and strict value validation remains with the formatter', async () => {
  const response = Object.assign(Object.create({ ok: true, scanned: 99, message: 'inherited' }), { recovered: '2', stateUpdated: true, extra: 'not a receipt field' });
  const receipt = await recoverShopPurchases({ recover: async () => response, refresh: async () => {}, isCurrentOwner: () => true });
  assert.deepEqual(receipt, { recovered: '2', stateUpdated: true });
  assert.equal(Object.hasOwn(receipt, 'ok'), false);
  assert.equal(Object.hasOwn(receipt, 'scanned'), false);
});

test('zero confirmed recoveries remain distinct from an unknown response after a failed refresh', async () => {
  for (const response of [{ recovered: 0, scanned: 0, ok: true }, undefined]) {
    const receipt = await recoverShopPurchases({
      recover: async () => response,
      refresh: async () => { throw new Error('Synthetic refresh failure'); },
      isCurrentOwner: () => true,
    });
    assert.equal(receipt.stateUpdated, false);
    assert.equal(Object.hasOwn(receipt, 'recovered'), response !== undefined);
    if (response) assert.equal(receipt.recovered, 0);
  }
});
