import assert from 'node:assert/strict';
import test from 'node:test';
import { TUTORIAL_STEPS, tutorialConditionMet } from '../lib/game/tutorial.ts';

test('existing tutorial keys, order and rewards remain compatible with saved progress', () => {
  assert.deepEqual(TUTORIAL_STEPS.map(({ key, reward }) => ({ key, reward })), [
    { key: 'welcome', reward: { credits: 100, ore: 50 } },
    { key: 'build_foundry', reward: { energy: 60, credits: 100 } },
    { key: 'first_smelt', reward: { parts: 15, credits: 100 } },
    { key: 'build_trade_hub', reward: { credits: 200 } },
    { key: 'first_contract', reward: { ore: 350, parts: 20, crystals: 8, credits: 250 } },
    { key: 'hq2', reward: { crystals: 20, cosmeticId: 'title_cadet' } },
  ]);
});

test('each step explains its purpose and provides the correct concrete action', () => {
  assert.deepEqual(TUTORIAL_STEPS.map((step) => step.action), ['claim', 'build_foundry', 'production', 'build_trade_hub', 'contracts', 'upgrade_hq']);
  for (const step of TUTORIAL_STEPS) {
    for (const field of ['title', 'description', 'why', 'hint', 'actionLabel']) assert.ok(step[field].trim().length > 0, `${step.key} needs ${field}`);
    assert.doesNotMatch(`${step.description} ${step.why} ${step.hint}`, /\b(?:HQ|NPC|P2P)\b/, 'First steps should explain the game without abbreviations');
  }
  assert.equal(TUTORIAL_STEPS[2].actionTab, 'city');
  assert.equal(TUTORIAL_STEPS[2].targetBuilding, 'foundry');
  assert.equal(TUTORIAL_STEPS[3].targetBuilding, 'trade_hub');
  assert.equal(TUTORIAL_STEPS[5].targetBuilding, 'hq');
});

test('building tutorial steps require completed active buildings', () => {
  for (const [step, type] of [[1, 'foundry'], [3, 'trade_hub']]) {
    assert.equal(tutorialConditionMet(step, {}, [], {}), false);
    for (const status of ['building', 'upgrading']) assert.equal(tutorialConditionMet(step, {}, [{ type, level: 1, status }], {}), false);
    assert.equal(tutorialConditionMet(step, {}, [{ type, level: 0, status: 'active' }], {}), false);
    assert.equal(tutorialConditionMet(step, {}, [{ type, level: '1', status: 'active' }], {}), true);
  }
});

test('production and contract steps use existing progress counters without requiring another action', () => {
  assert.equal(tutorialConditionMet(2, {}, [{ type: 'foundry', level: 1, status: 'active' }], {}), false);
  assert.equal(tutorialConditionMet(2, {}, [], { foundry_jobs_started: '1' }), true);
  assert.equal(tutorialConditionMet(4, {}, [], {}), false);
  assert.equal(tutorialConditionMet(4, {}, [], { contracts_completed: 1 }), true);
});

test('welcome is available immediately and the final step requires centre level two', () => {
  assert.equal(tutorialConditionMet(0, null, [], null), true);
  assert.equal(tutorialConditionMet(5, { hq_level: 1 }, [{ type: 'hq', level: 1, status: 'upgrading' }], {}), false);
  assert.equal(tutorialConditionMet(5, { hq_level: '2' }, [], {}), true);
  for (const step of [-1, 6, 100]) assert.equal(tutorialConditionMet(step, {}, [], {}), false);
});
