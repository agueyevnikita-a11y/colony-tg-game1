import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { expeditionScienceRange, expeditionScienceComparison, expeditionSettlementReceipt } = await import('../lib/game/expedition-guidance.ts');
const { EXPEDITIONS, ARTIFACTS } = await import('../lib/game/expeditions.ts');
const { RESEARCH_TREE } = await import('../lib/game/research.ts');
const { nextResearchScienceGoal } = await import('../lib/game/research-supply.ts');

const goal = { key: 'thermal_recovery', name: 'Рекуперация расплава', science: 260 };
const receipt = (patch = {}) => ({ ore: 120, parts: 0, credits: 250, science: 20, crystals: 0,
  cost: {}, choiceId: null, artifactId: null, extraArtifactId: null, ...patch });

test('new expedition science matches server floor for every route and every possible base roll', () => {
  const expected = [[17, 34], [51, 92], [114, 201]];
  EXPEDITIONS.forEach((route, index) => {
    assert.deepEqual(expeditionScienceRange(route.reward.science, []), route.reward.science);
    assert.deepEqual(expeditionScienceRange(route.reward.science, ['signal_analysis']), expected[index]);
    const [minimum, maximum] = route.reward.science;
    for (let science = minimum; science <= maximum; science++) {
      assert.deepEqual(expeditionScienceRange([science, science], ['signal_analysis']), [Math.floor(science * 1.15), Math.floor(science * 1.15)]);
    }
  });
});

test('passive science, premium, unrelated or repeated research cannot multiply expedition science again', () => {
  assert.deepEqual(expeditionScienceRange([15, 30], ['basic_theory', 'premium', 'archive_network']), [15, 30]);
  assert.deepEqual(expeditionScienceRange([15, 30], ['signal_analysis', 'signal_analysis', 'premium', 'basic_theory']), [17, 34]);
  assert.deepEqual(expeditionScienceRange([0, 0], []), [0, 0]);
});

test('unknown research state and malformed or unsafe science ranges do not invent a base estimate', () => {
  assert.equal(expeditionScienceRange([15, 30]), null);
  for (const completed of [null, {}, 'signal_analysis', [null]]) assert.equal(expeditionScienceRange([15, 30], completed), null);
  for (const value of [null, undefined, [], [15], [15, 30, 40], ['15', 30], [-1, 30], [30, 15], [0.5, 30], [NaN, 30], [15, Infinity], [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1]]) {
    assert.equal(expeditionScienceRange(value, []), null);
  }
  assert.equal(expeditionScienceRange([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], ['signal_analysis']), null);
});

test('conditional science range keeps stock separate and reverses reward bounds for the remaining gap', () => {
  assert.deepEqual(expeditionScienceComparison({ currentScience: 200, goal, rewardRange: [17, 34] }), {
    currentGap: 60, afterGapRange: [26, 43], rewardRange: [17, 34],
  });
  assert.deepEqual(expeditionScienceComparison({ currentScience: '239.5', goal, rewardRange: [17, 34] }), {
    currentGap: 20.5, afterGapRange: [0, 3.5], rewardRange: [17, 34],
  });
  assert.deepEqual(expeditionScienceComparison({ currentScience: 250, goal, rewardRange: [17, 34] }).afterGapRange, [0, 0]);
  assert.deepEqual(expeditionScienceComparison({ currentScience: 300, goal, rewardRange: [17, 34] }), {
    currentGap: 0, afterGapRange: [0, 0], rewardRange: [17, 34],
  });
});

test('science guidance uses the unpaid prerequisite and omits an already paid active research goal', () => {
  const next = nextResearchScienceGoal(RESEARCH_TREE, ['basic_theory'], 'industrial_casting');
  assert.equal(next.key, 'thermal_recovery');
  assert.equal(expeditionScienceComparison({ currentScience: 200, goal: next, rewardRange: [15, 30] }).currentGap, 60);
  const paid = nextResearchScienceGoal(RESEARCH_TREE, ['basic_theory'], 'industrial_casting', 'thermal_recovery');
  assert.equal(expeditionScienceComparison({ currentScience: 0, goal: paid, rewardRange: [15, 30] }), null);
});

test('science comparison omits invalid current stock goals and reward ranges', () => {
  const values = { currentScience: 200, goal, rewardRange: [17, 34] };
  for (const currentScience of [null, undefined, '', ' ', {}, [], true, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(expeditionScienceComparison({ ...values, currentScience }), null);
  }
  for (const science of [-1, 0.5, NaN, Infinity, '260']) assert.equal(expeditionScienceComparison({ ...values, goal: { ...goal, science } }), null);
  for (const rewardRange of [undefined, [1.1, 3], [34, 17], [-1, 0], [NaN, 20], ['17', 34]]) assert.equal(expeditionScienceComparison({ ...values, rewardRange }), null);
  assert.equal(expeditionScienceComparison({ ...values, goal: undefined }), null);
});

test('complete direct and wrapped receipts preserve fixed settled rewards and canonical artifacts', () => {
  const direct = receipt({ science: 30, cost: { energy: 80 }, choiceId: 'assist', artifactId: 'signal_fragment' });
  assert.deepEqual(expeditionSettlementReceipt(direct), direct);
  assert.deepEqual(expeditionSettlementReceipt({ ok: true, result: direct, research: { completed: ['signal_analysis'] } }), direct,
    'Research completed after launch must not multiply a saved reward');
  for (const item of ARTIFACTS) assert.equal(expeditionSettlementReceipt(receipt({ extraArtifactId: item.id })).extraArtifactId, item.id);
  const zero = receipt({ ore: 0, credits: 0, science: 0 });
  assert.deepEqual(expeditionSettlementReceipt(zero), zero, 'A complete zero receipt is legitimate; completeness distinguishes it from an empty reply');
});

test('partial malformed and unknown artifact receipts cannot announce claimed rewards', () => {
  for (const value of [null, undefined, [], {}, { result: {} }, { result: null }, { result: { science: 20 } }, { result: { foo: 'bar' } }]) {
    assert.equal(expeditionSettlementReceipt(value), null);
  }
  assert.equal(expeditionSettlementReceipt({ ok: false, result: receipt() }), null);
  for (const key of ['ore', 'parts', 'credits', 'science', 'crystals', 'cost', 'choiceId', 'artifactId', 'extraArtifactId']) {
    const partial = receipt(); delete partial[key]; assert.equal(expeditionSettlementReceipt(partial), null, `Missing ${key}`);
  }
  for (const amount of [-1, 0.5, NaN, Infinity, '20', true, {}, null]) {
    for (const key of ['ore', 'parts', 'credits', 'science', 'crystals']) assert.equal(expeditionSettlementReceipt(receipt({ [key]: amount })), null);
  }
  for (const artifactId of ['', 'unknown', '__proto__', 1, {}]) assert.equal(expeditionSettlementReceipt(receipt({ artifactId })), null);
  for (const choiceId of ['', 'not valid', 'A', 1, {}, 'x'.repeat(65)]) assert.equal(expeditionSettlementReceipt(receipt({ choiceId })), null);
});

test('settlement receipts reject unsupported or malformed cost and normalize without shared references', () => {
  for (const cost of [null, [], 1, '80', { energy: -1 }, { parts: 1.5 }, { credits: '20' }, { energy: Infinity }, { science: 10 }, { ore: 10 }, { arbitrary: 0 }, Object.create({ energy: 80 })]) {
    assert.equal(expeditionSettlementReceipt(receipt({ cost })), null);
  }
  const source = receipt({ cost: { energy: 80, parts: 30, credits: 0 }, artifactId: 'signal_fragment', extraArtifactId: 'signal_fragment', choiceId: 'recover' });
  const copy = expeditionSettlementReceipt(source);
  assert.deepEqual(copy, source); assert.notEqual(copy, source); assert.notEqual(copy.cost, source.cost);
  copy.cost.energy = 0; assert.equal(source.cost.energy, 80);
});

test('guidance leaves route research receipt and range input unchanged', () => {
  const routesBefore = structuredClone(EXPEDITIONS), completed = Object.freeze(['signal_analysis']);
  const scienceRange = Object.freeze([15, 30]), source = receipt({ cost: { parts: 30 } }), before = structuredClone(source);
  expeditionScienceRange(scienceRange, completed);
  expeditionScienceComparison({ currentScience: 200.5, goal: Object.freeze(goal), rewardRange: scienceRange });
  expeditionSettlementReceipt(source);
  assert.deepEqual(EXPEDITIONS, routesBefore); assert.deepEqual(source, before); assert.deepEqual(scienceRange, [15, 30]);
});
