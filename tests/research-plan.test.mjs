import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';
import { buildResearchPlan, researchBlocker } from '../lib/game/research-plan.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts')) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { RESEARCH_TREE } = await import('../lib/game/research.ts');
const byKey = (key) => RESEARCH_TREE.find((item) => item.key === key);
const plan = (completed = [], activeKey) => buildResearchPlan('industrial_casting', RESEARCH_TREE, completed, activeKey);
const keys = (result) => result.steps.map((item) => item.key);
const readyState = (extra = {}) => ({ hqLevel: 5, labLevel: 4, labStatus: 'active', completed: [], resources: { science: 10000, ore: 10000, energy: 10000, parts: 10000, credits: 10000 }, ...extra });

test('industrial casting includes both branches with one shared foundation in prerequisite order', () => {
  const result = plan();
  assert.ok(result);
  assert.equal(result.target, byKey('industrial_casting'));
  assert.deepEqual(keys(result), ['basic_theory', 'thermal_recovery', 'extraction_ai', 'industrial_casting']);
  assert.equal(result.total, 4);
  assert.equal(result.completedCount, 0);
  assert.equal(result.next, byKey('basic_theory'));
  assert.equal(result.activeInPlan, false);
  assert.deepEqual(result.remainingCost, { science: 860, ore: 0, energy: 0, parts: 360, credits: 7100 });
  assert.equal(result.remainingTimeSec, 9600);
  for (const item of result.steps) {
    for (const prerequisite of item.prereqs) assert.ok(keys(result).indexOf(prerequisite) < keys(result).indexOf(item.key));
  }
});

test('completed steps stay visible but no longer contribute cost or duration', () => {
  const result = plan(['basic_theory', 'thermal_recovery', 'basic_theory', 'solar_lattice']);
  assert.equal(result.completedCount, 2);
  assert.equal(result.total, 4);
  assert.equal(result.next.key, 'extraction_ai');
  assert.deepEqual(result.remainingCost, { science: 580, ore: 0, energy: 0, parts: 240, credits: 4600 });
  assert.equal(result.remainingTimeSec, 6600);
});

test('an active plan step remains next but its prepaid cost and running duration are excluded', () => {
  const result = plan(['basic_theory'], 'thermal_recovery');
  assert.equal(result.completedCount, 1);
  assert.equal(result.next.key, 'thermal_recovery');
  assert.equal(result.activeInPlan, true);
  assert.deepEqual(result.remainingCost, { science: 580, ore: 0, energy: 0, parts: 240, credits: 4600 });
  assert.equal(result.remainingTimeSec, 6600);
});

test('research outside the plan does not reduce its price or duration', () => {
  const result = plan(['basic_theory'], 'solar_lattice');
  assert.equal(result.activeInPlan, false);
  assert.equal(result.next.key, 'thermal_recovery');
  assert.deepEqual(result.remainingCost, plan(['basic_theory']).remainingCost);
  assert.equal(result.remainingTimeSec, plan(['basic_theory']).remainingTimeSec);
});

test('a fully completed target has no next step or remaining charges', () => {
  const result = plan(keys(plan()));
  assert.equal(result.completedCount, result.total);
  assert.equal(result.next, null);
  assert.deepEqual(result.remainingCost, { science: 0, ore: 0, energy: 0, parts: 0, credits: 0 });
  assert.equal(result.remainingTimeSec, 0);
});

test('plans include every resource cost without mutating a frozen catalog', () => {
  const basic = Object.freeze({ ...byKey('basic_theory'), cost: Object.freeze({ ore: 5, energy: 8, parts: 3, credits: 10 }), prereqs: Object.freeze([]) });
  const catalog = Object.freeze([basic]);
  assert.deepEqual(buildResearchPlan('basic_theory', catalog, []).remainingCost, { science: 20, ore: 5, energy: 8, parts: 3, credits: 10 });
  assert.equal(basic.cost.ore, 5);
});

test('unknown targets, missing prerequisites and cycles safely produce no plan', () => {
  for (const key of ['unknown', 'constructor', '']) assert.equal(buildResearchPlan(key, RESEARCH_TREE, []), null);
  const basic = byKey('basic_theory');
  const extraction = byKey('extraction_ai');
  assert.equal(buildResearchPlan('basic_theory', [{ ...basic, prereqs: ['missing'] }], []), null);
  assert.equal(buildResearchPlan('basic_theory', [{ ...basic, prereqs: ['basic_theory'] }], ['basic_theory']), null);
  assert.equal(buildResearchPlan('extraction_ai', [{ ...basic, prereqs: ['extraction_ai'] }, extraction], []), null);
  assert.equal(buildResearchPlan('basic_theory', [basic, basic], []), null);
  const unrelatedMissing = RESEARCH_TREE.map((item) => item.key === 'solar_lattice' ? { ...item, prereqs: ['missing'] } : item);
  assert.ok(buildResearchPlan('industrial_casting', unrelatedMissing, []), 'An unrelated broken branch must not block a valid target');
});

test('completed and currently researching statuses precede other blockers', () => {
  const item = byKey('basic_theory');
  const unavailable = readyState({ hqLevel: 1, labLevel: 0, labStatus: 'missing', resources: {} });
  assert.deepEqual(researchBlocker(item, { ...unavailable, completed: ['basic_theory'] }), { kind: 'completed' });
  assert.deepEqual(researchBlocker(item, { ...unavailable, activeKey: 'basic_theory' }), { kind: 'researching' });
});

test('laboratory blockers distinguish an absent, busy and underlevel building', () => {
  const item = byKey('deep_drilling');
  assert.deepEqual(researchBlocker(item, readyState({ hqLevel: 2, labStatus: 'missing' })), { kind: 'hq' });
  assert.deepEqual(researchBlocker(item, readyState({ labStatus: 'missing', labLevel: 0 })), { kind: 'lab_missing' });
  for (const labStatus of ['building', 'upgrading']) assert.deepEqual(researchBlocker(item, readyState({ labStatus, labLevel: 0 })), { kind: 'lab_busy' });
  assert.deepEqual(researchBlocker(item, readyState({ labLevel: 1 })), { kind: 'lab_level' });
});

test('the first missing named prerequisite precedes busy and resource blockers', () => {
  const item = byKey('industrial_casting');
  assert.deepEqual(researchBlocker(item, readyState({ activeKey: 'solar_lattice', resources: {} })), { kind: 'prerequisite', missingPrereq: 'thermal_recovery' });
  assert.deepEqual(researchBlocker(item, readyState({ completed: ['thermal_recovery'], resources: {} })), { kind: 'prerequisite', missingPrereq: 'extraction_ai' });
  assert.deepEqual(researchBlocker(item, readyState({ completed: ['thermal_recovery', 'extraction_ai'], activeKey: 'solar_lattice', resources: {} })), { kind: 'busy' });
});

test('resource blockers compute exact deficits from numeric database strings', () => {
  const item = byKey('extraction_ai');
  const state = readyState({ completed: ['basic_theory'], resources: { science: '150', credits: '1100', parts: '20' } });
  assert.deepEqual(researchBlocker(item, state), { kind: 'resources', shortages: { science: 10, parts: 20, credits: 100 } });
  assert.deepEqual(researchBlocker(item, { ...state, resources: { science: '160', credits: 1200, parts: 40 } }), { kind: 'ready' });
  assert.deepEqual(researchBlocker(item, { ...state, resources: { science: Infinity, credits: -1, parts: {} } }), { kind: 'resources', shortages: { science: 160, parts: 40, credits: 1200 } });
});
