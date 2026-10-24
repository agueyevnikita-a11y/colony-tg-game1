import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { currentScienceSupply, nextResearchScienceGoal, scienceSupplyComparison } = await import('../lib/game/research-supply.ts');
const { SUPPLY_PROJECTS } = await import('../lib/game/supply-projects.ts');
const { RESEARCH_TREE } = await import('../lib/game/research.ts');
function project(key, patch = {}) {
  return { ...structuredClone(SUPPLY_PROJECTS.find(item => item.id === key)), stageIndex: 0,
    delivered: { ore: 0, energy: 0, parts: 0 }, remaining: { ore: 200, energy: 150, parts: 70 },
    ready: false, completed: false, started: false, completedAt: null, ...patch };
}

test('science supply considers only each current stage and never future rewards or completed projects', () => {
  const cargo = project('cargo_route'), polar = project('polar_lab'), dawn = project('dawn_district');
  assert.equal(currentScienceSupply([cargo]), null, 'Cargo has no science in its first stage despite later rewards');
  assert.deepEqual(currentScienceSupply([polar]), { projectKey: 'polar_lab', projectName: polar.name, stageIndex: 0,
    stageName: polar.stages[0].name, science: 60, ready: false });
  assert.equal(currentScienceSupply([project('polar_lab', { completed: true }), dawn]).projectKey, 'dawn_district');
  assert.equal(currentScienceSupply([project('polar_lab', { completed: true })]), null);
  assert.equal(currentScienceSupply([]), null);
});

test('science supply preserves an explicit eligible project before preferring earned rewards', () => {
  const readyPolar = project('polar_lab', { ready: true });
  const dawn = project('dawn_district');
  assert.equal(currentScienceSupply([dawn, readyPolar]).projectKey, 'polar_lab');
  assert.equal(currentScienceSupply([dawn, readyPolar], 'dawn_district').projectKey, 'dawn_district');
  assert.equal(currentScienceSupply([dawn, readyPolar], 'cargo_route').projectKey, 'polar_lab');
  assert.equal(currentScienceSupply([dawn, project('polar_lab')]).projectKey, 'dawn_district');
});

test('science supply can show already earned rewards without active logistics or a fresh delivery', () => {
  const ready = project('polar_lab', { ready: true, stageIndex: 1 });
  assert.deepEqual(currentScienceSupply([ready]), { projectKey: 'polar_lab', projectName: ready.name, stageIndex: 1,
    stageName: ready.stages[1].name, science: 120, ready: true });
});

test('science supply ignores invalid current stages and malformed rewards rather than inventing funds', () => {
  for (const stageIndex of [-1, 0.5, 3, NaN, Infinity]) assert.equal(currentScienceSupply([project('polar_lab', { stageIndex })]), null);
  for (const science of [0, -1, 0.5, '60', NaN, Infinity]) {
    const entry = project('polar_lab'); entry.stages[0].reward.science = science;
    assert.equal(currentScienceSupply([entry]), null);
  }
});

test('next research science belongs to the first unpaid prerequisite, not the final expensive goal', () => {
  assert.deepEqual(nextResearchScienceGoal(RESEARCH_TREE, [], 'industrial_casting'), { key: 'basic_theory', name: 'Прикладная ксенология', science: 20 });
  assert.deepEqual(nextResearchScienceGoal(RESEARCH_TREE, ['basic_theory'], 'industrial_casting'), { key: 'thermal_recovery', name: 'Рекуперация расплава', science: 260 });
  assert.equal(nextResearchScienceGoal(RESEARCH_TREE, ['basic_theory'], 'industrial_casting', 'thermal_recovery'), null);
  assert.equal(nextResearchScienceGoal(RESEARCH_TREE, ['basic_theory'], 'industrial_casting', 'solar_lattice').key, 'thermal_recovery');
});

test('missing completed and malformed research plans have no unpaid science target', () => {
  assert.equal(nextResearchScienceGoal(RESEARCH_TREE, [], null), null);
  assert.equal(nextResearchScienceGoal(RESEARCH_TREE, [], 'unknown'), null);
  assert.equal(nextResearchScienceGoal(RESEARCH_TREE, ['basic_theory'], 'basic_theory'), null);
  const malformed = [{ ...RESEARCH_TREE.find(item => item.key === 'basic_theory'), science: NaN }];
  assert.equal(nextResearchScienceGoal(malformed, [], 'basic_theory'), null);
});

test('science reward comparison keeps current shortage separate from a conditional claimed reward', () => {
  assert.deepEqual(scienceSupplyComparison({ currentScience: 40, requiredScience: 160, rewardScience: 60 }), { currentGap: 120, afterGap: 60, rewardScience: 60 });
  assert.deepEqual(scienceSupplyComparison({ currentScience: '100', requiredScience: 160, rewardScience: 120 }), { currentGap: 60, afterGap: 0, rewardScience: 120 });
  assert.deepEqual(scienceSupplyComparison({ currentScience: 200, requiredScience: 160, rewardScience: 60 }), { currentGap: 0, afterGap: 0, rewardScience: 60 });
  assert.deepEqual(scienceSupplyComparison({ currentScience: 39.5, requiredScience: 160, rewardScience: 60 }), { currentGap: 120.5, afterGap: 60.5, rewardScience: 60 });
});

test('science comparison omits unknown stock and unsafe costs instead of claiming a launch is ready', () => {
  const base = { currentScience: 10, requiredScience: 60, rewardScience: 20 };
  for (const currentScience of [null, undefined, '', ' ', {}, true, -1, NaN, Infinity]) assert.equal(scienceSupplyComparison({ ...base, currentScience }), null);
  for (const requiredScience of [-1, 0.5, NaN, Infinity]) assert.equal(scienceSupplyComparison({ ...base, requiredScience }), null);
  for (const rewardScience of [-1, 0.5, NaN, Infinity]) assert.equal(scienceSupplyComparison({ ...base, rewardScience }), null);
});

test('science guidance does not mutate projects research progress resources or their definitions', () => {
  const projects = [project('cargo_route'), project('polar_lab'), project('dawn_district')], before = structuredClone(projects);
  const catalogBefore = structuredClone(RESEARCH_TREE), completed = ['basic_theory'];
  currentScienceSupply(projects, 'polar_lab');
  nextResearchScienceGoal(RESEARCH_TREE, completed, 'precision_casting');
  const values = Object.freeze({ currentScience: 100, requiredScience: 340, rewardScience: 60 });
  scienceSupplyComparison(values);
  assert.deepEqual(projects, before); assert.deepEqual(RESEARCH_TREE, catalogBefore); assert.deepEqual(completed, ['basic_theory']);
});
