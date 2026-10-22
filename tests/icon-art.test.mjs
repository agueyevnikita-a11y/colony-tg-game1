import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ICON_ATLASES, LUNAR_ICONS, lunarIconByName } from '../lib/game/icon-art.ts';

test('all resources, main sections and named activities have unique shipped lunar icons', async () => {
  const required = ['ore','energy','parts','credits','crystals','science','city','research','market','missions','shop','social',
    'map','foundry','contracts','events','decor','rocket','trophy','mail','network','comfort','build','help'];
  assert.deepEqual(Object.keys(LUNAR_ICONS).sort(), required.sort());
  for (const atlas of Object.values(ICON_ATLASES)) {
    const png = await readFile(new URL(`../public${atlas.png}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), atlas.width);
    assert.equal(png.readUInt32BE(20), atlas.height);
    const webp = await readFile(new URL(`../public${atlas.src}`, import.meta.url));
    assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
    assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  }
  const crops = Object.entries(LUNAR_ICONS).map(([name, spec]) => {
    const art = lunarIconByName(name);
    assert.ok(art, name);
    const [x, y, width, height] = art.viewport;
    assert.ok(art.viewport.every(Number.isInteger) && x > 0 && y > 0 && width > 0 && height > 0, name);
    assert.ok(x + width < art.width && y + height < art.height, name);
    return { name, atlas: spec.atlas, x, y, width, height };
  });
  for (let i = 0; i < crops.length; i++) for (let j = i + 1; j < crops.length; j++) {
    const a = crops[i], b = crops[j];
    if (a.atlas === b.atlas) assert.equal(a.x < b.x + b.width && b.x < a.x + a.width
      && a.y < b.y + b.height && b.y < a.y + a.height, false, `${a.name} cannot expose ${b.name}`);
  }
});

test('utility and untrusted icon names keep the vector fallback instead of selecting atlas properties', () => {
  for (const name of [undefined,null,1,{},[],'','toString','__proto__','constructor','arrow','check','close','lock']) {
    assert.equal(lunarIconByName(name), null);
  }
});
