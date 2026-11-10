import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { cityProductionStatuses } = await import('../lib/game/city-production-status.ts');
const now = Date.parse('2026-11-10T10:00:00.000Z');
const building = (id, extra = {}) => ({ id, type: 'foundry', status: 'active', level: 1, x: 1, y: 1, ...extra });
const job = (id, buildingId = 'a', parts = 35, start = -300000, end = -1000) => ({ id, building_id: buildingId,
  parts_reward: parts, ore_spent: 100, energy_spent: 40,
  started_at: new Date(now + start).toISOString(), completes_at: new Date(now + end).toISOString() });
const statuses = (extra = {}) => cityProductionStatuses({ buildings: [building('a')], jobs: [], currentParts: 0, partsCapacity: 100, now, ...extra });

test('known empty queues are idle; missing jobs never invent an empty workshop', () => {
  const idle = statuses()[0];
  assert.equal(idle.status, 'idle');
  assert.deepEqual([idle.occupied, idle.capacity, idle.freeSlots, idle.running, idle.nextAt], [0, 6, 6, null, null]);
  for (const jobs of [undefined, null, {}, '']) {
    const unknown = statuses({ jobs })[0];
    assert.equal(unknown.status, 'check');
    assert.equal(unknown.occupied, null);
    assert.equal(unknown.freeSlots, null);
  }
});

test('running and future-start paid cycles expose their saved time and next boundary', () => {
  const runningJob = job('running', 'a', 35, -100000, 100000);
  const running = statuses({ jobs: [runningJob], partsCapacity: undefined })[0];
  assert.equal(running.status, 'running');
  assert.deepEqual(running.running, { jobId: 'running', startedAt: now - 100000, completesAt: now + 100000, progress: .5 });
  assert.equal(running.nextAt, now + 100000);
  const queued = statuses({ jobs: [job('later', 'a', 70, 100000, 400000)] })[0];
  assert.equal(queued.status, 'queued');
  assert.equal(queued.running, null);
  assert.equal(queued.nextAt, now + 100000);
  assert.equal(statuses({ jobs: [runningJob], now: now - 100000 })[0].running.progress, 0);
});

test('a passed completion changes the hint to ready but keeps the paid queue occupied', () => {
  const paid = job('paid', 'a', 35, -300000, 0);
  const value = statuses({ jobs: [paid] })[0];
  assert.equal(value.status, 'ready');
  assert.deepEqual([value.readyCount, value.readyParts, value.collectableCount, value.blockedCount, value.occupied, value.freeSlots], [1, 35, 1, 0, 1, 5]);
  assert.equal(value.running, null);
  assert.equal(value.nextAt, null);
  assert.equal(paid.parts_reward, 35);
});

test('ready or blocked output takes priority over a simultaneously running paid cycle', () => {
  const jobs = [job('due'), job('running', 'a', 70, -1000, 100000)];
  const ready = statuses({ jobs })[0];
  assert.equal(ready.status, 'ready');
  assert.equal(ready.running.jobId, 'running');
  const blocked = statuses({ jobs, currentParts: 90 })[0];
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual([blocked.collectableCount, blocked.blockedCount, blocked.readyCount], [0, 1, 1]);
  assert.equal(blocked.running.jobId, 'running');
});

test('all workshops share storage in server order, including a later smaller cycle and ID ties', () => {
  const buildings = [building('a'), building('b'), building('c')];
  const result = statuses({ buildings, jobs: [job('a', 'a', 100), job('b', 'b', 35), job('c', 'c', 70)], currentParts: 10, partsCapacity: 80 });
  assert.deepEqual(result.map(row => [row.buildingId, row.status, row.collectableCount]), [['a', 'blocked', 0], ['b', 'ready', 1], ['c', 'blocked', 0]]);
  const ties = statuses({ buildings, jobs: [job('bbb', 'b', 35), job('aaa', 'a', 70)], currentParts: 30, partsCapacity: 100 });
  assert.deepEqual(ties.map(row => row.status), ['ready', 'blocked', 'idle']);
});

test('a partly fitting workshop is blocked rather than claiming all of its output fits', () => {
  const value = statuses({ jobs: [job('a', 'a', 70), job('b', 'a', 35)] })[0];
  assert.equal(value.status, 'blocked');
  assert.deepEqual([value.readyCount, value.readyParts, value.collectableCount, value.blockedCount], [2, 105, 1, 1]);
  assert.equal(statuses({ jobs: [job('a')], currentParts: 110 })[0].status, 'blocked');
});

test('unknown storage requests a check only for due output, without a zero-capacity claim', () => {
  for (const patch of [{ partsCapacity: undefined }, { partsCapacity: NaN }, { currentParts: undefined }, { currentParts: '' }, { currentParts: -1 }]) {
    const value = statuses({ jobs: [job('paid')], ...patch })[0];
    assert.equal(value.status, 'check');
    assert.equal(value.collectableCount, null);
    assert.equal(value.blockedCount, null);
    assert.equal(value.readyParts, 35);
  }
  assert.equal(statuses({ partsCapacity: undefined })[0].status, 'idle');
  assert.equal(statuses({ currentParts: undefined, jobs: [job('later', 'a', 35, 1000, 2000)] })[0].status, 'queued');
});

test('upgrading and building preserve their separate work state and already-paid jobs', () => {
  const upgrading = [building('a', { status: 'upgrading', level: 6 })];
  const empty = statuses({ buildings: upgrading })[0];
  assert.equal(empty.status, 'upgrading');
  assert.equal(empty.capacity, 8);
  const running = statuses({ buildings: upgrading, jobs: [job('paid', 'a', 35, -1000, 100000)] })[0];
  assert.equal(running.status, 'upgrading');
  assert.equal(running.running.jobId, 'paid');
  const ready = statuses({ buildings: upgrading, jobs: [job('paid')] })[0];
  assert.equal(ready.status, 'ready');
  assert.equal(ready.buildingStatus, 'upgrading');
  assert.equal(statuses({ buildings: [building('a', { status: 'building' })] })[0].status, 'building');
});

test('malformed own jobs, overlapping running cycles, unknown states and invalid levels stay uncertain', () => {
  const paid = job('paid');
  for (const patch of [{ started_at: 'invalid' }, { completes_at: 'invalid' }, { started_at: paid.completes_at }, { parts_reward: NaN }, { parts_reward: -1 }]) {
    const value = statuses({ jobs: [{ ...paid, ...patch }] })[0];
    assert.equal(value.status, 'check');
    assert.equal(value.running, null);
    assert.equal(value.nextAt, null);
  }
  assert.equal(statuses({ jobs: [job('1', 'a', 35, -100, 100), job('2', 'a', 35, -200, 200)] })[0].status, 'check');
  for (const level of [0, 16, NaN, 1.5]) assert.equal(statuses({ buildings: [building('a', { level })] })[0].capacity, null);
  assert.equal(statuses({ buildings: [building('a', { status: 'unknown' })] })[0].status, 'check');
  assert.equal(statuses({ now: NaN })[0].status, 'check');
});

test('invalid owned output leaves shared due issuance uncertain while foreign jobs cannot affect it', () => {
  const buildings = [building('a'), building('b'), building('mine', { type: 'mine' })];
  const bad = { ...job('bad', 'b'), started_at: 'invalid' };
  const uncertain = statuses({ buildings, jobs: [job('good', 'a'), bad] });
  assert.deepEqual(uncertain.map(row => row.status), ['check', 'check']);
  const ignored = statuses({ buildings, jobs: [job('good'), { ...bad, building_id: 'foreign' }, job('mine', 'mine', 1000)] });
  assert.deepEqual(ignored.map(row => row.status), ['ready', 'idle']);
});

test('frozen paid outputs and separate owners never inherit previous status or current recipe bonuses', () => {
  const input = Object.freeze({ buildings: Object.freeze([Object.freeze(building('a'))]),
    jobs: Object.freeze([Object.freeze(job('paid', 'a', 35))]), currentParts: 0, partsCapacity: 100, now });
  const before = structuredClone(input);
  assert.equal(cityProductionStatuses(input)[0].readyParts, 35);
  assert.equal(statuses({ buildings: [building('other-owner')], jobs: input.jobs })[0].status, 'idle');
  assert.equal(cityProductionStatuses(input)[0].status, 'ready');
  assert.deepEqual(input, before);
});
