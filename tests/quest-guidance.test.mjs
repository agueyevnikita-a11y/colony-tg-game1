import assert from 'node:assert/strict';
import test from 'node:test';
import { compareQuestProgress, questNumber, questProgressRatio, relatedQuestForEvent, validQuestClaimReceipt } from '../lib/game/quest-guidance.ts';

const quest = (key, progress, target, patch = {}) => ({ id: `id-${key}`, quest_key: key, progress, target,
  credit_reward: 200, crystal_reward: 6, ...patch });
const now = Date.UTC(2026, 9, 24, 12);
const input = (patch = {}) => ({ event: 'foundry_started', period: 'weekly',
  quests: [quest('weekly_smelt', 6, 10)], catalog: [{ key: 'weekly_smelt', title: 'Промышленная неделя', description: 'Запусти 10 плавок', event: 'foundry_started' }],
  resetsAt: new Date(now + 1000).toISOString(), now, ...patch });
const receipt = (keys, patch = {}) => ({ period: 'daily', count: keys.length, credits: keys.length * 200, crystals: keys.length * 6, questKeys: keys, ...patch });

test('unfinished ordering compares proportions, preserves ties and places malformed targets last', () => {
  const rows = [quest('ten', 1, 10), quest('two', '1', '2'), quest('seven', 4, 7), quest('tie', 5, 10), quest('bad', 8, 0)];
  assert.deepEqual([...rows].sort(compareQuestProgress).map(row => row.quest_key), ['seven', 'two', 'tie', 'ten', 'bad']);
  assert.deepEqual(rows.map(row => row.quest_key), ['ten', 'two', 'seven', 'tie', 'bad']);
  assert.equal(compareQuestProgress(quest('a', 2, 4), quest('b', 1, 2)), 0);
  assert.equal(questProgressRatio(quest('a', 12, 10)), 1);
});

test('invalid progress does not become a recommendation even though display falls back to zero', () => {
  for (const value of ['', ' ', null, true, {}, [], NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(questProgressRatio(quest('a', value, 10)), null);
    assert.equal(questNumber(value), 0);
  }
  assert.equal(questProgressRatio(quest('a', 1, '')), null);
  assert.equal(questNumber('12.5'), 12.5);
});

test('same-action period goal requires a known future deadline and exact event identity', () => {
  const result = relatedQuestForEvent(input());
  assert.equal(result.quest.quest_key, 'weekly_smelt');
  assert.equal(result.remaining, 4);
  for (const resetsAt of [undefined, '', 'invalid', new Date(now).toISOString(), new Date(now - 1).toISOString()]) {
    assert.equal(relatedQuestForEvent(input({ resetsAt })), null);
  }
  assert.equal(relatedQuestForEvent(input({ event: 'foundry' })), null);
  assert.equal(relatedQuestForEvent(input({ event: 'contract_completed' })), null);
  assert.equal(relatedQuestForEvent(input({ now: NaN })), null);
});

test('same-action links omit completed, claimed, malformed and ambiguous rows and use closest remaining goal', () => {
  for (const patch of [{ progress: 10 }, { claimed_at: 'yesterday' }, { target: 0 }, { progress: -1 }, { target: Infinity }]) {
    assert.equal(relatedQuestForEvent(input({ quests: [quest('weekly_smelt', 6, 10, patch)] })), null);
  }
  const base = input();
  assert.equal(relatedQuestForEvent(input({ catalog: [...base.catalog, ...base.catalog] })), null);
  const other = { key: 'other', title: 'Другая цель', description: '', event: 'foundry_started' };
  const result = relatedQuestForEvent(input({ quests: [quest('weekly_smelt', 6, 10), quest('other', 9, 10)], catalog: [...base.catalog, other] }));
  assert.equal(result.quest.quest_key, 'other');
  assert.equal(result.remaining, 1);
});

test('single and bulk receipts match exact selected reward snapshots including numeric database strings', () => {
  const first = quest('daily_smelt', '2', '2', { credit_reward: '200', crystal_reward: '6' });
  const second = quest('daily_build', 1, 1, { credit_reward: 250, crystal_reward: 6 });
  assert.equal(validQuestClaimReceipt(receipt(['daily_smelt']), 'daily', [first]), true);
  assert.equal(validQuestClaimReceipt(receipt(['daily_build', 'daily_smelt'], { credits: 450 }), 'daily', [first, second]), true);
  assert.equal(validQuestClaimReceipt(receipt(['daily_build'], { credits: 250 }), 'daily', [first, second]), true, 'An acknowledged subset remains a valid payout');
  assert.equal(validQuestClaimReceipt(receipt([], { credits: 0, crystals: 0 }), 'daily', [first]), true);
});

test('receipts cannot acknowledge a foreign key, duplicate key, wrong period, fake total or count-zero payout', () => {
  const selected = [quest('daily_smelt', 2, 2)];
  const variants = [receipt(['daily_build']), receipt(['daily_smelt', 'daily_smelt']),
    receipt(['daily_smelt'], { count: 0 }), receipt(['daily_smelt'], { period: 'weekly' }),
    receipt(['daily_smelt'], { credits: 201 }), receipt(['daily_smelt'], { crystals: 5 }),
    receipt([], { credits: 1, crystals: 0 }), receipt([], { credits: 0, crystals: 1 }),
    receipt(['daily_smelt'], { count: 1.1 }), receipt(['daily_smelt'], { questKeys: [42] }),
    receipt(['daily_smelt'], { credits: '200' }), receipt(['daily_smelt'], { credits: Infinity }),
    receipt(['daily_smelt'], { crystals: Number.MAX_SAFE_INTEGER + 1 }), null, [], {}, true];
  for (const value of variants) assert.equal(validQuestClaimReceipt(value, 'daily', selected), false, JSON.stringify(value));
});

test('receipt validation rejects stale unready or claimed snapshots and ambiguous selected identities', () => {
  const first = quest('daily_smelt', 2, 2);
  for (const patch of [{ progress: 1 }, { target: 0 }, { claimed_at: 'claimed' }, { credit_reward: '' }, { crystal_reward: 1.5 }, { id: '' }, { quest_key: '' }]) {
    assert.equal(validQuestClaimReceipt(receipt(['daily_smelt']), 'daily', [{ ...first, ...patch }]), false);
  }
  assert.equal(validQuestClaimReceipt(receipt(['daily_smelt']), 'daily', [first, first]), false);
  assert.equal(validQuestClaimReceipt(receipt(['daily_smelt']), 'daily', [first, { ...first, quest_key: 'other' }]), false);
  assert.equal(validQuestClaimReceipt(receipt([]), 'daily', []), false);
});

test('sum overflow cannot produce an apparently valid bulk receipt', () => {
  const selected = [quest('a', 1, 1, { credit_reward: Number.MAX_SAFE_INTEGER }), quest('b', 1, 1, { credit_reward: 1 })];
  assert.equal(validQuestClaimReceipt(receipt(['a', 'b'], { credits: Number.MAX_SAFE_INTEGER + 1 }), 'daily', selected), false);
});
