import assert from 'node:assert/strict';
import test from 'node:test';
import { competitionClaimReceipt } from '../lib/game/competition-claim.ts';

const periodId = 'cw-2030-01-07';
const valid = { periodId, count: 2, crystals: 325, cosmeticIds: ['title_coop_vanguard', 'frame_coop_team'] };

test('a complete league receipt retains actual rewards without using an estimate', () => {
  const source = Object.freeze({ ...valid, cosmeticIds: Object.freeze([...valid.cosmeticIds]), estimatedCrystals: 999 });
  const receipt = competitionClaimReceipt(source, periodId);
  assert.deepEqual(receipt, valid);
  assert.notEqual(receipt.cosmeticIds, source.cosmeticIds);
  assert.equal(Object.hasOwn(receipt, 'estimatedCrystals'), false);
});

test('zero league receipts cannot establish any new cosmetic or crystal grant', () => {
  assert.deepEqual(competitionClaimReceipt({ periodId, count: 0, crystals: 0, cosmeticIds: [] }, periodId), { periodId, count: 0, crystals: 0, cosmeticIds: [] });
  for (const receipt of [{ periodId, count: 0, crystals: 1, cosmeticIds: [] }, { periodId, count: 0, crystals: 0, cosmeticIds: ['title_coop_vanguard'] }]) assert.equal(competitionClaimReceipt(receipt, periodId), null);
});

test('incomplete, inherited, foreign-week and malformed league receipts remain unknown', () => {
  const cases = [null, undefined, [], false, 2, 'received', {}, { periodId, count: 1 },
    Object.create(valid), { ...valid, periodId: 'cw-2030-01-14' },
    ...[-1, 1.5, 3, Infinity, NaN, '1', null, undefined].map(count => ({ ...valid, count })),
    ...[-1, 1.5, Infinity, NaN, '325', null, undefined].map(crystals => ({ ...valid, crystals })),
    ...[null, 'title_coop_vanguard', [null], [1], [''], ['bad id'], ['same', 'same']].map(cosmeticIds => ({ ...valid, cosmeticIds })),
  ];
  for (const value of cases) assert.equal(competitionClaimReceipt(value, periodId), null);
});

test('one newly claimed prize may be crystal-only or include a future canonical cosmetic ID', () => {
  for (const cosmeticIds of [[], ['title_future_lunar_award']]) {
    const receipt = { periodId, count: 1, crystals: 20, cosmeticIds };
    assert.deepEqual(competitionClaimReceipt(receipt, periodId), receipt);
  }
});
