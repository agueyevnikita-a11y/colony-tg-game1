import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPPLY_PROJECTS, SUPPLY_PROJECT_REQUIRED_HQ, parseSupplyProjectRequest, remainingSupplyRequirements,
} from '../lib/game/supply-projects.ts';
import { quoteFoundry, FOUNDRY_RECIPES } from '../lib/game/foundry.ts';
import { supplyProductionPlan } from '../lib/game/supply-production.ts';

const requestId = 'ABCDEFAB-1234-4234-8234-ABCDEFABCDEF';
const delivery = { action: 'deliver', requestId, projectKey: 'cargo_route', definitionVersion: 1, expectedStage: 0, resource: 'parts', amount: 1 };

test('supply projects are finite lunar goals with explicit stage requirements and bounded non-storage rewards', () => {
  assert.equal(SUPPLY_PROJECT_REQUIRED_HQ, 3);
  assert.deepEqual(SUPPLY_PROJECTS.map(project => project.id).sort(), ['cargo_route', 'dawn_district', 'polar_lab']);
  const titles = [], rewardKeys = new Set(['credits', 'science', 'crystals', 'cosmeticIds']);
  let crystals = 0;
  for (const project of SUPPLY_PROJECTS) {
    assert.equal(project.version, 1);
    assert.equal(project.stages.length, 3);
    for (const [index, stage] of project.stages.entries()) {
      assert.deepEqual(Object.keys(stage.requirements).sort(), ['energy', 'ore', 'parts']);
      for (const amount of Object.values(stage.requirements)) assert.ok(Number.isSafeInteger(amount) && amount > 0);
      for (const [key, amount] of Object.entries(stage.reward)) {
        assert.ok(rewardKeys.has(key), `Unexpected reward resource ${key}`);
        if (key !== 'cosmeticIds') assert.ok(Number.isSafeInteger(amount) && amount >= 0);
      }
      crystals += stage.reward.crystals;
      if (index < 2) assert.deepEqual(stage.reward.cosmeticIds, []);
      else titles.push(...stage.reward.cosmeticIds);
    }
  }
  assert.equal(crystals, 55, 'The complete fixed release cannot become an unlimited crystal source');
  assert.equal(new Set(titles).size, 3);
  assert.ok(titles.every(id => id.startsWith('title_')));
});

test('supply request validation preserves intent, normalizes receipts and accepts explicit amount boundaries', () => {
  const parsed = parseSupplyProjectRequest(delivery);
  assert.deepEqual(parsed, { ...delivery, requestId: requestId.toLowerCase() });
  assert.equal(delivery.requestId, requestId);
  assert.equal(parseSupplyProjectRequest({ ...delivery, amount: 1_000_000 }).amount, 1_000_000);
  assert.deepEqual(parseSupplyProjectRequest({ action: 'claim', requestId, projectKey: 'polar_lab', definitionVersion: 1, expectedStage: 2 }),
    { action: 'claim', requestId: requestId.toLowerCase(), projectKey: 'polar_lab', definitionVersion: 1, expectedStage: 2 });
});

test('supply request validation rejects malformed bodies and unsafe resource, version, stage and amount values', () => {
  for (const input of [null, undefined, [], '', 0, false, {}]) assert.throws(() => parseSupplyProjectRequest(input));
  for (const patch of [
    { action: 'start' }, { action: 'claim-all' }, { requestId: 'invalid' }, { requestId: null },
    { projectKey: 'other-player-project' }, { definitionVersion: 0 }, { definitionVersion: 1.1 }, { definitionVersion: '1' },
    { expectedStage: -1 }, { expectedStage: 3 }, { expectedStage: 0.5 }, { expectedStage: '0' },
    { resource: 'credits' }, { resource: null }, { amount: 0 }, { amount: -1 }, { amount: 0.5 },
    { amount: '1' }, { amount: 1_000_001 }, { amount: Infinity }, { amount: NaN },
  ]) assert.throws(() => parseSupplyProjectRequest({ ...delivery, ...patch }), JSON.stringify(patch));
});

test('remaining shipment requirements are independent per resource and never advertise a negative quota', () => {
  const required = { ore: 300, energy: 100, parts: 70 }, delivered = { ore: 17, energy: 100, parts: 80 };
  assert.deepEqual(remainingSupplyRequirements(required, delivered), { ore: 283, energy: 0, parts: 0 });
  assert.deepEqual(delivered, { ore: 17, energy: 100, parts: 80 });
});

test('supply production planning uses the real researched recipe output rather than a fixed parts-per-cycle assumption', () => {
  for (const recipe of FOUNDRY_RECIPES) for (const level of [1, 7, 15]) for (const multiplier of [1, 1.1]) {
    const quote = quoteFoundry({ recipe: recipe.id, level, mode: 'standard', link: 'none', cycles: 1, partsMultiplier: multiplier });
    const input = { requiredParts: 50 + 70 + quote.cycleParts * 3 - 1, currentParts: 50, queuedParts: 70, cycleParts: quote.cycleParts, freeSlots: 6 };
    const before = structuredClone(input), plan = supplyProductionPlan(input);
    assert.equal(plan.missingParts, quote.cycleParts * 3 - 1);
    assert.equal(plan.neededCycles, 3);
    assert.equal(plan.suggestedCycles, 3);
    assert.equal(plan.batchParts, quote.cycleParts * 3);
    assert.equal(plan.remainingAfterBatch, 0);
    assert.equal(plan.surplusParts, 1);
    assert.deepEqual(input, before, 'Planning must not mutate production settings or inventory');
  }
});

test('supply production planning respects covered stock, all queued output and the currently free queue slots', () => {
  const base = { requiredParts: 300, currentParts: 50, queuedParts: 50, cycleParts: 35, freeSlots: 2 };
  const limited = supplyProductionPlan(base);
  assert.equal(limited.neededCycles, 6);
  assert.equal(limited.suggestedCycles, 2);
  assert.equal(limited.batchParts, 70);
  assert.equal(limited.remainingAfterBatch, 130);
  const full = supplyProductionPlan({ ...base, freeSlots: 0 });
  assert.equal(full.suggestedCycles, 0);
  assert.equal(full.batchParts, 0);
  assert.equal(full.remainingAfterBatch, 200);
  const covered = supplyProductionPlan({ ...base, queuedParts: 250 });
  assert.equal(covered.missingParts, 0);
  assert.equal(covered.suggestedCycles, 0);
  assert.equal(covered.surplusParts, 0);
  assert.equal(supplyProductionPlan({ ...base, requiredParts: 0 }).suggestedCycles, 0);
  for (const patch of [{ requiredParts: -1 }, { currentParts: 0.5 }, { queuedParts: NaN }, { cycleParts: 0 }, { freeSlots: -1 }, { freeSlots: 13 }]) {
    assert.throws(() => supplyProductionPlan({ ...base, ...patch }));
  }
  assert.throws(() => supplyProductionPlan({ ...base, requiredParts: Number.MAX_SAFE_INTEGER, currentParts: 0, queuedParts: 0, cycleParts: Number.MAX_SAFE_INTEGER - 1, freeSlots: 12 }));
});
