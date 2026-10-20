import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { RESEARCH_TREE, productionMultipliers } = await import('../lib/game/research.ts');
const { BUILDINGS } = await import('../lib/game/config.ts');
const { calculatePassiveGain } = await import('../lib/game/economy.ts');
const { FOUNDRY_RECIPES } = await import('../lib/game/foundry.ts');

test('every technology and building blueprint has an obtainable, acyclic prerequisite path', () => {
  const keys = new Set(RESEARCH_TREE.map(item => item.key));
  assert.equal(keys.size, RESEARCH_TREE.length);
  function visit(key, path = []) {
    assert.ok(!path.includes(key), `Research cycle: ${[...path, key].join(' -> ')}`);
    const technology = RESEARCH_TREE.find(item => item.key === key);
    assert.ok(technology, `Missing prerequisite ${key}`);
    assert.ok(technology.labLevel <= BUILDINGS.research_lab.maxLevel);
    for (const prerequisite of technology.prereqs) visit(prerequisite, [...path, key]);
  }
  for (const technology of RESEARCH_TREE) {
    visit(technology.key);
    if (technology.unlockBuilding) {
      assert.equal(BUILDINGS[technology.unlockBuilding].unlockResearch, technology.key);
      assert.ok(BUILDINGS[technology.unlockBuilding].unlockHq >= technology.unlockHq);
    }
    if (technology.unlockRecipe) {
      assert.equal(FOUNDRY_RECIPES.find(recipe => recipe.id === technology.unlockRecipe)?.requiredResearch, technology.key);
    }
  }
  for (const config of Object.values(BUILDINGS)) {
    if (config.unlockResearch) assert.ok(keys.has(config.unlockResearch));
  }
  for (const recipe of FOUNDRY_RECIPES) {
    if (recipe.requiredResearch) assert.ok(RESEARCH_TREE.some(item => item.key === recipe.requiredResearch && item.unlockRecipe === recipe.id));
  }
});

test('advanced resource buildings produce at their advertised rate and retain research bonuses', () => {
  const buildings = [
    { type: 'deep_mine', level: 1, status: 'active' },
    { type: 'solar_array', level: 1, status: 'active' },
    { type: 'deep_mine', level: 12, status: 'building' },
  ];
  const baseline = calculatePassiveGain({ buildings, hoursElapsed: 1, premium: false });
  assert.deepEqual(baseline, { ore: 300, energy: 250, credits: 0 });
  const effects = productionMultipliers(new Set(['extraction_ai', 'solar_lattice']));
  const upgraded = calculatePassiveGain({ buildings, hoursElapsed: 1, premium: false,
    resourceMultipliers: { ore: effects.ore, energy: effects.energy } });
  assert.ok(Math.abs(upgraded.ore - 321) < 1e-9);
  assert.ok(Math.abs(upgraded.energy - 267.5) < 1e-9);
});
