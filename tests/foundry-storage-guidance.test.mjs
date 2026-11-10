import assert from 'node:assert/strict';
import test from 'node:test';
import { collectableFoundryJobs, foundryQueueOverview } from '../lib/game/foundry.ts';

const now = Date.parse('2026-11-10T10:00:00.000Z');
const readyAt = '2026-11-10T09:00:00.000Z';
const building = (id, status = 'active', type = 'foundry') => ({ id, type, status, level: 1, x: 1, y: 1 });
const job = (id, parts, buildingId = 'a', completesAt = readyAt) => ({
  id, building_id: buildingId, parts_reward: parts, ore_spent: 100, energy_spent: 40,
  started_at: '2026-11-10T08:00:00.000Z', completes_at: completesAt,
});
const overview = (overrides = {}) => foundryQueueOverview({ buildings: [building('a')], jobs: [], now, currentParts: 0, partsCapacity: 80, ...overrides });

test('mixed completed outputs keep whole-cycle issuance and identify a smaller useful next cycle', () => {
  const result = overview({ currentParts: 10, jobs: [job('1', 100), job('2', 35), job('3', 70)] });
  assert.equal(result.collectableCount, 1);
  assert.equal(result.collectableParts, 35);
  assert.deepEqual(result.storage, {
    capacity: 80, storedParts: 10, freeParts: 70, afterCollectingParts: 45, freeAfterCollecting: 35,
    blockedCount: 2, oversizedCount: 1, minimumOversizedParts: 100,
    nextFit: { id: '3', buildingId: 'a', parts: 70, partsToSpend: 35 },
  });
});

test('over-cap stock includes its excess in the amount to spend before a whole cycle fits', () => {
  const result = overview({ currentParts: '140', jobs: [job('1', 35)] });
  assert.equal(result.collectableCount, 0);
  assert.deepEqual(result.storage, {
    capacity: 80, storedParts: 140, freeParts: 0, afterCollectingParts: 140, freeAfterCollecting: 0,
    blockedCount: 1, oversizedCount: 0, minimumOversizedParts: null,
    nextFit: { id: '1', buildingId: 'a', parts: 35, partsToSpend: 95 },
  });
});

test('oversized cycles cannot be unlocked by spending all current stock', () => {
  const result = overview({ jobs: [job('1', 100), job('2', 90)] });
  assert.equal(result.storage.oversizedCount, 2);
  assert.equal(result.storage.minimumOversizedParts, 90);
  assert.equal(result.storage.nextFit, null);
  const zero = overview({ partsCapacity: 0, currentParts: 30, jobs: [job('1', 35)] });
  assert.equal(zero.storage.nextFit, null);
  assert.equal(zero.storage.freeParts, 0);
  assert.equal(zero.storage.oversizedCount, 1);
});

test('equal timestamps use the server id order and equal-output advice keeps stable order', () => {
  const jobs = [job('c', 35), job('b', 70), job('d', 100), job('a', 35)];
  const result = overview({ jobs });
  assert.equal(result.collectableParts, 70);
  assert.deepEqual(result.storage.nextFit, { id: 'b', buildingId: 'a', parts: 70, partsToSpend: 60 });
  const ties = overview({ currentParts: 80, jobs: [job('b', 70), job('a', 70)] });
  assert.equal(ties.storage.nextFit.id, 'a');
  const earlier = overview({ currentParts: 80, jobs: [job('a', 70), job('z', 70, 'a', '2026-11-10T08:30:00.000Z')] });
  assert.equal(earlier.storage.nextFit.id, 'z');
});

test('known empty and exactly fitting stock have no pending storage action', () => {
  assert.deepEqual(overview().storage, {
    capacity: 80, storedParts: 0, freeParts: 80, afterCollectingParts: 0, freeAfterCollecting: 80,
    blockedCount: 0, oversizedCount: 0, minimumOversizedParts: null, nextFit: null,
  });
  const exact = overview({ currentParts: ' 45 ', jobs: [job('1', 35)] });
  assert.equal(exact.collectableCount, 1);
  assert.equal(exact.storage.afterCollectingParts, 80);
  assert.equal(exact.storage.freeAfterCollecting, 0);
  assert.equal(exact.storage.blockedCount, 0);
  assert.equal(exact.storage.nextFit, null);
});

test('unknown or malformed stock or capacity never creates a numerical storage promise', () => {
  const invalidStock = [undefined, null, '', '   ', true, false, NaN, Infinity, -Infinity, -1, '-1', 'invalid', {}, []];
  for (const currentParts of invalidStock) {
    const result = overview({ currentParts, jobs: [job('1', 35)] });
    assert.equal(result.storage, null, `stock ${String(currentParts)}`);
    assert.equal(result.collectableCount, null);
    assert.equal(result.collectableParts, null);
  }
  const invalidCapacity = [undefined, null, '', '80', true, false, NaN, Infinity, -Infinity, -1, {}, []];
  for (const partsCapacity of invalidCapacity) {
    const result = overview({ partsCapacity, jobs: [job('1', 35)] });
    assert.equal(result.storage, null, `capacity ${String(partsCapacity)}`);
    assert.equal(result.collectableCount, null);
    assert.equal(result.collectableParts, null);
  }
});

test('paid cycles of upgrading owned workshops remain eligible, future and foreign jobs do not', () => {
  const result = overview({
    buildings: [building('a', 'upgrading'), building('b', 'building'), building('mine', 'active', 'mine')],
    currentParts: 80,
    jobs: [job('2', 35, 'b'), job('1', 70, 'a'), job('foreign', 1, 'foreign'), job('mine', 1, 'mine'),
      job('future', 1, 'a', '2026-11-11T10:00:00.000Z'), job('unknown-time', 1, 'a', 'invalid'), job('invalid', NaN)],
  });
  assert.equal(result.readyCount, 2);
  assert.equal(result.readyParts, 105);
  assert.deepEqual(result.storage.nextFit, { id: '2', buildingId: 'b', parts: 35, partsToSpend: 35 });
  assert.equal(result.storage.blockedCount, 2);
  assert.deepEqual(result.readyBuildingIds, ['a', 'b']);
});

test('storage guidance does not modify frozen buildings, jobs, stock or their ordering', () => {
  const input = Object.freeze({
    buildings: Object.freeze([Object.freeze(building('a'))]),
    jobs: Object.freeze([Object.freeze(job('3', 70)), Object.freeze(job('2', 35)), Object.freeze(job('1', 100))]),
    now, currentParts: '10', partsCapacity: 80,
  });
  const before = structuredClone(input);
  assert.equal(foundryQueueOverview(input).storage.nextFit.id, '3');
  assert.deepEqual(input, before);
});

test('spending the advised amount after projected issuance always permits its identified cycle', () => {
  let advised = 0;
  const outputs = [[100, 35, 70], [70, 70, 35], [1, 35, 1, 100], [35], [100, 120], []];
  for (const partsCapacity of [0, 1, 35, 70, 80, 120]) for (const currentParts of [0, 1, 10, 35, 80, 140]) for (const amounts of outputs) {
    const jobs = amounts.map((parts, index) => job(String(index), parts));
    const result = overview({ jobs, currentParts, partsCapacity });
    const storage = result.storage;
    const issued = collectableFoundryJobs(jobs, partsCapacity - currentParts);
    assert.equal(result.collectableParts, issued.reduce((sum, item) => sum + item.parts_reward, 0));
    const issuedIds = new Set(issued.map(item => item.id));
    const blocked = jobs.filter(item => !issuedIds.has(item.id));
    assert.equal(storage.blockedCount, blocked.length);
    if (!storage.nextFit) continue;
    advised++;
    const next = storage.nextFit;
    assert.ok(next.parts <= partsCapacity);
    assert.ok(next.partsToSpend > 0 && next.partsToSpend <= storage.afterCollectingParts);
    const projectedStock = storage.afterCollectingParts - next.partsToSpend;
    assert.equal(projectedStock + next.parts, partsCapacity);
    const nextIssuance = collectableFoundryJobs(blocked, partsCapacity - projectedStock);
    assert.ok(nextIssuance.some(item => item.id === next.id));
    assert.ok(blocked.every(item => item.parts_reward > partsCapacity || item.parts_reward >= next.parts));
  }
  assert.ok(advised > 50);
});
