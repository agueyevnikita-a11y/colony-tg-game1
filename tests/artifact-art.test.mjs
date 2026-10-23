import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ARTIFACTS } from '../lib/game/expeditions.ts';
import { ARTIFACT_ART, artifactArtByIcon, artifactArtById, artifactCollectionCounts } from '../lib/game/artifact-art.ts';

test('every collectible has a distinct shipped transparent WebP and consistent icon', async () => {
  assert.deepEqual(Object.keys(ARTIFACT_ART).sort(), ARTIFACTS.map(item => item.id).sort());
  const paths = new Set(), icons = new Set();
  for (const artifact of ARTIFACTS) {
    const art = artifactArtById(artifact.id);
    paths.add(art.src); icons.add(art.iconName);
    assert.equal(artifactArtByIcon(art.iconName), art);
    const file = await readFile(new URL(`../public${art.src}`, import.meta.url));
    assert.equal(file.subarray(0, 4).toString(), 'RIFF');
    assert.equal(file.subarray(8, 12).toString(), 'WEBP');
    assert.equal(file.subarray(12, 16).toString(), 'VP8X');
    assert.equal(file[20] & 0x10, 0x10, 'alpha channel is retained');
    assert.equal(file.readUIntLE(24, 3) + 1, art.width);
    assert.equal(file.readUIntLE(27, 3) + 1, art.height);
    assert.ok(file.length > 1000 && file.length < 150000, 'small game asset, not a missing placeholder or full-size generation');
  }
  assert.equal(paths.size, 4); assert.equal(icons.size, 4);
});

test('untrusted artifact names cannot select inherited art properties', () => {
  for (const value of [undefined, null, {}, [], 1, '', 'constructor', '__proto__', 'toString', 'unknown']) {
    assert.equal(artifactArtById(value), null);
    assert.equal(artifactArtByIcon(value), null);
  }
});

test('collection progress counts known discovered kinds, preserving repeats without inventing finds', () => {
  assert.equal(artifactCollectionCounts(undefined).unique, 0);
  const result = artifactCollectionCounts([
    {id:'signal_fragment',count:'5'}, {id:'alloy_core',count:0},
    {id:'stellar_map',count:-1}, {id:'quantum_lens',count:1},
    {id:'toString',count:100}, {id:'unknown',count:1},
  ]);
  assert.equal(result.total, 4); assert.equal(result.unique, 2);
  assert.equal(result.counts.get('signal_fragment'), 5);
  assert.equal(result.counts.has('stellar_map'), false);
  assert.equal(result.counts.has('unknown'), false);
  assert.equal(artifactCollectionCounts([{id:'alloy_core',count:Infinity},{id:'stellar_map',count:0.5}]).unique, 0);
});
