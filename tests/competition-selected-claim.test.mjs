import assert from 'node:assert/strict';
import test from 'node:test';
import { competitionClaimForAwards } from '../lib/game/competition-claim.ts';

const periodId = 'cw-2030-01-07';
const personal = { kind: 'personal', crystals: 100, cosmeticIds: ['badge_coop_champion', 'title_coop_vanguard'] };
const alliance = { kind: 'alliance', crystals: 225, cosmeticIds: ['frame_coop_team'] };
const receipt = { periodId, count: 2, crystals: 325, cosmeticIds: ['frame_coop_team', 'title_coop_vanguard', 'badge_coop_champion'] };

test('a complete league receipt must match actual selected amounts and cosmetic union', () => {
  const snapshots = Object.freeze([Object.freeze({ ...personal, cosmeticIds: Object.freeze([...personal.cosmeticIds]) }), Object.freeze({ ...alliance, cosmeticIds: Object.freeze([...alliance.cosmeticIds]) })]);
  const result = competitionClaimForAwards(Object.freeze(receipt), periodId, snapshots);
  assert.deepEqual(result, { ...receipt, paidKinds: ['personal', 'alliance'], complete: true });
  assert.notEqual(result.cosmeticIds, receipt.cosmeticIds);
  for (const change of [{ crystals: 999 }, { crystals: 324 }, { count: 1 }, { cosmeticIds: ['frame_coop_team'] }, { cosmeticIds: [...receipt.cosmeticIds, 'title_foreign'] }, { periodId: 'other-week' }]) {
    assert.equal(competitionClaimForAwards({ ...receipt, ...change }, periodId, snapshots), null);
  }
});

test('a partial aggregate confirms only a uniquely matching award and never the whole week', () => {
  for (const selected of [personal, alliance]) {
    const paid = { periodId, count: 1, crystals: selected.crystals, cosmeticIds: [...selected.cosmeticIds].reverse() };
    assert.deepEqual(competitionClaimForAwards(paid, periodId, [personal, alliance]), { ...paid, paidKinds: [selected.kind], complete: false });
    assert.deepEqual(competitionClaimForAwards(paid, periodId, [selected]), { ...paid, paidKinds: [selected.kind], complete: true });
  }
  const ambiguous = [{ kind: 'personal', crystals: 20, cosmeticIds: [] }, { kind: 'alliance', crystals: 20, cosmeticIds: [] }];
  assert.equal(competitionClaimForAwards({ periodId, count: 1, crystals: 20, cosmeticIds: [] }, periodId, ambiguous), null);
});

test('zero payout stays neutral and malformed selected snapshots cannot establish ownership', () => {
  const zero = { periodId, count: 0, crystals: 0, cosmeticIds: [] };
  assert.deepEqual(competitionClaimForAwards(zero, periodId, [personal, alliance]), { ...zero, paidKinds: [], complete: false });
  for (const snapshots of [[], [personal, personal], [personal, alliance, personal], [{ ...personal, crystals: -1 }], [{ ...personal, crystals: '100' }], [{ ...personal, cosmeticIds: ['bad id'] }], [{ ...personal, cosmeticIds: ['same', 'same'] }], [{ ...personal, kind: 'unknown' }], [null]]) {
    assert.equal(competitionClaimForAwards(receipt, periodId, snapshots), null);
  }
});

test('shared permanent cosmetics are counted once across two confirmed awards', () => {
  const snapshots = [{ kind: 'personal', crystals: 20, cosmeticIds: ['frame_shared'] }, { kind: 'alliance', crystals: 30, cosmeticIds: ['frame_shared'] }];
  assert.deepEqual(competitionClaimForAwards({ periodId, count: 2, crystals: 50, cosmeticIds: ['frame_shared'] }, periodId, snapshots), { periodId, count: 2, crystals: 50, cosmeticIds: ['frame_shared'], paidKinds: ['personal', 'alliance'], complete: true });
});
