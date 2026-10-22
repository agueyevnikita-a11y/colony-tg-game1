import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { INDUSTRY_ATLAS, industrySpriteByType } from '../lib/game/industry-art.ts';

test('distinct industrial sprites fit the shipped transparent atlas without exposing neighbours', async () => {
  const png = await readFile(new URL('../public/art/industry-buildings-v111.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), INDUSTRY_ATLAS.width);
  assert.equal(png.readUInt32BE(20), INDUSTRY_ATLAS.height);
  const webp = await readFile(new URL(`../public${INDUSTRY_ATLAS.src}`, import.meta.url));
  assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  const crops = ['solar', 'warehouse', 'trade_hub', 'logistics'].map(type => {
    const crop = industrySpriteByType(type);
    assert.ok(crop, type);
    const [x, y, width, height] = crop;
    assert.ok(crop.every(Number.isInteger) && x >= 0 && y >= 0 && width > 0 && height > 0, type);
    assert.ok(x + width <= INDUSTRY_ATLAS.width && y + height <= INDUSTRY_ATLAS.height, type);
    return { type, x, y, width, height };
  });
  for (let i = 0; i < crops.length; i++) for (let j = i + 1; j < crops.length; j++) {
    const a = crops[i], b = crops[j];
    assert.equal(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height,
      false, `${a.type} must not expose ${b.type}`);
  }
});

test('non-industrial and inherited keys cannot select an industrial sprite', () => {
  for (const type of [undefined, null, 1, {}, [], '', 'toString', '__proto__', 'constructor', 'solar_array', 'unknown']) {
    assert.equal(industrySpriteByType(type), null);
  }
});
