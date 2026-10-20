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
const { DECOR_CATALOG, decorByType, decorCoordinates, decorRequirements } = await import('../lib/game/decor.ts');
const { calculateComfort, comfortPlacementGain } = await import('../lib/game/comfort.ts');

test('comfort rewards variety, gives half for the second object, and never rewards further copies', () => {
  assert.equal(calculateComfort([]).score, 0);
  for (const [type, config] of Object.entries(DECOR_CATALOG)) {
    const once = [{ type }];
    const twice = [...once, { type }];
    assert.equal(calculateComfort(once).score, config.comfort);
    assert.equal(comfortPlacementGain([], type), config.comfort);
    assert.equal(comfortPlacementGain(once, type), Math.floor(config.comfort / 2));
    assert.equal(calculateComfort(twice).score, config.comfort + Math.floor(config.comfort / 2));
    assert.equal(comfortPlacementGain(twice, type), 0);
    assert.equal(calculateComfort([...twice, { type }, { type }]).score, calculateComfort(twice).score);
  }
});

test('comfort stays within 0..100, reports actual counts, and excludes shop cosmetics and unknown types', () => {
  const all = Object.keys(DECOR_CATALOG).map(type => ({ type }));
  const items = [...all, ...all, { type: 'theme_neon' }, { type: 'founder_monument' }, { type: '__proto__' }];
  const snapshot = JSON.stringify(items);
  const summary = calculateComfort(items);
  assert.equal(summary.score, 100);
  assert.equal(summary.rawScore, 123);
  assert.equal(summary.unique, 9);
  assert.equal(summary.total, 18);
  assert.ok(Object.values(summary.counts).every(count => count === 2));
  assert.equal(summary.nextMilestone, null);
  assert.equal(comfortPlacementGain(items, 'road'), 0);
  assert.equal(calculateComfort([{ type: 'founder_monument' }, { type: 'theme_neon' }]).score, 0);
  assert.equal(JSON.stringify(items), snapshot);
});

test('placement previews respect the remaining comfort cap and next achievement threshold', () => {
  const all = Object.keys(DECOR_CATALOG).map(type => ({ type }));
  const almostFull = [...all, { type: 'park' }, { type: 'statue' }, { type: 'bench' }];
  assert.equal(calculateComfort(almostFull).score, 97);
  assert.equal(comfortPlacementGain(almostFull, 'flowerbed'), 3);
  assert.equal(comfortPlacementGain(almostFull, 'unknown'), 0);
  assert.equal(calculateComfort([{ type: 'park' }, { type: 'statue' }]).nextMilestone.target, 25);
  assert.equal(calculateComfort([{ type: 'park' }, { type: 'statue' }, { type: 'tree' }]).nextMilestone.target, 50);
});

test('legacy decoration keeps its HQ rules and only new advanced objects need research', () => {
  const legacy = { road: 1, tree: 1, lamp: 2, park: 3, statue: 4 };
  for (const [type, hq] of Object.entries(legacy)) {
    const config = decorByType(type);
    assert.equal(config.unlockHq, hq);
    assert.equal(config.unlockResearch, undefined);
    assert.equal(decorRequirements(config, hq, []).unlocked, true);
  }
  assert.equal(decorRequirements(DECOR_CATALOG.bench, 2, []).unlocked, true);
  assert.equal(decorRequirements(DECOR_CATALOG.flowerbed, 2, []).unlocked, false);
  assert.equal(decorRequirements(DECOR_CATALOG.flowerbed, 2, ['urban_ecology']).unlocked, true);
  assert.equal(decorRequirements(DECOR_CATALOG.fountain, 2, ['public_spaces']).unlocked, false);
  assert.equal(decorRequirements(DECOR_CATALOG.fountain, 3, ['public_spaces']).unlocked, true);
  assert.equal(decorRequirements(DECOR_CATALOG.plaza, NaN, ['public_spaces']).unlocked, false);
});

test('decoration catalog rejects inherited object properties and coordinates reject coercion or truncation', () => {
  for (const type of ['__proto__', 'constructor', 'toString', '', null, {}, 1]) assert.equal(decorByType(type), null);
  assert.deepEqual(decorCoordinates(0, 5, 6), { x: 0, y: 5 });
  for (const [x, y] of [[null, 0], ['1', 0], [undefined, 0], [false, 0], [1.5, 1], [Infinity, 0], [NaN, 0], [-1, 0], [0, 6]]) {
    assert.throws(() => decorCoordinates(x, y, 6));
  }
  assert.throws(() => decorCoordinates(0, 0, Infinity));
});
