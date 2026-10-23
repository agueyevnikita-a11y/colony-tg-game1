import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { buildingUpgradePreview: preview, buildingHourlyProduction } = await import('../lib/game/upgrade-preview.ts');
const { upgradeTimeSec } = await import('../lib/game/economy.ts');
const b = (type, level = 1, extra = {}) => ({ id: `${type}-${level}`, type, level, status: 'active', nextUpgrade: { level: level + 1 }, ...extra });
const context = (building, extra = {}) => ({ buildings: [building], ...extra });
const metric = (result, key) => result.metrics.find(row => row.key === key);
const formatted = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);

test('upgrades require an active known building and the actual offered next level', () => {
  for (const building of [b('mine', 1, { status: 'upgrading' }), b('mine', 1, { status: 'building' }), b('mine', 20),
    b('hq', 6), b('mine', 1, { nextUpgrade: null }), b('mine', 1, { nextUpgrade: { level: 3 } }), b('unknown'), b('mine', 0)]) {
    assert.equal(preview(building, context(building)), null);
  }
});

test('passive preview includes fractional Premium and research bonuses without inventing science bonuses', () => {
  const mine = b('mine'), options = context(mine, { premium: true, completedResearch: ['extraction_ai'] });
  const original = structuredClone(options);
  const result = preview(mine, options);
  assert.equal(metric(result, 'production').before, `${formatted(134.82)}/ч`);
  assert.equal(metric(result, 'production').after, `${formatted(195.489)}/ч`);
  assert.ok(Math.abs(buildingHourlyProduction(mine, options).perHour - 134.82) < 1e-9);
  assert.match(result.note, /приостановится/);
  assert.deepEqual(options, original);
  assert.equal(buildingHourlyProduction(b('mine', 1, { status: 'upgrading' }), options), null);
  assert.equal(buildingHourlyProduction(b('habitat'), options).perHour, 63);
  assert.doesNotMatch(preview(b('habitat'), context(b('habitat'))).note, /место на складе/);
  assert.equal(buildingHourlyProduction(b('research_lab'), { premium: true, completedResearch: ['basic_theory'] }).perHour, 19.8);
});

test('warehouse preview compares the entire active city with research applied once', () => {
  const warehouse = b('warehouse', 2);
  const options = context(warehouse, { buildings: [warehouse, b('warehouse', 3), b('warehouse', 12, { status: 'upgrading' })], completedResearch: ['compact_storage'] });
  const result = preview(warehouse, options);
  assert.equal(metric(result, 'ore').before, formatted(10450));
  assert.equal(metric(result, 'ore').after, formatted(12100));
  assert.equal(metric(result, 'energy').before, formatted(6270));
  assert.equal(metric(result, 'parts').after, formatted(4840));
  assert.match(result.note, /имеющиеся запасы сохранятся/);
});

test('foundry upgrade quotes actual researched output, exact seconds and queue threshold', () => {
  const foundry = b('foundry', 5), result = preview(foundry, context(foundry, { completedResearch: ['thermal_recovery'] }));
  assert.equal(metric(result, 'parts').before, '50');
  assert.equal(metric(result, 'parts').after, '53');
  assert.equal(metric(result, 'cycleTime').before, '3 мин. 23 сек.');
  assert.equal(metric(result, 'cycleTime').after, '3 мин. 8 сек.');
  assert.equal(metric(result, 'queue').before, '6');
  assert.equal(metric(result, 'queue').after, '8');
  assert.match(result.note, /Оплаченная очередь продолжит работу/);
});

test('a smaller lab improves its own science without promising a higher technology gate', () => {
  const lab = b('research_lab'), result = preview(lab, context(lab, { buildings: [lab, b('research_lab', 4)], completedResearch: ['basic_theory'], premium: true }));
  assert.equal(metric(result, 'science').before, `${formatted(19.8)}/ч`);
  assert.equal(metric(result, 'science').after, `${formatted(26.4)}/ч`);
  assert.equal(metric(result, 'labLevel').before, '4');
  assert.equal(metric(result, 'labLevel').after, '4');
});

test('HQ shows actual map thresholds and never promises expansion at level six', () => {
  const hq = b('hq', 2), result = preview(hq, context(hq));
  assert.deepEqual([metric(result, 'grid').before, metric(result, 'grid').after], ['6×6', '7×7']);
  assert.match(result.note, /Глубинная шахта/);
  assert.match(result.note, /нужны технологии/);
  const late = b('hq', 5), last = preview(late, context(late));
  assert.deepEqual([metric(last, 'grid').before, metric(last, 'grid').after], ['8×8', '8×8']);
  assert.deepEqual([metric(last, 'buildingTypes').before, metric(last, 'buildingTypes').after], ['14', '14']);
  assert.deepEqual([metric(last, 'rating').before, metric(last, 'rating').after], [formatted(25000), formatted(36000)]);
});

test('expedition slots use the best active centre and cap with drone research', () => {
  const centre = b('expedition_center', 5);
  const threshold = preview(centre, context(centre));
  assert.deepEqual([metric(threshold, 'expeditionSlots').before, metric(threshold, 'expeditionSlots').after], ['1', '2']);
  const smaller = preview(centre, context(centre, { buildings: [centre, b('expedition_center', 6)], completedResearch: ['autonomous_drones'] }));
  assert.deepEqual([metric(smaller, 'expeditionSlots').before, metric(smaller, 'expeditionSlots').after], ['3', '3']);
  const ratingOnly = b('observatory');
  assert.deepEqual(preview(ratingOnly, context(ratingOnly)).metrics.map(row => row.key), ['rating']);
});

test('upgrade time uses configured HQ duration and the same Premium multiplier as construction', () => {
  assert.equal(upgradeTimeSec('hq', 2), 120);
  assert.equal(upgradeTimeSec('hq', 2, true), 114);
  assert.equal(upgradeTimeSec('hq', 6, true), 20520);
  assert.equal(upgradeTimeSec('hq', 7), null);
  assert.equal(upgradeTimeSec('mine', 2), 23);
  assert.equal(upgradeTimeSec('mine', 2, true), 22);
  assert.equal(upgradeTimeSec('mine', 21), null);
});
