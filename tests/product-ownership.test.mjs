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
const { FOUNDER_COSMETIC_IDS, permanentProductOwned } = await import('../lib/game/product-ownership.ts');

const permanent = (id) => ({ cosmetic_id: id, expires_at: null });
const temporary = (id, expires_at = '2099-01-01T00:00:00Z') => ({ cosmetic_id: id, expires_at });

test('permanent cosmetic ownership blocks only that product, including unequipped items', () => {
  assert.equal(permanentProductOwned('theme_neon', []), false);
  assert.equal(permanentProductOwned('theme_neon', [permanent('frame_orbit')]), false);
  assert.equal(permanentProductOwned('theme_neon', [{ ...permanent('theme_neon'), equipped: false }]), true);
  assert.equal(permanentProductOwned('theme_neon', [temporary('theme_neon')]), false);
  assert.equal(permanentProductOwned('theme_neon', [temporary('theme_neon', '2000-01-01T00:00:00Z')]), false);
});

test('Founder Pack blocks only when every item is permanently owned', () => {
  assert.equal(permanentProductOwned('founder_pack', []), false);
  for (const missing of FOUNDER_COSMETIC_IDS) {
    const partial = FOUNDER_COSMETIC_IDS.filter((id) => id !== missing).map(permanent);
    assert.equal(permanentProductOwned('founder_pack', partial), false);
    assert.equal(permanentProductOwned('founder_pack', [...partial, temporary(missing)]), false);
  }
  assert.equal(permanentProductOwned('founder_pack', FOUNDER_COSMETIC_IDS.map(permanent)), true);
});

test('Premium renewal stays available regardless of permanent cosmetic ownership', () => {
  assert.equal(permanentProductOwned('premium_30d', FOUNDER_COSMETIC_IDS.map(permanent)), false);
});

test('unknown and inherited product identifiers are never treated as owned products', () => {
  for (const productId of ['constructor', 'toString', '__proto__', 'missing', null, {}]) {
    assert.equal(permanentProductOwned(productId, FOUNDER_COSMETIC_IDS.map(permanent)), false);
  }
});
