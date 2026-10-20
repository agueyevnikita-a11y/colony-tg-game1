import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts')) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { COLONY_EVENTS, COLONY_EVENT_COOLDOWN_SEC, colonyEventsUnlocked, eligibleColonyEvents, evaluateColonyChoice } = await import('../lib/game/colony-events.ts');
const { TUTORIAL_STEPS } = await import('../lib/game/tutorial.ts');
const byKey = (key) => COLONY_EVENTS.find((event) => event.key === key);
const choice = (eventKey, choiceId) => byKey(eventKey).choices.find((item) => item.id === choiceId);
const abundant = { ore: 1000, energy: 1000, parts: 1000, credits: 1000, science: 1000 };
const capacity = { ore: 5000, energy: 5000, parts: 5000 };

test('four soft events have unique keys, named choices and an always free automatic option', () => {
  assert.deepEqual(COLONY_EVENTS.map((event) => event.key), ['rich_vein', 'converter_drift', 'cooling_loop', 'sensor_noise']);
  assert.equal(COLONY_EVENT_COOLDOWN_SEC, 12 * 60 * 60);
  assert.equal(new Set(COLONY_EVENTS.map((event) => event.key)).size, COLONY_EVENTS.length);
  for (const event of COLONY_EVENTS) {
    assert.equal(event.choices.length, 3);
    assert.equal(new Set(event.choices.map((item) => item.id)).size, event.choices.length);
    assert.ok(event.title.trim());
    assert.ok(event.description.trim());
    const automatic = event.choices.find((item) => item.id === 'delegate');
    assert.deepEqual(automatic.cost, {});
    assert.deepEqual(automatic.reward, { credits: 90 });
    assert.equal(automatic.requiredResearch, undefined);
    assert.equal(evaluateColonyChoice(automatic, {}, {}).canResolve, true);
    assert.equal(evaluateColonyChoice(automatic, { ore: 9000, energy: 9000, parts: 9000 }, { ore: 1, energy: 1, parts: 1 }).canResolve, true);
    for (const item of event.choices) {
      for (const field of ['title', 'description', 'resultText']) assert.ok(item[field].trim());
      for (const amount of [...Object.values(item.cost), ...Object.values(item.reward)]) assert.ok(Number.isFinite(amount) && amount > 0);
    }
  }
});

test('event trades keep the announced resource costs and rewards', () => {
  const expected = [
    ['rich_vein', 'extract', { energy: 100 }, { ore: 300 }],
    ['rich_vein', 'analyze', { ore: 80, energy: 60 }, { science: 18 }],
    ['converter_drift', 'recalibrate', { parts: 12 }, { energy: 280 }],
    ['converter_drift', 'analyze', { energy: 100 }, { science: 20 }],
    ['cooling_loop', 'study', { parts: 10 }, { science: 18 }],
    ['cooling_loop', 'recycle', { ore: 60, energy: 100 }, { parts: 40 }],
    ['sensor_noise', 'calibrate', { parts: 8 }, { science: 20 }],
    ['sensor_noise', 'simulate', { credits: 160 }, { science: 30 }],
  ];
  for (const [eventKey, id, cost, reward] of expected) {
    const item = choice(eventKey, id);
    assert.deepEqual(item.cost, cost);
    assert.deepEqual(item.reward, reward);
    assert.equal(evaluateColonyChoice(item, abundant, capacity, ['thermal_recovery']).canResolve, true);
  }
});

test('only active matching buildings enable templates, regardless of duplicate buildings', () => {
  assert.deepEqual(eligibleColonyEvents([]), []);
  for (const event of COLONY_EVENTS) {
    for (const status of ['building', 'upgrading', 'missing', '']) {
      assert.deepEqual(eligibleColonyEvents([{ type: event.buildingType, status }]), []);
    }
    assert.deepEqual(eligibleColonyEvents([{ type: event.buildingType, status: 'active' }, { type: event.buildingType, status: 'active' }]), [event]);
  }
  assert.deepEqual(eligibleColonyEvents([{ type: 'hq', status: 'active' }, { type: 'deep_mine', status: 'active' }]), []);
  assert.deepEqual(eligibleColonyEvents(COLONY_EVENTS.map((event) => ({ type: event.buildingType, status: 'active' }))), COLONY_EVENTS);
});

test('events unlock only after both base level two and the completed tutorial', () => {
  const end = TUTORIAL_STEPS.length;
  assert.equal(colonyEventsUnlocked(1, end), false);
  assert.equal(colonyEventsUnlocked(2, end - 1), false);
  assert.equal(colonyEventsUnlocked(2, end), true);
  assert.equal(colonyEventsUnlocked(9, end + 1), true);
  for (const invalid of [NaN, Infinity, -Infinity, -1, undefined, null, '2']) {
    assert.equal(colonyEventsUnlocked(invalid, end), false);
  }
  for (const invalid of [NaN, Infinity, -Infinity, -1, undefined, null, String(end)]) {
    assert.equal(colonyEventsUnlocked(2, invalid), false);
  }
});

test('shortages compare the full cost before any reward is paid', () => {
  const item = choice('rich_vein', 'analyze');
  assert.deepEqual(evaluateColonyChoice(item, { ore: 50, energy: 25 }, capacity), {
    shortages: { ore: 30, energy: 35 }, storageShortages: {}, requiredResearch: null, canResolve: false,
  });
  assert.equal(evaluateColonyChoice(item, { ore: 80, energy: 60 }, capacity).canResolve, true);
  const selfFunding = { ...item, cost: { credits: 100 }, reward: { credits: 100 } };
  assert.deepEqual(evaluateColonyChoice(selfFunding, { credits: 99 }, capacity).shortages, { credits: 1 });
});

test('research gating applies to the selected choice and completed research alone unlocks it', () => {
  const item = choice('cooling_loop', 'recycle');
  assert.deepEqual(evaluateColonyChoice(item, abundant, capacity), {
    shortages: {}, storageShortages: {}, requiredResearch: 'thermal_recovery', canResolve: false,
  });
  assert.equal(evaluateColonyChoice(item, abundant, capacity, ['basic_theory']).canResolve, false);
  assert.equal(evaluateColonyChoice(item, abundant, capacity, ['thermal_recovery']).canResolve, true);
  assert.equal(evaluateColonyChoice(choice('cooling_loop', 'study'), abundant, capacity).canResolve, true);
});

test('a capped reward must fit completely; exact space is accepted and one missing unit is reported', () => {
  const item = choice('rich_vein', 'extract');
  assert.equal(evaluateColonyChoice(item, { energy: 100, ore: 4700 }, capacity).canResolve, true);
  assert.deepEqual(evaluateColonyChoice(item, { energy: 100, ore: 4701 }, capacity), {
    shortages: {}, storageShortages: { ore: 1 }, requiredResearch: null, canResolve: false,
  });
  const solar = choice('converter_drift', 'recalibrate');
  assert.deepEqual(evaluateColonyChoice(solar, { parts: 12, energy: 5000 }, capacity).storageShortages, { energy: 280 });
  const foundry = choice('cooling_loop', 'recycle');
  assert.deepEqual(evaluateColonyChoice(foundry, abundant, { ...capacity, parts: 1039 }, ['thermal_recovery']).storageShortages, { parts: 1 });
});

test('spending a resource creates space before its reward is checked', () => {
  const item = { ...choice('rich_vein', 'extract'), cost: { ore: 100 }, reward: { ore: 300 } };
  assert.equal(evaluateColonyChoice(item, { ore: 4800 }, capacity).canResolve, true);
  assert.deepEqual(evaluateColonyChoice(item, { ore: 4801 }, capacity).storageShortages, { ore: 1 });
  assert.deepEqual(evaluateColonyChoice(item, { ore: 99 }, capacity).shortages, { ore: 1 });
});

test('existing excess blocks incoming rewards only, without discarding any resources', () => {
  assert.equal(evaluateColonyChoice(choice('rich_vein', 'analyze'), { ore: 6000, energy: 6000, parts: 6000 }, capacity).canResolve, true);
  assert.deepEqual(evaluateColonyChoice(choice('rich_vein', 'extract'), { ore: 6000, energy: 100 }, capacity).storageShortages, { ore: 1300 });
  assert.equal(evaluateColonyChoice(choice('sensor_noise', 'simulate'), { credits: 160, science: 1_000_000, ore: 6000 }, {}).canResolve, true);
});

test('market escrow is respected through the supplied liquid capacity', () => {
  const item = choice('cooling_loop', 'recycle');
  const resources = { ore: 60, energy: 100, parts: 150 };
  assert.equal(evaluateColonyChoice(item, resources, { parts: 200 }, ['thermal_recovery']).canResolve, true);
  assert.deepEqual(evaluateColonyChoice(item, resources, { parts: 180 }, ['thermal_recovery']).storageShortages, { parts: 10 });
});

test('numeric database strings are supported, while malformed resources and capacities fail safely', () => {
  const item = choice('rich_vein', 'analyze');
  assert.equal(evaluateColonyChoice(item, { ore: '80', energy: '60' }, capacity).canResolve, true);
  for (const invalid of [NaN, Infinity, -Infinity, -1, 'not a number', undefined, null, {}, true, () => 80]) {
    const result = evaluateColonyChoice(item, { ore: invalid, energy: 60 }, capacity);
    assert.deepEqual(result.shortages, { ore: 80 });
    assert.equal(result.canResolve, false);
    assert.ok(Object.values(result.shortages).every(Number.isFinite));
  }
  for (const invalid of [NaN, Infinity, -Infinity, -1, 'bad', undefined, null, {}, true]) {
    assert.deepEqual(evaluateColonyChoice(choice('rich_vein', 'extract'), { ore: 0, energy: 100 }, { ore: invalid }).storageShortages, { ore: 300 });
  }
});

test('invalid cost and reward definitions cannot bypass checks or leak NaN into results', () => {
  const original = choice('rich_vein', 'extract');
  for (const invalid of [NaN, Infinity, -Infinity, -1, '100', null]) {
    for (const field of ['cost', 'reward']) {
      const item = { ...original, [field]: { ore: invalid } };
      const result = evaluateColonyChoice(item, abundant, capacity);
      assert.equal(result.canResolve, false);
      assert.ok([...Object.values(result.shortages), ...Object.values(result.storageShortages)].every(Number.isFinite));
    }
  }
});

test('evaluation leaves the choice, resources, research and capacities unchanged', () => {
  const item = Object.freeze({ ...choice('rich_vein', 'extract'), cost: Object.freeze({ energy: 100 }), reward: Object.freeze({ ore: 300 }) });
  const resources = Object.freeze({ energy: 100, ore: 4750 });
  const caps = Object.freeze({ ore: 5000 });
  const research = Object.freeze([]);
  assert.deepEqual(evaluateColonyChoice(item, resources, caps, research).storageShortages, { ore: 50 });
  assert.deepEqual(resources, { energy: 100, ore: 4750 });
  assert.deepEqual(item.reward, { ore: 300 });
  assert.deepEqual(caps, { ore: 5000 });
  assert.deepEqual(research, []);
});
