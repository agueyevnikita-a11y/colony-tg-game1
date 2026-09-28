import assert from 'node:assert/strict';
import test from 'node:test';
import { availableFoundryLinks, collectableFoundryJobs, foundryQueueCapacity, parseFoundryOrder, quoteFoundry } from '../lib/game/foundry.ts';

const quote = (options = {}) => quoteFoundry({ level: 1, mode: 'standard', link: 'none', cycles: 1, ...options });
const foundry = { id: 'f', type: 'foundry', status: 'active', level: 1, x: 2, y: 2 };
const supplier = (type, x, y, status = 'active') => ({ id: `${type}-${x}-${y}`, type, x, y, status, level: 1 });

test('standard production preserves the original recipe while other modes trade energy for time', () => {
  assert.deepEqual(quote(), { ore: 100, energy: 40, parts: 35, seconds: 300, cycleSeconds: 300, cycleParts: 35 });
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
});

test('batch costs, duration and research output equal the sum of rounded individual cycles', () => {
  const single = quote({ mode: 'rush', link: 'energy', level: 6, partsMultiplier: 1.15 });
  const batch = quote({ mode: 'rush', link: 'energy', level: 6, partsMultiplier: 1.15, cycles: 6 });
  for (const field of ['ore', 'energy', 'parts', 'seconds']) assert.equal(batch[field], single[field] * 6);
  assert.equal(batch.cycleSeconds, single.seconds);
  assert.ok(single.parts > 35);
});

test('orders reject malformed input and inherited property names while retaining legacy defaults', () => {
  assert.deepEqual(parseFoundryOrder({}), { buildingId: undefined, requestId: undefined, mode: 'standard', link: 'none', cycles: 1 });
  for (const value of [null, [], 'start', { mode: 'constructor' }, { link: 'both' }, { cycles: '2' }, { cycles: 0 }, { cycles: 1.5 }, { cycles: 13 }, { buildingId: '' }, { requestId: 'not-a-uuid' }]) {
    assert.throws(() => parseFoundryOrder(value));
  }
  assert.equal(foundryQueueCapacity(1), 6);
  assert.equal(foundryQueueCapacity(6), 8);
  assert.throws(() => quote({ cycles: 7 }));
  assert.throws(() => quote({ partsMultiplier: Infinity }));
  assert.throws(() => quote({ level: 0 }));
});

test('completed jobs wait intact when output cannot fit and can be collected after space is freed', () => {
  const jobs = [{ id: 'legacy', parts_reward: '35' }, { id: 'new', parts_reward: 70 }];
  assert.deepEqual(collectableFoundryJobs(jobs, 34), []);
  assert.deepEqual(collectableFoundryJobs(jobs, 35).map(j => j.id), ['legacy']);
  assert.deepEqual(collectableFoundryJobs(jobs, 105).map(j => j.id), ['legacy', 'new']);
  assert.deepEqual(collectableFoundryJobs(jobs, -1), []);
  assert.equal(jobs[0].parts_reward, '35');
});
