import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyLoginClaimResult, isRewardPeriodExpired } from '../lib/game/daily-login-claim.ts';

const date = '2030-01-01';
const reset = '2030-01-02T00:00:00.000Z';
const receipt = (overrides = {}) => ({ ok: true, reward: { reward_date: date, claimed_at: '2030-01-01T23:59:59.000Z', credit_reward: '175.00', crystal_reward: '3', ...overrides } });

test('a known reward period closes at its exact boundary, including a delayed click', () => {
  assert.equal(isRewardPeriodExpired(reset, Date.parse(reset) - 1), false);
  assert.equal(isRewardPeriodExpired(reset, Date.parse(reset)), true);
  assert.equal(isRewardPeriodExpired(reset, Date.parse(reset) + 60_000), true);
});

test('unknown reward deadlines and an invalid client clock retain server validation', () => {
  for (const value of [undefined, null, '', 'invalid', 0, {}, [], new Date(reset)]) assert.equal(isRewardPeriodExpired(value, Date.parse(reset)), false);
  assert.equal(isRewardPeriodExpired(reset, NaN), false);
});

test('a verified current-day receipt displays actual credited quantities instead of the shown estimate', () => {
  const value = Object.freeze(receipt());
  assert.deepEqual(dailyLoginClaimResult(value, date), { status: 'received', rewardDate: date, credits: 175, crystals: 3 });
  assert.equal(value.reward.credit_reward, '175.00');
  assert.deepEqual(dailyLoginClaimResult(receipt({ credit_reward: 250, crystal_reward: 0 }), date), { status: 'received', rewardDate: date, credits: 250, crystals: 0 });
});

test('a response for another database day cannot mark the submitted reward as received', () => {
  assert.deepEqual(dailyLoginClaimResult(receipt({ reward_date: '2030-01-02', claimed_at: reset }), date), { status: 'day_changed', rewardDate: '2030-01-02' });
  assert.deepEqual(dailyLoginClaimResult(receipt({ reward_date: '2029-12-31' }), date), { status: 'day_changed', rewardDate: '2029-12-31' });
});

test('an unknown displayed date can use a verified server date without inventing a device day', () => {
  for (const expected of [undefined, null, '', 'invalid', '2030-02-30', new Date(reset)]) {
    assert.deepEqual(dailyLoginClaimResult(receipt(), expected), { status: 'received', rewardDate: date, credits: 175, crystals: 3 });
  }
});

test('zero, already-claimed and incomplete responses do not invent a new payout', () => {
  for (const value of [undefined, null, [], {}, true, { ok: true }, { ok: true, reward: null },
    { ok: true, claimed: true }, { ok: true, alreadyClaimed: true }, { ...receipt(), ok: false },
    receipt({ credit_reward: 0, crystal_reward: 0 }), receipt({ claimed_at: null }), receipt({ claimed_at: '' }),
    receipt({ claimed_at: 'invalid' }), Object.create(receipt()), { ok: true, reward: Object.create(receipt().reward) },
  ]) assert.deepEqual(dailyLoginClaimResult(value, date), { status: 'unconfirmed' });
});

test('receipt validation rejects impossible database dates and noncanonical monetary fields', () => {
  for (const reward_date of ['', '2030-1-1', '2030-02-30', '2030-01-01T00:00:00Z', undefined]) {
    assert.deepEqual(dailyLoginClaimResult(receipt({ reward_date }), date), { status: 'unconfirmed' });
  }
  for (const bad of ['', ' ', '-1', '0x10', '1e2', 'NaN', 'Infinity', -1, NaN, Infinity, null, undefined, true, {}, []]) {
    assert.deepEqual(dailyLoginClaimResult(receipt({ credit_reward: bad }), date), { status: 'unconfirmed' });
    assert.deepEqual(dailyLoginClaimResult(receipt({ crystal_reward: bad }), date), { status: 'unconfirmed' });
  }
});
