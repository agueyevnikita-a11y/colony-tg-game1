import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { createProductionNetwork, foundryLinksPreview } = await import('../lib/game/production-network.ts');
const { FOUNDRY_RECIPES, FOUNDRY_MODES, quoteFoundry } = await import('../lib/game/foundry.ts');
const b = (id, type, x, y, extra = {}) => ({ id, type, x, y, status: 'active', level: 1, ...extra });
const edgeKeys = edges => edges.map(edge => `${edge.foundryId}:${edge.supplierId}:${edge.resource}`).sort();
const resources = links => [...links].sort();

test('production overlay connects each active cardinal supplier to a foundry and never connects roads or chains', () => {
  const buildings = [b('f', 'foundry', 2, 2), b('f2', 'foundry', 4, 2), b('m', 'mine', 3, 2),
    b('deep', 'deep_mine', 1, 2), b('reactor', 'solar', 2, 1), b('array', 'solar_array', 2, 3),
    b('diagonal', 'mine', 3, 3), b('far', 'solar', 0, 2), b('warehouse', 'warehouse', 4, 1)];
  const decor = [{ type: 'road', x: 3, y: 1 }, { type: 'plaza', x: 4, y: 3 }];
  const edges = createProductionNetwork(buildings, decor, 6).edges;
  assert.deepEqual(edgeKeys(edges), ['f2:m:ore', 'f:array:energy', 'f:deep:ore', 'f:m:ore', 'f:reactor:energy']);
  assert.ok(edges.every(edge => Math.abs(edge.from.x - edge.to.x) + Math.abs(edge.from.y - edge.to.y) === 1));
  assert.deepEqual(edges.find(edge => edge.supplierId === 'reactor').from, { x: 2, y: 1 });
  assert.deepEqual(edges.find(edge => edge.supplierId === 'reactor').to, { x: 2, y: 2 });
});

test('busy foundries and busy suppliers never advertise an immediately usable production link', () => {
  for (const status of ['building', 'upgrading']) {
    const foundry = b('f', 'foundry', 1, 1);
    const city = [foundry, b('m', 'mine', 1, 0, { status }), b('s', 'solar', 0, 1, { status })];
    assert.deepEqual(createProductionNetwork(city, [], 4).edges, []);
    assert.deepEqual(foundryLinksPreview(foundry, city).options, []);
    const busyFoundry = { ...foundry, status };
    assert.deepEqual(createProductionNetwork([busyFoundry, b('ready', 'mine', 1, 0)], [], 4).edges, []);
    assert.equal(foundryLinksPreview(busyFoundry, city), null);
  }
  assert.equal(foundryLinksPreview(b('not-a-foundry', 'mine', 1, 1), []), null);
  assert.equal(foundryLinksPreview(b('invalid-level', 'foundry', 1, 1, { level: 16 }), []), null);
});

test('map bounds and visible occupancy prevent hidden or malformed rows creating phantom links', () => {
  const city = [b('f', 'foundry', 0, 0), b('outside', 'mine', -1, 0), b('fractional', 'solar', .5, .5),
    b('nan', 'mine', NaN, 1), b('invisible', 'mine', 1, 0), b('visible', 'warehouse', 1, 0), b('valid', 'solar', 0, 1)];
  assert.deepEqual(edgeKeys(createProductionNetwork(city, [], 2).edges), ['f:valid:energy']);
  for (const size of [0, -1, NaN, 2.5]) {
    const network = createProductionNetwork(city, [], size);
    assert.deepEqual(network.edges, []);
    assert.equal(network.placement(1, 1).available, false);
  }
});

test('candidate placement predicts real adjacent links without placing a building or changing its inputs', () => {
  const city = [b('ore', 'mine', 1, 0), b('energy', 'solar_array', 0, 1), b('far', 'mine', 3, 0)];
  const decor = [{ type: 'road', x: 2, y: 2 }], original = structuredClone({ city, decor });
  const network = createProductionNetwork(city, decor, 4), candidate = network.placement(1, 1);
  assert.equal(candidate.available, true);
  assert.equal(candidate.foundry.level, 1);
  assert.deepEqual(resources(candidate.links), ['energy', 'ore']);
  assert.deepEqual(edgeKeys(candidate.edges), edgeKeys(createProductionNetwork([...city, candidate.foundry], decor, 4).edges));
  const empty = network.placement(3, 3);
  assert.equal(empty.available, true);
  assert.deepEqual(empty.links, []);
  assert.deepEqual(empty.edges, []);
  assert.deepEqual(network.edges, []);
  assert.deepEqual({ city, decor }, original);
});

test('moving a foundry previews its new position and preserves its identity and real level', () => {
  const foundry = b('moving', 'foundry', 1, 1, { level: 6 });
  const city = [foundry, b('old-neighbor', 'mine', 1, 0), b('new-neighbor', 'solar', 4, 3)];
  const original = structuredClone(city), network = createProductionNetwork(city, [], 6);
  assert.deepEqual(edgeKeys(network.edges), ['moving:old-neighbor:ore']);
  const candidate = network.placement(4, 4, foundry.id);
  assert.equal(candidate.available, true);
  assert.deepEqual(candidate.foundry, { ...foundry, x: 4, y: 4 });
  assert.deepEqual(candidate.links, ['energy']);
  assert.deepEqual(edgeKeys(candidate.edges), ['moving:new-neighbor:energy']);
  assert.equal(candidate.edges.some(edge => edge.supplierId === 'old-neighbor'), false);
  assert.deepEqual(city, original);
});

test('occupied, decorated, out-of-bounds and unavailable moving candidates cannot be confirmed', () => {
  const city = [b('f', 'foundry', 1, 1), b('mine', 'mine', 2, 1), b('busy', 'foundry', 3, 3, { status: 'upgrading' })];
  const network = createProductionNetwork(city, [{ x: 0, y: 0, type: 'road' }], 4);
  for (const [x, y, moving] of [[1, 1], [2, 1], [0, 0], [-1, 1], [4, 1], [1.5, 1], [NaN, 1],
    [2, 2, 'missing'], [2, 2, 'mine'], [2, 2, 'busy'], [1, 1, 'f']]) {
    assert.deepEqual(network.placement(x, y, moving), { available: false, foundry: null, links: [], edges: [] });
  }
});

test('each resource has one alternative even with multiple suppliers, so discounts never stack or combine', () => {
  const foundry = b('f', 'foundry', 2, 2), city = [foundry, b('m1', 'mine', 1, 2), b('m2', 'deep_mine', 3, 2), b('s', 'solar', 2, 1)];
  const preview = foundryLinksPreview(foundry, city);
  assert.deepEqual(preview.base, { ore: 100, energy: 40 });
  assert.deepEqual(preview.options.map(option => [option.link, option.before, option.after, option.saving]), [['ore', 100, 85, 15], ['energy', 40, 32, 8]]);
  assert.deepEqual(preview.options.find(option => option.link === 'ore').supplierIds, ['m1', 'm2']);
  assert.deepEqual(preview.options.find(option => option.link === 'energy').supplierIds, ['s']);
  assert.equal(preview.options.some(option => option.link === 'both'), false);
});

test('preview keeps actual single-cycle rounding across all recipes and modes without changing output or duration', () => {
  for (const level of [1, 6, 15]) for (const recipe of FOUNDRY_RECIPES) for (const mode of FOUNDRY_MODES) {
    const foundry = b('f', 'foundry', 2, 2, { level });
    const city = [foundry, b('m', 'mine', 1, 2), b('s', 'solar', 2, 1)];
    const parameters = { recipe: recipe.id, mode: mode.id, partsMultiplier: 1.1 };
    const original = structuredClone(city), preview = foundryLinksPreview(foundry, city, parameters);
    const base = quoteFoundry({ level, ...parameters, cycles: 1, link: 'none' });
    assert.deepEqual(preview.base, { ore: base.ore, energy: base.energy });
    for (const option of preview.options) {
      const linked = quoteFoundry({ level, ...parameters, cycles: 1, link: option.link });
      assert.equal(option.before, base[option.resource]);
      assert.equal(option.after, linked[option.resource]);
      assert.equal(option.saving, base[option.resource] - linked[option.resource]);
      assert.equal(linked[option.link === 'ore' ? 'energy' : 'ore'], base[option.link === 'ore' ? 'energy' : 'ore']);
      assert.equal(linked.parts, base.parts);
      assert.equal(linked.seconds, base.seconds);
    }
    assert.deepEqual(city, original);
  }
  const foundry = b('f', 'foundry', 1, 1), city = [foundry, b('m', 'mine', 0, 1), b('s', 'solar', 1, 0)];
  const precise = foundryLinksPreview(foundry, city, { recipe: 'precision_casting', mode: 'economy' });
  assert.equal(precise.options.find(option => option.link === 'ore').after, 60);
  assert.equal(precise.options.find(option => option.link === 'energy').before, 57);
  assert.equal(precise.options.find(option => option.link === 'energy').after, 45);
  assert.equal(precise.options.find(option => option.link === 'energy').saving, 12);
});
