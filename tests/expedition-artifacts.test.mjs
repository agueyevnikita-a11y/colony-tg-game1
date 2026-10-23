import assert from 'node:assert/strict';
import test from 'node:test';
import { ARTIFACTS, ARTIFACT_DROP_WEIGHTS, EXPEDITIONS, artifactByRoll, artifactDropChance } from '../lib/game/expeditions.ts';

test('artifact selection exhaustively preserves each route distribution across all 1,000 rolls', () => {
  for (const route of EXPEDITIONS) {
    const counts = new Map();
    for (let roll = 0; roll < 1000; roll++) {
      const artifact = artifactByRoll(route.key, roll);
      assert.ok(ARTIFACTS.some((item) => item.id === artifact));
      counts.set(artifact, (counts.get(artifact) ?? 0) + 1);
    }
    assert.equal([...counts.values()].reduce((total, count) => total + count, 0), 1000);
    assert.deepEqual(Object.fromEntries(counts), Object.fromEntries(ARTIFACT_DROP_WEIGHTS[route.key].map(({ id, weight }) => [id, weight])));
  }
});

test('collection odds are probabilities per launch and respect exclusive route finds', () => {
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
  close(artifactDropChance('local_survey', 'signal_fragment'), 0.041);
  close(artifactDropChance('local_survey', 'alloy_core'), 0.009);
  assert.equal(artifactDropChance('local_survey', 'stellar_map'), 0);
  assert.equal(artifactDropChance('local_survey', 'quantum_lens'), 0);
  close(artifactDropChance('orbital_ruins', 'stellar_map'), 0.0128);
  assert.equal(artifactDropChance('orbital_ruins', 'quantum_lens'), 0);
  close(artifactDropChance('deep_signal', 'quantum_lens'), 0.0272);
  close(artifactDropChance('deep_signal', 'stellar_map'), 0.085);
  for (const route of EXPEDITIONS) {
    close(ARTIFACTS.reduce((sum, artifact) => sum + artifactDropChance(route.key, artifact.id), 0), route.artifactChance);
  }
});

test('unknown routes and corrupted rolls cannot silently award a different artifact', () => {
  assert.equal(artifactDropChance('missing', 'alloy_core'), 0);
  assert.equal(artifactDropChance('deep_signal', 'missing'), 0);
  for (const roll of [-1, 1000, 0.1, NaN, Infinity, '80', null]) {
    assert.throws(() => artifactByRoll('deep_signal', roll), /Некорректный выбор артефакта/);
  }
  for (const route of ['missing', '__proto__', 'constructor']) {
    assert.throws(() => artifactByRoll(route, 0), /Некорректный выбор артефакта/);
  }
});
