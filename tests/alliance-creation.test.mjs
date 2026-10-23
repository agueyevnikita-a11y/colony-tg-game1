import assert from 'node:assert/strict';
import test from 'node:test';
import { ALLIANCE_CREATE_COST, ALLIANCE_CREATE_CURRENCY, allianceCreationQuote } from '../lib/game/alliance.ts';

test('alliance creation quotes keep legacy credit prices explicit and never invent an unavailable price', () => {
  assert.deepEqual(allianceCreationQuote({ createCost: ALLIANCE_CREATE_COST, createCurrency: ALLIANCE_CREATE_CURRENCY }), { cost: 100, currency: 'crystals' });
  assert.deepEqual(allianceCreationQuote({ createCost: 5000 }), { cost: 5000, currency: 'credits' });
  assert.deepEqual(allianceCreationQuote({ createCost: 7000, createCurrency: 'credits' }), { cost: 7000, currency: 'credits' });
  for (const rules of [undefined, {}, { createCost: '100' }, { createCost: 0 }, { createCost: -1 }, { createCost: .5 },
    { createCost: NaN }, { createCost: Infinity }, { createCost: Number.MAX_SAFE_INTEGER + 1 },
    { createCost: 100, createCurrency: 'stars' }, { createCost: 100, createCurrency: false }, { createCost: 100, createCurrency: null }]) {
    assert.equal(allianceCreationQuote(rules), null);
  }
});
