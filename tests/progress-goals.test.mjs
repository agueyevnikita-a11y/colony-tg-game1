import assert from 'node:assert/strict';
import test from 'node:test';
import { progressGoalForEvent, progressGoalForStat, nearestAchievement } from '../lib/game/progress-goals.ts';

const row = (key, stat, progress, target, status) => ({ key, title: `Цель ${key}`, stat, progress, target, status });

test('known progression events lead to their actual mechanics and canonical lifetime stats', () => {
  const expected = {
    build_started: ['buildings_started', 'build'], foundry_started: ['foundry_jobs_started', 'production'],
    contract_completed: ['contracts_completed', 'contracts'], research_completed: ['research_completed', 'research'],
    expedition_completed: ['expeditions_completed', 'expeditions'], unique_artifact_found: ['unique_artifacts_found', 'artifacts'],
    qualified_referral: ['qualified_referrals', 'friends'], market_trade_bought: ['market_trades_bought', 'market'],
  };
  for (const [event, [stat, destination]] of Object.entries(expected)) {
    const goal = progressGoalForEvent(event);
    assert.equal(goal.stat, stat);
    assert.equal(goal.destination, destination);
    assert.equal(goal, progressGoalForStat(stat));
    for (const field of ['label', 'icon', 'purpose', 'countHint']) assert.ok(goal[field]);
  }
});

test('daily session and creating market orders do not invent matching lifetime milestones', () => {
  assert.equal(progressGoalForEvent('daily_session').stat, null);
  assert.equal(progressGoalForEvent('daily_session').destination, 'city');
  assert.match(progressGoalForEvent('daily_session').countHint, /первый вход.*времени сервера/);
  assert.equal(progressGoalForEvent('market_order_created').stat, null);
  assert.match(progressGoalForEvent('market_order_created').countHint, /ещё не означает.*проданы/);
});

test('unknown, similar and prototype names never guess destinations', () => {
  for (const value of [undefined, '', 'build', 'custom_build_started', 'daily_smelt', '__proto__', 'constructor', 'toString']) {
    assert.equal(progressGoalForEvent(value), null);
    assert.equal(progressGoalForStat(value), null);
  }
});

test('guidance differentiates paid cycles, returning expeditions and unique artifacts', () => {
  assert.match(progressGoalForStat('foundry_jobs_started').countHint, /Каждый оплаченный цикл/);
  assert.match(progressGoalForStat('expeditions_completed').countHint, /после получения результата/);
  assert.match(progressGoalForStat('unique_artifacts_found').countHint, /только первый.*Повторная находка/s);
  assert.match(progressGoalForStat('artifacts_found').countHint, /повторные/);
  assert.notEqual(progressGoalForStat('artifacts_found').countHint, progressGoalForStat('unique_artifacts_found').countHint);
});

test('guidance keeps contract, decor, historical comfort and referral boundaries explicit', () => {
  assert.match(progressGoalForStat('buildings_started').countHint, /Декор.*не считаются/);
  assert.match(progressGoalForStat('contracts_completed').countHint, /поставок и сделки.*не считаются/);
  assert.match(progressGoalForStat('max_comfort').countHint, /наибольший достигнутый.*удаление декора не отнимает/s);
  assert.match(progressGoalForStat('max_comfort').countHint, /магазина очков комфорта не даёт/);
  assert.match(progressGoalForStat('qualified_referrals').countHint, /цент.*уровня 3/);
});

test('nearest milestone uses exact progress ratio without rounding and retains the original row', () => {
  const a = row('a', 'buildings_started', 60, 100);
  const b = row('b', 'buildings_started', 604, 1000);
  const unrelated = row('other', 'foundry_jobs_started', 99, 100);
  assert.equal(nearestAchievement([a, b, unrelated], 'buildings_started'), b);
  assert.equal(b.title, 'Цель b');
});

test('ready, claimed and over-target milestones are excluded even if their ratio is highest', () => {
  const nearest = row('next', 'research_completed', 2, 3);
  const rows = [row('ready', 'research_completed', 3, 3, {}), row('claimed', 'research_completed', 10, 10, { claimed_at: '2030-01-01' }), row('waiting-sync', 'research_completed', 3, 3), row('overflow', 'research_completed', 4, 3), nearest];
  assert.equal(nearestAchievement(rows, 'research_completed'), nearest);
  assert.equal(nearestAchievement(rows.slice(0, -1), 'research_completed'), null);
});

test('nearest keeps stable catalogue ties and does not mutate frozen input', () => {
  const a = Object.freeze(row('first', 'expeditions_completed', 1, 2));
  const b = Object.freeze(row('second', 'expeditions_completed', 5, 10));
  const rows = Object.freeze([a, b]);
  assert.equal(nearestAchievement(rows, 'expeditions_completed'), a);
  assert.deepEqual(rows, [a, b]);
});

test('malformed or unrelated progress never becomes a recommended milestone', () => {
  const malformed = [row('nan', 'max_comfort', NaN, 50), row('infinite', 'max_comfort', Infinity, 50), row('negative', 'max_comfort', -1, 50), row('zero', 'max_comfort', 0, 0), row('target', 'max_comfort', 0, Infinity), row('string', 'max_comfort', '25', 50)];
  assert.equal(nearestAchievement(malformed, 'max_comfort'), null);
  assert.equal(nearestAchievement([row('future', 'unknown_future_stat', 4, 5)], 'unknown_future_stat'), null);
  assert.equal(nearestAchievement([], 'buildings_started'), null);
});
