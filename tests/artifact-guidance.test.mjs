import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { artifactCollectionGuidance } = await import('../lib/game/artifact-guidance.ts');
const { ARTIFACTS, EXPEDITIONS } = await import('../lib/game/expeditions.ts');
const catalog = EXPEDITIONS.map(route => ({ key: route.key, unlocked: true }));
const collection = (...found) => ARTIFACTS.map(artifact => ({ id: artifact.id, count: found.includes(artifact.id) ? 1 : 0 }));

test('an unloaded collection has no missing goal or invented route, while a loaded empty collection does', () => {
  for (const artifacts of [undefined, null, {}, '']) {
    const result = artifactCollectionGuidance({ artifacts, routeCatalog: catalog });
    assert.equal(result.state, 'unknown');
    assert.equal(result.selected, null);
    assert.equal(result.route, null);
    assert.deepEqual(result.missing, []);
  }
  const empty = artifactCollectionGuidance({ artifacts: [], routeCatalog: catalog });
  assert.equal(empty.state, 'missing');
  assert.equal(empty.unique, 0);
  assert.equal(empty.missing.length, 4);
  assert.equal(empty.selected.id, 'signal_fragment');
  assert.equal(empty.route.key, 'local_survey');
  assert.equal(empty.route.available, true);
});

test('collection goals count different claimed finds and never advise farming duplicates when complete', () => {
  const duplicate = artifactCollectionGuidance({ artifacts: [{ id: 'signal_fragment', count: '900' }], routeCatalog: catalog });
  assert.equal(duplicate.unique, 1);
  assert.equal(duplicate.missing.length, 3);
  assert.equal(duplicate.selected.id, 'alloy_core');
  const complete = artifactCollectionGuidance({ artifacts: collection(...ARTIFACTS.map(artifact => artifact.id)), selectedArtifactId: 'signal_fragment', routeCatalog: catalog });
  assert.equal(complete.state, 'complete');
  assert.equal(complete.unique, 4);
  assert.equal(complete.selected, null);
  assert.equal(complete.route, null);
});

test('advice favors the shortest open main route, rather than promising the highest drop chance', () => {
  const result = artifactCollectionGuidance({ artifacts: collection('signal_fragment'), routeCatalog: catalog });
  assert.equal(result.selected.id, 'alloy_core');
  assert.equal(result.route.key, 'local_survey');
  assert.equal(result.route.durationSec, 900);
  assert.deepEqual(result.route.cost, { energy: 150 });
  assert.ok(Math.abs(result.route.chance - 0.009) < 1e-12);
  const longer = artifactCollectionGuidance({ artifacts: collection('signal_fragment'), routeCatalog: [{ key: 'local_survey', unlocked: false }, { key: 'orbital_ruins', unlocked: true }, { key: 'deep_signal', unlocked: true }] });
  assert.equal(longer.route.key, 'orbital_ruins');
  assert.equal(longer.route.available, true);
});

test('a locked collection target keeps its only possible route as a conditions preview', () => {
  const result = artifactCollectionGuidance({ artifacts: collection('signal_fragment', 'alloy_core', 'stellar_map'), routeCatalog: [{ key: 'local_survey', unlocked: true }, { key: 'orbital_ruins', unlocked: true }, { key: 'deep_signal', unlocked: false }] });
  assert.equal(result.selected.id, 'quantum_lens');
  assert.equal(result.route.key, 'deep_signal');
  assert.equal(result.route.available, false);
  assert.equal(result.route.durationSec, 14400);
  assert.deepEqual(result.route.cost, { energy: 900, parts: 60 });
  assert.ok(Math.abs(result.route.chance - 0.0272) < 1e-12);
});

test('the chosen missing find survives new snapshot objects and falls back only after it is found', () => {
  const before = artifactCollectionGuidance({ artifacts: collection('signal_fragment'), selectedArtifactId: 'stellar_map', routeCatalog: catalog });
  const refreshed = artifactCollectionGuidance({ artifacts: structuredClone(collection('signal_fragment')), selectedArtifactId: before.selected.id, routeCatalog: structuredClone(catalog) });
  assert.equal(refreshed.selected.id, 'stellar_map');
  assert.equal(refreshed.route.key, 'orbital_ruins');
  const found = artifactCollectionGuidance({ artifacts: collection('signal_fragment', 'stellar_map'), selectedArtifactId: before.selected.id, routeCatalog: catalog });
  assert.equal(found.selected.id, 'alloy_core');
  const invalidChoice = artifactCollectionGuidance({ artifacts: [], selectedArtifactId: '__proto__', routeCatalog: catalog });
  assert.equal(invalidChoice.selected.id, 'signal_fragment');
});

test('global locks and paused launches cannot be called open even when a route snapshot is unlocked', () => {
  for (const globalGate of [{ accessUnlocked: false }, { featureEnabled: false }, { accessUnlocked: false, featureEnabled: false }]) {
    const result = artifactCollectionGuidance({ artifacts: [], routeCatalog: catalog, ...globalGate });
    assert.equal(result.route.available, false);
    assert.equal(result.route.key, 'local_survey');
  }
});

test('malformed collection entries never invent a discovered kind', () => {
  const result = artifactCollectionGuidance({ artifacts: [null, {}, { id: 'constructor', count: 99 }, { id: 'unknown', count: 1 }, { id: 'signal_fragment', count: true }, { id: 'alloy_core', count: ' ' }, { id: 'stellar_map', count: -1 }, { id: 'quantum_lens', count: Infinity }, { id: 'alloy_core', count: 0.5 }], routeCatalog: catalog });
  assert.equal(result.state, 'missing');
  assert.equal(result.unique, 0);
  assert.equal(result.selected.id, 'signal_fragment');
});

test('missing, duplicate, or malformed route access remains a preview rather than fabricated access', () => {
  for (const routeCatalog of [undefined, null, {}, [], [null, {}, { key: 'local_survey', unlocked: 'true' }], [{ key: 'local_survey', unlocked: true }, { key: 'local_survey', unlocked: false }]]) {
    const result = artifactCollectionGuidance({ artifacts: [], routeCatalog });
    assert.equal(result.route.available, false);
    assert.equal(result.route.key, 'local_survey');
    assert.deepEqual(result.route.cost, { energy: 150 });
  }
});
