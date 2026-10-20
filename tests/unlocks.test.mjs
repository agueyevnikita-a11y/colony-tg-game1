import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function moduleSource(path) {
  const source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
}
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { FEATURE_RESEARCH, colonyUnlocks } = await import(dataUrl(await moduleSource('../lib/game/unlocks.ts')));
const configUrl = dataUrl(await moduleSource('../lib/game/config.ts'));
const { BUILDINGS } = await import(configUrl);
const researchSource = (await moduleSource('../lib/game/research.ts')).replace(/from ['"]\.\/config['"]/g, `from '${configUrl}'`);
const { RESEARCH_TREE } = await import(dataUrl(researchSource));

test('new colonies need the specific completed technology for each separate feature', () => {
  const fresh = colonyUnlocks([]);
  assert.equal(fresh.market.unlocked, false);
  assert.equal(fresh.expeditions.unlocked, false);
  for (const completed of [[], ['basic_theory', 'deep_navigation', 'trade_net'], ['unrelated']]) {
    const state = colonyUnlocks(completed);
    assert.equal(state.market.unlocked, false);
    assert.equal(state.expeditions.unlocked, false);
  }
  const market = colonyUnlocks(['trade_network']);
  assert.equal(market.market.unlocked, true);
  assert.equal(market.market.legacy, false);
  assert.equal(market.expeditions.unlocked, false);
  const expeditions = colonyUnlocks(new Set(['expedition_protocols']));
  assert.equal(expeditions.market.unlocked, false);
  assert.equal(expeditions.expeditions.unlocked, true);
});

test('legacy access preserves only explicitly granted features without requiring research', () => {
  const retained = colonyUnlocks([], ['market', 'unknown']);
  assert.equal(retained.market.unlocked, true);
  assert.equal(retained.market.legacy, true);
  assert.equal(retained.expeditions.unlocked, false);
  assert.equal(retained.expeditions.legacy, false);
  const both = colonyUnlocks(['trade_network'], ['market', 'expeditions']);
  assert.equal(both.market.unlocked, true);
  assert.equal(both.expeditions.unlocked, true);
  assert.equal(both.market.legacy, true);
  assert.equal(both.expeditions.legacy, true);
});

test('feature gate requirements point at attainable research and the expedition building agrees with its gate', () => {
  for (const [feature, config] of Object.entries(FEATURE_RESEARCH)) {
    const technology = RESEARCH_TREE.find((entry) => entry.key === config.researchKey);
    assert.ok(technology, `Missing research for ${feature}`);
    assert.equal(technology.unlockFeature, feature);
    assert.equal(technology.name, config.name);
    assert.ok(technology.prereqs.includes('basic_theory'));
    assert.ok(technology.unlockHq <= (feature === 'market' ? 2 : 3));
    assert.ok(technology.labLevel <= 1);
    assert.ok(technology.science > 0 && technology.timeSec > 0);
  }
  assert.equal(BUILDINGS.expedition_center.unlockResearch, FEATURE_RESEARCH.expeditions.researchKey);
  assert.equal(RESEARCH_TREE.find((entry) => entry.key === FEATURE_RESEARCH.expeditions.researchKey).unlockBuilding, 'expedition_center');
});
