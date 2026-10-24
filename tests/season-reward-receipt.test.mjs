import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { validSeasonClaimReceipt } = await import('../lib/game/season-reward-receipt.ts');
const { ACTIVE_SEASON_ID, SEASON_REWARDS } = await import('../lib/game/season.ts');
const selected = SEASON_REWARDS.slice(0, 3);
const receipt = (rewards) => ({ seasonId: ACTIVE_SEASON_ID, count: rewards.length,
  credits: rewards.reduce((sum, item) => sum + (item.credits ?? 0), 0),
  crystals: rewards.reduce((sum, item) => sum + (item.crystals ?? 0), 0),
  levels: rewards.map(item => item.level), rewards: rewards.map(item => ({ ...item })),
  cosmeticIds: rewards.flatMap(item => item.cosmeticId ? [item.cosmeticId] : []),
});
const valid = (value, snapshot = selected) => validSeasonClaimReceipt(value, ACTIVE_SEASON_ID, snapshot);

test('canonical single, bulk and partial payments match the selected ready snapshot', () => {
  assert.equal(valid(receipt([selected[0]])), true);
  assert.equal(valid(receipt(selected)), true);
  assert.equal(valid(receipt([selected[1], selected[2]])), true);
  assert.equal(valid(receipt([selected[2], selected[0]])), true);
});

test('empty payout is neutral only when every receipt amount and list is empty', () => {
  assert.equal(valid(receipt([])), true);
  for (const patch of [{ credits: 1 }, { crystals: 1 }, { levels: [1] }, { rewards: [selected[0]] }, { cosmeticIds: ['weather_signal_storm'] }]) {
    assert.equal(valid({ ...receipt([]), ...patch }), false);
  }
  assert.equal(valid(receipt([]), []), false);
});

test('foreign season, unselected levels and repeated paid levels never confirm a claim', () => {
  assert.equal(valid({ ...receipt(selected), seasonId: 'another-season' }), false);
  assert.equal(valid(receipt([SEASON_REWARDS[3]])), false);
  assert.equal(valid(receipt([selected[0], selected[0]])), false);
  assert.equal(valid({ ...receipt(selected), levels: [1, 2, '3'] }), false);
});

test('safe counts and exact aggregate currencies are mandatory', () => {
  const good = receipt(selected);
  for (const count of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '3', true, null, undefined]) assert.equal(valid({ ...good, count }), false);
  for (const field of ['credits', 'crystals']) {
    for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, String(good[field]), null, undefined, good[field] + 1]) {
      assert.equal(valid({ ...good, [field]: amount }), false);
    }
  }
  assert.equal(valid({ ...good, count: 2 }), false);
});

test('reward payload must match actual paid level, threshold, title, currency and temporary duration', () => {
  const good = receipt(selected);
  const mutations = [{ level: 4 }, { points: 151 }, { title: 'Награда подменена' }, { crystals: 99 }, { cosmeticId: 'foreign' }, { cosmeticDays: 8 }];
  for (const patch of mutations) {
    const rewards = good.rewards.map((item, index) => index === 2 ? { ...item, ...patch } : item);
    assert.equal(valid({ ...good, rewards }), false);
  }
  assert.equal(valid({ ...good, rewards: [good.rewards[0], good.rewards[0], good.rewards[2]] }), false);
  assert.equal(valid({ ...good, rewards: good.rewards.slice(0, 2) }), false);
});

test('cosmetic IDs form the exact multiset of paid rewards, including legitimate repeated cosmetics', () => {
  const good = receipt(selected);
  for (const cosmeticIds of [[], ['foreign'], ['weather_signal_storm', 'weather_signal_storm'], [3], [null]]) assert.equal(valid({ ...good, cosmeticIds }), false);
  const shared = [{ level: 1, points: 25, title: 'Первый срок', cosmeticId: 'same-frame', cosmeticDays: 7 }, { level: 2, points: 75, title: 'Продление', cosmeticId: 'same-frame', cosmeticDays: 7 }];
  assert.equal(valid(receipt(shared), shared), true);
  assert.equal(valid({ ...receipt(shared), cosmeticIds: ['same-frame'] }, shared), false);
});

test('optional zero currencies and permanent duration normalize without altering the reward itself', () => {
  const permanent = SEASON_REWARDS.at(-1);
  const actual = receipt([permanent]);
  actual.rewards[0] = { ...actual.rewards[0], credits: 0, crystals: 0, cosmeticDays: 0 };
  assert.equal(valid(actual, [permanent]), true);
  assert.equal(valid({ ...actual, rewards: [{ ...actual.rewards[0], cosmeticDays: null }] }, [permanent]), false);
  const currency = receipt([selected[0]]);
  currency.rewards[0].crystals = 0;
  assert.equal(valid(currency), true);
});

test('corrupt or ambiguous selected snapshots cannot authorize any acknowledgement', () => {
  for (const snapshot of [[selected[0], selected[0]], [{ ...selected[0], level: 0 }], [{ ...selected[0], points: -1 }], [{ ...selected[0], credits: Number.MAX_SAFE_INTEGER + 1 }], [{ ...selected[0], title: '' }], [{ ...selected[0], cosmeticDays: 7 }], [{ ...selected[0], cosmeticId: null }], [{ ...selected[0], crystals: '0' }]]) {
    assert.equal(valid(receipt([]), snapshot), false);
  }
  const overflowing = [{ level: 1, points: 1, title: 'A', credits: Number.MAX_SAFE_INTEGER }, { level: 2, points: 2, title: 'B', credits: 1 }];
  assert.equal(valid(receipt(overflowing), overflowing), false);
});

test('malformed containers and noncanonical empty fields cannot become success', () => {
  for (const value of [null, undefined, false, [], 'receipt', {}, { ...receipt(selected), rewards: null }, { ...receipt(selected), levels: {} }, { ...receipt(selected), cosmeticIds: undefined }]) assert.equal(valid(value), false);
  assert.equal(validSeasonClaimReceipt(receipt(selected), '', selected), false);
  assert.equal(valid({ ...receipt([selected[0]]), rewards: [{ ...selected[0], cosmeticId: '' }] }), false);
});

test('validation is order-independent and leaves frozen receipt and snapshot unchanged', () => {
  const snapshot = Object.freeze(selected.map(item => Object.freeze({ ...item })));
  const value = receipt(selected);
  value.rewards.reverse();
  Object.freeze(value.levels);Object.freeze(value.cosmeticIds);value.rewards.forEach(Object.freeze);Object.freeze(value.rewards);Object.freeze(value);
  const before = structuredClone(value);
  assert.equal(valid(value, snapshot), true);
  assert.deepEqual(value, before);
  assert.deepEqual(snapshot, selected);
});
