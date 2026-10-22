import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DECOR_ATLAS, decorSpriteByType } from '../lib/game/decor-art.ts';
import { DECOR_CATALOG } from '../lib/game/decor.ts';

test('every saved decor type has an isolated viewport inside the shipped lunar atlas', async () => {
  const png = await readFile(new URL('../public/art/lunar-decor-atlas.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), DECOR_ATLAS.width);
  assert.equal(png.readUInt32BE(20), DECOR_ATLAS.height);
  const webp = await readFile(new URL(`../public${DECOR_ATLAS.src}`, import.meta.url));
  assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  const crops = Object.keys(DECOR_CATALOG).map(type => {
    const crop = decorSpriteByType(type);
    assert.ok(crop, type);
    const [x, y, width, height] = crop;
    assert.ok(crop.every(Number.isInteger) && x >= 0 && y >= 0 && width > 0 && height > 0, type);
    assert.ok(x + width <= DECOR_ATLAS.width && y + height <= DECOR_ATLAS.height, type);
    return { type, x, y, width, height };
  });
  for (let i = 0; i < crops.length; i++) for (let j = i + 1; j < crops.length; j++) {
    const a = crops[i], b = crops[j];
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    assert.equal(overlap, false, `${a.type} must not expose ${b.type}`);
  }
});

test('unknown decor art keys use the neutral fallback, including inherited property names', () => {
  for (const type of [undefined, null, 1, {}, [], '', 'toString', '__proto__', 'constructor', 'unknown']) assert.equal(decorSpriteByType(type), null);
});
