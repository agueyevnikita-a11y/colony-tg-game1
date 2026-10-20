import assert from 'node:assert/strict';
import test from 'node:test';
import { FOUNDRY_RECIPES, availableFoundryRecipes, availableFoundryLinks, collectableFoundryJobs, foundryQueueCapacity, parseFoundryOrder, quoteFoundry } from '../lib/game/foundry.ts';

const quote = (options = {}) => quoteFoundry({ level: 1, mode: 'standard', link: 'none', cycles: 1, ...options });
const foundry = { id: 'f', type: 'foundry', status: 'active', level: 1, x: 2, y: 2 };
const supplier = (type, x, y, status = 'active') => ({ id: `${type}-${x}-${y}`, type, x, y, status, level: 1 });

test('standard production preserves the original recipe while other modes trade energy for time', () => {
  assert.deepEqual(quote(), { ore: 100, energy: 40, parts: 35, seconds: 300, cycleSeconds: 300, cycleParts: 35 });
  assert.deepEqual(quote({ recipe: 'standard_alloy' }), quote());
  const economy = quote({ mode: 'economy' });
  const rush = quote({ mode: 'rush' });
  assert.equal(economy.parts, rush.parts);
  assert.ok(economy.energy < quote().energy && economy.seconds > quote().seconds);
  assert.ok(rush.energy > quote().energy && rush.seconds < quote().seconds);
});

test('only active cardinal suppliers create a link; multiple suppliers do not stack savings', () => {
  assert.deepEqual(availableFoundryLinks(foundry, [foundry, supplier('mine', 3, 3), supplier('solar', 1, 2, 'upgrading')]), ['none']);
  const city = [foundry, supplier('mine', 3, 2), supplier('mine', 1, 2), supplier('solar', 2, 3)];
  assert.deepEqual(availableFoundryLinks(foundry, city), ['none', 'ore', 'energy']);
  assert.equal(quote({ link: 'ore' }).ore, 85);
  assert.equal(quote({ link: 'ore' }).energy, 40);
  assert.equal(quote({ link: 'energy' }).ore, 100);
  assert.equal(quote({ link: 'energy' }).energy, 32);
  assert.deepEqual(availableFoundryLinks(supplier('mine', 2, 2), city), ['none']);
  assert.deepEqual(availableFoundryLinks(foundry, [foundry, supplier('deep_mine', 1, 2), supplier('solar_array', 2, 1)]), ['none', 'ore', 'energy']);
});

test('batch costs, duration and research output equal the sum of rounded individual cycles', () => {
  const single = quote({ mode: 'rush', link: 'energy', level: 6, partsMultiplier: 1.15 });
  const batch = quote({ mode: 'rush', link: 'energy', level: 6, partsMultiplier: 1.15, cycles: 6 });
  for (const field of ['ore', 'energy', 'parts', 'seconds']) assert.equal(batch[field], single[field] * 6);
  assert.equal(batch.cycleSeconds, single.seconds);
  assert.ok(single.parts > 35);
});

test('orders reject malformed input and inherited property names while retaining legacy defaults', () => {
  assert.deepEqual(parseFoundryOrder({}), { buildingId: undefined, requestId: undefined, mode: 'standard', recipe: 'standard_alloy', link: 'none', cycles: 1 });
  for (const value of [null, [], 'start', { mode: 'constructor' }, { recipe: 'constructor' }, { recipe: 'unknown' }, { recipe: null }, { recipe: [] }, { link: 'both' }, { cycles: '2' }, { cycles: 0 }, { cycles: 1.5 }, { cycles: 13 }, { buildingId: '' }, { requestId: 'not-a-uuid' }]) {
    assert.throws(() => parseFoundryOrder(value));
  }
  assert.equal(foundryQueueCapacity(1), 6);
  assert.equal(foundryQueueCapacity(6), 8);
  assert.throws(() => quote({ cycles: 7 }));
  assert.throws(() => quote({ partsMultiplier: Infinity }));
  assert.throws(() => quote({ level: 0 }));
  assert.throws(() => quote({ recipe: 'unknown' }));
  assert.equal(parseFoundryOrder({ recipe: 'precision_casting' }).recipe, 'precision_casting');
});

test('research opens distinct recipes that trade ore, energy and queue slots', () => {
  assert.deepEqual(availableFoundryRecipes(new Set()).map((recipe) => recipe.id), ['standard_alloy']);
  assert.deepEqual(availableFoundryRecipes(new Set(['precision_casting'])).map((recipe) => recipe.id), ['standard_alloy', 'precision_casting']);
  assert.deepEqual(availableFoundryRecipes(new Set(['precision_casting', 'industrial_casting'])), FOUNDRY_RECIPES);
  assert.deepEqual(availableFoundryRecipes(new Set(['thermal_recovery'])).map((recipe) => recipe.id), ['standard_alloy']);
  const standard = quote();
  const precise = quote({ recipe: 'precision_casting' });
  const industrial = quote({ recipe: 'industrial_casting' });
  assert.equal(precise.parts, standard.parts);
  assert.ok(precise.ore < standard.ore && precise.energy > standard.energy && precise.seconds > standard.seconds);
  assert.equal(industrial.parts, 2 * standard.parts);
  assert.ok(industrial.energy / industrial.parts < standard.energy / standard.parts);
  assert.ok(industrial.ore / industrial.parts > standard.ore / standard.parts);
});

test('recipe energy rounds once after both the mode and adjacency multipliers', () => {
  const precise = quote({ recipe: 'precision_casting', mode: 'economy', link: 'energy' });
  assert.equal(precise.energy, 45); // ceil(90 * 25/40 * .8), not ceil(ceil(56.25) * .8) = 46.
  assert.equal(precise.seconds, 840);
  assert.equal(quote({ recipe: 'precision_casting', mode: 'rush', link: 'energy' }).energy, 126);
  assert.equal(quote({ recipe: 'industrial_casting', mode: 'economy', link: 'energy' }).energy, 30);
  assert.equal(quote({ recipe: 'precision_casting', link: 'ore' }).ore, 60);
});

test('each recipe snapshots rounded per-cycle output before multiplying a batch', () => {
  for (const recipe of FOUNDRY_RECIPES) {
    const single = quote({ recipe: recipe.id, mode: 'rush', link: 'ore', level: 6, partsMultiplier: 1.1 });
    const batch = quote({ recipe: recipe.id, mode: 'rush', link: 'ore', level: 6, partsMultiplier: 1.1, cycles: 8 });
    for (const field of ['ore', 'energy', 'parts', 'seconds']) assert.equal(batch[field], single[field] * 8);
    assert.equal(single.parts, Math.floor(recipe.parts * 1.4 * 1.1));
    assert.equal(single.seconds, Math.max(30, Math.ceil(recipe.seconds * 0.5 / 1.6)));
    assert.equal(batch.cycleParts, single.cycleParts);
    assert.equal(batch.cycleSeconds, single.cycleSeconds);
  }
});

test('completed jobs wait intact when output cannot fit and can be collected after space is freed', () => {
  const jobs = [{ id: 'legacy', parts_reward: '35' }, { id: 'new', parts_reward: 70 }];
  assert.deepEqual(collectableFoundryJobs(jobs, 34), []);
  assert.deepEqual(collectableFoundryJobs(jobs, 35).map(j => j.id), ['legacy']);
  assert.deepEqual(collectableFoundryJobs(jobs, 105).map(j => j.id), ['legacy', 'new']);
  assert.deepEqual(collectableFoundryJobs(jobs, -1), []);
  assert.equal(jobs[0].parts_reward, '35');
});
