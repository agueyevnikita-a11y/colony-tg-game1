import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = new Map();

// Render the actual TSX tree and its actual building/decor components. CSS has
// no server markup; loading it does not require an application or game server.
function renderer(filename) {
  filename = resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(root);
  loaded.require = specifier => {
    if (specifier.endsWith('.css')) return {};
    if (specifier.startsWith('@/') || specifier.startsWith('.')) {
      const base = specifier.startsWith('@/') ? resolve(root, specifier.slice(2)) : resolve(dirname(filename), specifier);
      const target = extname(base) ? base : ['.tsx', '.ts'].map(extension => base + extension).find(existsSync);
      if (!target) throw new Error(`Missing preview dependency: ${specifier}`);
      return renderer(target);
    }
    return require(specifier);
  };
  cache.set(filename, loaded);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  });
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}

const { CosmeticPreview, CosmeticMonument } = renderer(resolve(root, 'components/CosmeticAppearance.tsx'));
const preview = props => renderToStaticMarkup(React.createElement(CosmeticPreview, props));

test('the unselected monument preview shows the ordinary base without a ghost statue', () => {
  const html = preview({ cosmeticId: '', category: 'building_skin' });
  assert.match(html, /aria-label="Монумент не выбран"/);
  assert.match(html, /data-building-art="foundry"/);
  assert.doesNotMatch(html, /data-decor-art="statue"|founderMonumentArt|cosmeticMonumentArt/);
  assert.equal(renderToStaticMarkup(React.createElement(CosmeticMonument, { id: '' })), '');
});

test('selecting a real monument still displays its specific artwork', () => {
  const founder = preview({ cosmeticId: 'founder_monument', category: 'building_skin' });
  assert.match(founder, /founderMonumentArt/);
  assert.match(founder, /founder-monument\.webp/);
  const network = preview({ cosmeticId: 'monument_network', category: 'building_skin' });
  assert.match(network, /cosmeticMonumentArt isNetworkMonument/);
  const relay = preview({ cosmeticId: 'relay_legend', category: 'building_skin' });
  assert.match(relay, /cosmeticMonumentArt isRelayMonument/);
  assert.doesNotMatch(founder + network + relay, /Монумент не выбран/);
});

test('a known earned legacy monument retains its canonical statue renderer', () => {
  const html = preview({ cosmeticId: 'monument_alliance_relay', category: 'building_skin', label: 'Монумент альянса' });
  assert.match(html, /data-decor-art="statue"/);
  assert.match(html, /aria-label="Монумент альянса"/);
});

test('the Founder Pack preview retains its combined monument, sky, frame and badge', () => {
  const html = preview({ cosmeticId: 'founder_pack', label: 'Набор основателя' });
  for (const marker of ['founderMonumentArt', 'isFounderSky', 'founder_frame', 'isFounderBadge']) assert.ok(html.includes(marker), marker);
});

test('city-style comparisons render the requested shared subject without adding a monument', () => {
  const subject = { key: 'building:foundry', kind: 'building', type: 'foundry', name: 'Литейный цех' };
  for (const cosmeticId of ['', 'theme_neon', 'theme_first_signal']) {
    const html = preview({ cosmeticId, category: 'theme', subject });
    assert.equal((html.match(/data-building-art="foundry"/g) ?? []).length, 1);
    assert.match(html, /data-preview-subject="building:foundry"/);
    assert.doesNotMatch(html, /data-decor-art="statue"|founderMonumentArt|cosmeticMonumentArt/);
  }
});
