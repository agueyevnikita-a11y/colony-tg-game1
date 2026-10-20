import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteExpeditionSettlement } from '../lib/game/expedition-quote.ts';

const quote = (base = {}, extra = {}, cost = {}, resources = {}, capacities = { ore: 2000, energy: 1200, parts: 800 }) => quoteExpeditionSettlement(base, extra, cost, resources, capacities);

test('settlement combines every actual reward without rounding or clipping', () => {
  const result = quote({ ore: 120, parts: 15, credits: 400, science: 25, crystals: 2 }, { parts: 5, credits: 500, science: 75 }, {}, { ore: 500, parts: 100 });
  assert.deepEqual(result.reward, { ore: 120, parts: 20, credits: 900, science: 100, crystals: 2 });
  assert.equal(result.canClaim, true);
});

test('full incoming cargo requires storage and remains intact in the quote', () => {
  const result = quote({ ore: 120, parts: 30 }, {}, {}, { ore: 1990, parts: 790 });
  assert.equal(result.canClaim, false);
  assert.deepEqual(result.storageShortages, { ore: 110, parts: 20 });
  assert.equal(result.reward.ore, 120);
  assert.equal(result.reward.parts, 30);
});

test('choice cost frees storage before rewards arrive but must be payable beforehand', () => {
  assert.equal(quote({ parts: 30 }, {}, { parts: 30 }, { parts: 800 }).canClaim, true);
  const unpaid = quote({ parts: 30, credits: 500 }, {}, { parts: 30, credits: 100 }, { parts: 29, credits: 99 });
  assert.deepEqual(unpaid.shortages, { parts: 1, credits: 1 });
  assert.equal(unpaid.canClaim, false);
});

test('existing excess stock does not block rewards that add none of the stored resource', () => {
  assert.equal(quote({ science: 20, credits: 300 }, {}, {}, { ore: 5000, parts: 2000 }).canClaim, true);
  assert.equal(quote({ ore: 100 }, {}, {}, { ore: '1800' }, { ore: 1900 }).canClaim, true);
  assert.deepEqual(quote({ ore: 101 }, {}, {}, { ore: '1800' }, { ore: 1900 }).storageShortages, { ore: 1 });
});

test('unknown or invalid amounts cannot produce a claimable corrupted exchange', () => {
  for (const value of [Infinity, NaN, -1, {}, 'bad']) {
    assert.equal(quote({ ore: value }).canClaim, false);
    assert.equal(quote({}, {}, { energy: value }).canClaim, false);
  }
  assert.deepEqual(quote({ credits: '100', science: '20' }).reward, { ore: 0, parts: 0, credits: 100, science: 20, crystals: 0 });
});
