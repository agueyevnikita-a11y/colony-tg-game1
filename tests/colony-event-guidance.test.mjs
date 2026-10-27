import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { colonyEventResourceGuidance, colonyEventResourceActions, validColonyEventReceipt } = await import('../lib/game/colony-event-guidance.ts');
const { COLONY_EVENTS } = await import('../lib/game/colony-events.ts');
const snapshot = (definition = COLONY_EVENTS[0]) => ({ ...structuredClone(definition), id: 'c0d26a79-1c2a-4b8f-a9dc-04f45d7b8341' });
const receipt = (event, choiceId = event.choices[0].id) => {
  const choice = event.choices.find(item => item.id === choiceId);
  return { id: event.id, title: event.title, choiceTitle: choice.title, resultText: choice.resultText,
    cost: { ...choice.cost }, reward: { ...choice.reward }, resolvedAt: '2026-10-27T09:30:00.000Z' };
};

test('every real event choice confirms its own complete atomic server result', () => {
  for (const definition of COLONY_EVENTS) {
    const event = snapshot(definition);
    for (const choice of event.choices) assert.equal(validColonyEventReceipt(receipt(event, choice.id), event, choice.id), true);
  }
});

test('the same event ID does not confirm a different choice or edited result text', () => {
  const event = snapshot();
  const paid = receipt(event);
  assert.equal(validColonyEventReceipt(paid, event, event.choices[1].id), false);
  for (const patch of [{ id: 'another-event' }, { title: 'Другое событие' }, { choiceTitle: 'Другое решение' }, { resultText: 'Подменённый итог' }]) {
    assert.equal(validColonyEventReceipt({ ...paid, ...patch }, event, event.choices[0].id), false);
  }
});

test('zero and partial rewards, missing or extra costs cannot confirm the announced exchange', () => {
  const event = snapshot();
  const paid = receipt(event);
  for (const reward of [{}, { ore: 0 }, { ore: 299 }, { ore: 301 }, { ore: 300, energy: 0 }, { ore: 300, crystals: 5 }]) {
    assert.equal(validColonyEventReceipt({ ...paid, reward }, event, 'extract'), false);
  }
  for (const cost of [{}, { energy: 99 }, { energy: 101 }, { energy: 100, ore: 0 }, { energy: 100, unknown: 1 }]) {
    assert.equal(validColonyEventReceipt({ ...paid, cost }, event, 'extract'), false);
  }
  const analyze = receipt(event, 'analyze');
  assert.equal(validColonyEventReceipt({ ...analyze, cost: { energy: 60 } }, event, 'analyze'), false);
  assert.equal(validColonyEventReceipt({ ...analyze, cost: { energy: 60, ore: 80 } }, event, 'analyze'), true);
});

test('resource keys and numbers remain exact without coercion or nonfinite values', () => {
  const event = snapshot();
  const paid = receipt(event);
  for (const amount of ['300', null, undefined, true, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validColonyEventReceipt({ ...paid, reward: { ore: amount } }, event, 'extract'), false);
  }
  for (const reward of [null, [], 300, new Date(), new Map([['ore', 300]]), { Ore: 300 }, { ore: 300, [Symbol('extra')]: 1 }]) {
    assert.equal(validColonyEventReceipt({ ...paid, reward }, event, 'extract'), false);
  }
});

test('a genuinely empty snapshot exchange and explicit zero remain distinct and exact', () => {
  const event = snapshot();
  event.choices[0].cost = {};
  event.choices[0].reward = {};
  assert.equal(validColonyEventReceipt(receipt(event), event, 'extract'), true);
  assert.equal(validColonyEventReceipt({ ...receipt(event), reward: { ore: 0 } }, event, 'extract'), false);
  event.choices[0].reward = { ore: 0 };
  assert.equal(validColonyEventReceipt(receipt(event), event, 'extract'), true);
  assert.equal(validColonyEventReceipt({ ...receipt(event), reward: {} }, event, 'extract'), false);
});

test('unknown fields, API wrappers and incomplete receipts never fall back to a preview', () => {
  const event = snapshot();
  const paid = receipt(event);
  for (const value of [null, undefined, false, [], 'ok', {}, { ok: true, result: paid }, { ...paid, extraReward: 900 }, { ...paid, [Symbol('extra')]: true }]) {
    assert.equal(validColonyEventReceipt(value, event, 'extract'), false);
  }
  for (const key of Object.keys(paid)) {
    const missing = { ...paid }; delete missing[key];
    assert.equal(validColonyEventReceipt(missing, event, 'extract'), false);
  }
});

test('ambiguous, missing and corrupt captured choices cannot authorize an acknowledgement', () => {
  const event = snapshot();
  const paid = receipt(event);
  assert.equal(validColonyEventReceipt(paid, event, 'not-a-choice'), false);
  assert.equal(validColonyEventReceipt(paid, event, ''), false);
  for (const malformed of [null, {}, { ...event, id: '' }, { ...event, title: '' }, { ...event, choices: null },
    { ...event, choices: [...event.choices, event.choices[0]] }, { ...event, choices: [null] },
    { ...event, choices: [{ ...event.choices[0], title: '' }] }, { ...event, choices: [{ ...event.choices[0], resultText: '' }] },
    { ...event, choices: [{ ...event.choices[0], cost: { energy: '100' } }] },
    { ...event, choices: [{ ...event.choices[0], reward: { unknown: 300 } }] }]) {
    assert.equal(validColonyEventReceipt(paid, malformed, 'extract'), false);
  }
});

test('valid saved server dates are accepted independently of client time; malformed dates are rejected', () => {
  const event = snapshot();
  const paid = receipt(event);
  for (const resolvedAt of ['2000-01-01T00:00:00.000Z', '2099-12-31T23:59:59.999Z']) {
    assert.equal(validColonyEventReceipt({ ...paid, resolvedAt }, event, 'extract'), true);
  }
  for (const resolvedAt of ['', null, 0, 'not-a-date', '2026-02-30T00:00:00.000Z', '2026-10-27', '2026-10-27T09:30:00+00:00']) {
    assert.equal(validColonyEventReceipt({ ...paid, resolvedAt }, event, 'extract'), false);
  }
});

test('resource guidance connects real rewards to existing colony mechanics without promising extra progress', () => {
  const guides = colonyEventResourceGuidance({ science: 20, parts: 40, ore: 300, energy: 280, credits: 90 });
  assert.deepEqual(guides.map(item => [item.resource, item.destination]), [
    ['science', 'research'], ['parts', 'build'], ['ore', 'production'], ['energy', 'production'], ['credits', 'build'],
  ]);
  for (const guide of guides) {
    assert.ok(guide.icon && guide.label && guide.purpose);
    assert.doesNotMatch(guide.purpose, /SP|очки|квест|достижен/iu);
  }
  assert.match(guides[0].purpose, /личный запас/u);
});

test('guidance ignores unknown, zero, negative, inherited and malformed resource amounts', () => {
  assert.deepEqual(colonyEventResourceGuidance({ crystals: 20, ore: 0, energy: -1, science: '20', parts: Infinity, credits: NaN }), []);
  for (const amounts of [null, undefined, [], true, 'science', new Date(), Object.create({ science: 20 })]) {
    assert.deepEqual(colonyEventResourceGuidance(amounts), []);
  }
  assert.deepEqual(colonyEventResourceGuidance({ ore: 0.5, unknown: 9 }).map(item => item.resource), ['ore']);
});

test('mixed rewards deduplicate free destinations in stable order', () => {
  const actions = colonyEventResourceActions({ credits: 90, energy: 280, ore: 300, parts: 40, science: 20 });
  assert.deepEqual(actions.map(action => action.destination), ['research', 'build', 'production']);
  assert.equal(actions.every(action => !Object.hasOwn(action, 'resource')), true);
  assert.deepEqual(colonyEventResourceActions({}), []);
  assert.deepEqual(colonyEventResourceActions({ energy: 280, ore: 300 }).map(action => action.destination), ['production']);
});

test('helpers leave frozen event and receipt untouched and callers cannot edit shared guidance', () => {
  const event = snapshot();
  event.choices.forEach(choice => { Object.freeze(choice.cost); Object.freeze(choice.reward); Object.freeze(choice); });
  Object.freeze(event.choices); Object.freeze(event);
  const paid = receipt(event);
  Object.freeze(paid.cost); Object.freeze(paid.reward); Object.freeze(paid);
  const before = structuredClone({ event, paid });
  assert.equal(validColonyEventReceipt(paid, event, 'extract'), true);
  assert.deepEqual({ event, paid }, before);
  const guides = colonyEventResourceGuidance(Object.freeze({ science: 20 }));
  guides[0].purpose = 'изменено';
  assert.notEqual(colonyEventResourceGuidance({ science: 20 })[0].purpose, 'изменено');
});
