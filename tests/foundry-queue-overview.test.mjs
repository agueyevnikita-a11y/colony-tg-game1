import assert from 'node:assert/strict';
import test from 'node:test';
import { foundryQueueOverview } from '../lib/game/foundry.ts';

const now = Date.parse('2026-10-24T09:00:00Z');
const workshop = (id, extra = {}) => ({ id, type: 'foundry', status: 'active', level: 1, x: 0, y: 0, ...extra });
const job = (id, building_id, parts_reward, offset = -1000) => ({
  id, building_id, parts_reward, started_at: new Date(now - 300000).toISOString(),
  completes_at: new Date(now + offset).toISOString(), ore_spent: 100, energy_spent: 40,
});
const overview = extra => foundryQueueOverview({ buildings: [workshop('a'), workshop('b')], jobs: [], now, currentParts: 0, partsCapacity: 100, ...extra });

test('production overview separates every workshop queue, readiness and free slots', () => {
  const result = overview({ buildings: [workshop('a'), workshop('b', { level: 6 })],
    jobs: [job('a-ready', 'a', 35), job('b-running', 'b', 49, 1000)] });
  assert.deepEqual(result.workshops, [
    { id: 'a', occupied: 1, capacity: 6, freeSlots: 5, readyCount: 1, collectableCount: 1 },
    { id: 'b', occupied: 1, capacity: 8, freeSlots: 7, readyCount: 0, collectableCount: 0 },
  ]);
  assert.equal(result.readyCount, 1);
  assert.equal(result.readyParts, 35);
  assert.equal(result.collectableParts, 35);
  assert.deepEqual(result.readyBuildingIds, ['a']);
});

test('ready issuance reserves shared storage across workshops in server order', () => {
  const result = overview({ jobs: [job('b-second', 'b', 35, -500), job('a-first', 'a', 70, -1000)], currentParts: 30 });
  assert.equal(result.readyCount, 2);
  assert.equal(result.readyParts, 105);
  assert.equal(result.collectableCount, 1);
  assert.equal(result.collectableParts, 70);
  assert.deepEqual(result.workshops.map(row => row.collectableCount), [1, 0]);
  assert.deepEqual(result.readyBuildingIds, ['a', 'b']);
});

test('a large blocked cycle does not hide a later small cycle that fits whole', () => {
  const result = overview({ jobs: [job('large', 'a', 70, -1000), job('small', 'b', 35, -500)], currentParts: 65 });
  assert.equal(result.collectableParts, 35);
  assert.deepEqual(result.workshops.map(row => row.collectableCount), [0, 1]);
  assert.equal(overview({ jobs: [job('large', 'a', 70)], currentParts: 31 }).collectableCount, 0);
});

test('simultaneous completions use the server ID tie break regardless of input order', () => {
  const result = overview({ jobs: [job('bbbb', 'b', 35), job('aaaa', 'a', 70)], partsCapacity: 70 });
  assert.equal(result.collectableParts, 70);
  assert.deepEqual(result.workshops.map(row => row.collectableCount), [1, 0]);
  assert.deepEqual(result.readyBuildingIds, ['a', 'b']);
});

test('upgrading workshops retain their paid cycles and full queues do not invent free slots', () => {
  const result = overview({ buildings: [workshop('a', { status: 'upgrading' })],
    jobs: Array.from({ length: 6 }, (_, index) => job(`job-${index}`, 'a', 35, index * 1000)) });
  assert.equal(result.workshops[0].freeSlots, 0);
  assert.equal(result.workshops[0].occupied, 6);
  assert.equal(result.workshops[0].readyCount, 1); // Completion exactly at now is ready.
  assert.equal(result.readyParts, 35);
});

test('unknown storage stays unknown and over-cap stock produces no collectable output', () => {
  const jobs = [job('ready', 'a', 35)];
  for (const partsCapacity of [undefined, NaN, Infinity, -1]) {
    const result = overview({ jobs, partsCapacity });
    assert.equal(result.readyCount, 1);
    assert.equal(result.collectableCount, null);
    assert.equal(result.collectableParts, null);
    assert.equal(result.workshops[0].collectableCount, null);
  }
  assert.equal(overview({ jobs, currentParts: undefined }).collectableCount, null);
  assert.equal(overview({ jobs, currentParts: '35', partsCapacity: 70 }).collectableParts, 35);
  assert.equal(overview({ jobs, currentParts: 110 }).collectableCount, 0);
});

test('only known foundries and valid due cycles contribute to ready production', () => {
  const result = overview({ buildings: [workshop('a'), workshop('mine', { type: 'mine' })], jobs: [
    job('known', 'a', 35), job('unknown', 'other', 100), job('not-foundry', 'mine', 100),
    { ...job('invalid-date', 'a', 35), completes_at: 'not-a-date' }, job('future', 'a', 35, 1),
    job('invalid-reward', 'a', NaN),
  ] });
  assert.equal(result.readyCount, 1);
  assert.equal(result.collectableParts, 35);
  assert.equal(result.workshops[0].occupied, 4);
  assert.equal(overview({ jobs: [job('ready', 'a', 35)], now: NaN }).readyCount, 0);
});

test('the overview never mutates jobs, buildings or the current stored amount', () => {
  const buildings = Object.freeze([Object.freeze(workshop('a')), Object.freeze(workshop('b'))]);
  const jobs = Object.freeze([Object.freeze(job('later', 'b', 35, -500)), Object.freeze(job('first', 'a', 70, -1000))]);
  const before = JSON.stringify({ buildings, jobs });
  overview({ buildings, jobs, currentParts: 5 });
  assert.equal(JSON.stringify({ buildings, jobs }), before);
});
