import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts')) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { BUILDINGS } = await import('../lib/game/config.ts');
const { DECOR_CATALOG } = await import('../lib/game/decor.ts');
const { APPEARANCE_OBJECTS, appearancePage, cityStyleClass, isCityStyle } = await import('../lib/game/appearance.ts');

test('the city-style browser covers every canonical building and decor type exactly once', () => {
  assert.equal(APPEARANCE_OBJECTS.length, Object.keys(BUILDINGS).length + Object.keys(DECOR_CATALOG).length);
  assert.equal(new Set(APPEARANCE_OBJECTS.map(item => item.key)).size, APPEARANCE_OBJECTS.length);
  for (const [kind, catalog] of [['building', BUILDINGS], ['decor', DECOR_CATALOG]]) {
    const seen = [];
    for (let page = 0; page < appearancePage(kind, 0).pages; page++) {
      const result = appearancePage(kind, page);
      assert.ok(result.items.length > 0 && result.items.length <= 6);
      assert.equal(result.page, page);
      for (const item of result.items) {
        assert.equal(item.kind, kind);
        assert.equal(item.name, catalog[item.type].name);
        seen.push(item.type);
      }
    }
    assert.deepEqual(seen.sort(), Object.keys(catalog).sort());
  }
});

test('stale and malformed page indices keep the style browser on an existing page', () => {
  for (const kind of ['building', 'decor']) {
    assert.equal(appearancePage(kind, -4).page, 0);
    assert.equal(appearancePage(kind, NaN).page, 0);
    assert.equal(appearancePage(kind, Infinity).page, 0);
    const last = appearancePage(kind, 999);
    assert.equal(last.page, last.pages - 1);
    assert.ok(last.items.length > 0);
    assert.equal(appearancePage(kind, .9).page, 0);
  }
});

test('only existing city-theme entitlements activate city-wide appearance classes', () => {
  for (const style of ['theme_neon', 'theme_first_signal']) {
    assert.equal(isCityStyle(style), true);
    assert.equal(cityStyleClass(style), style);
  }
  for (const style of ['weather_aurora', 'frame_orbit', 'founder_monument', 'constructor', '__proto__', 'unknown', null, {}]) {
    assert.equal(isCityStyle(style), false);
    assert.equal(cityStyleClass(style), '');
  }
});
