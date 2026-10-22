import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts')) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { LOCAL_PROFILES, localProfileByKey, localProfilesAvailable, parseLocalProfileSelection,
  LOCAL_DEVELOPED_BUILDINGS, LOCAL_DEVELOPED_RESEARCH } = await import('../lib/server/local-profiles.ts');
const { BUILDINGS } = await import('../lib/game/config.ts');
const { RESEARCH_TREE } = await import('../lib/game/research.ts');
const { GET, POST } = await import('../app/api/local/profiles/route.ts');
const localEnvironment = {
  NODE_ENV: 'development', ALLOW_DEV_AUTH: 'true', NEXT_PUBLIC_LOCAL_DEV: 'true',
  DATABASE_URL: 'postgres://colony_local:test-password@127.0.0.1:55432/colony_local',
};
const request = (headers = {}, url = 'http://127.0.0.1:3015/api/local/profiles') => new Request(url, { headers });

test('scenario catalog exposes only three reserved local identities and accepts strict keys', () => {
  assert.deepEqual(LOCAL_PROFILES.map(({ key, id }) => [key, id]), [['personal', 10001], ['new', 11001], ['developed', 11002]]);
  for (const profile of LOCAL_PROFILES) {
    assert.ok(profile.label.length && profile.description.length);
    assert.equal(localProfileByKey(profile.key), profile);
    assert.equal(parseLocalProfileSelection({ profile: profile.key }), profile.key);
  }
  for (const key of [undefined, null, 11002, '11002', '__proto__', 'other', 'Developed', ['new']]) assert.equal(localProfileByKey(key), null);
  for (const body of [null, [], 'developed', {}, { profile: 'other' }, { profile: 11002 }, { profile: 'new', id: 10001 }, Object.create({ profile: 'new' })]) {
    assert.throws(() => parseLocalProfileSelection(body));
  }
});

test('local scenarios require every development flag and the dedicated loopback database', () => {
  assert.equal(localProfilesAvailable(request(), localEnvironment), true);
  for (const field of ['NODE_ENV', 'ALLOW_DEV_AUTH', 'NEXT_PUBLIC_LOCAL_DEV', 'DATABASE_URL']) {
    assert.equal(localProfilesAvailable(request(), { ...localEnvironment, [field]: undefined }), false, field);
  }
  for (const value of ['production', 'test', 'Development']) assert.equal(localProfilesAvailable(request(), { ...localEnvironment, NODE_ENV: value }), false);
  for (const value of ['false', 'TRUE', '1', '']) {
    for (const field of ['ALLOW_DEV_AUTH', 'NEXT_PUBLIC_LOCAL_DEV']) assert.equal(localProfilesAvailable(request(), { ...localEnvironment, [field]: value }), false);
  }
  for (const database of [
    'postgres://colony_local:test@localhost:55432/colony_local',
    'postgres://colony_local:test@127.0.0.1:5432/colony_local',
    'postgres://colony_local:test@db.example.com:55432/colony_local',
    'postgres://other:test@127.0.0.1:55432/colony_local',
    'postgres://colony_local:test@127.0.0.1:55432/colony',
    'postgres://colony_local:test@127.0.0.1:55432/colony_local?host=db.example.com',
    'postgres://colony_local:test@127.0.0.1:55432/colony_local#fragment',
    'http://colony_local:test@127.0.0.1:55432/colony_local',
    ' postgres://colony_local:test@127.0.0.1:55432/colony_local',
    'invalid',
  ]) assert.equal(localProfilesAvailable(request(), { ...localEnvironment, DATABASE_URL: database }), false, database);
  assert.equal(localProfilesAvailable(request(), { ...localEnvironment, DATABASE_URL: 'postgresql://colony_local:another-password@127.0.0.1:55432/colony_local' }), true);
});

test('scenario access rejects remote hosts, alternate ports and cross-site browser requests', () => {
  assert.equal(localProfilesAvailable(request({ host: '127.0.0.1:3015', origin: 'http://127.0.0.1:3015', 'sec-fetch-site': 'same-origin' }), localEnvironment), true);
  assert.equal(localProfilesAvailable(request({ origin: 'http://localhost:3015' }, 'http://localhost:3015/api/local/profiles'), localEnvironment), true);
  for (const url of ['https://127.0.0.1:3015/api/local/profiles', 'http://127.0.0.1:3000/api/local/profiles', 'http://example.com:3015/api/local/profiles', 'http://[::1]:3015/api/local/profiles']) {
    assert.equal(localProfilesAvailable(request({}, url), localEnvironment), false, url);
  }
  for (const headers of [
    { host: 'example.com:3015' }, { host: '' }, { 'x-forwarded-host': 'example.com:3015' },
    { origin: 'http://localhost:3015' }, { origin: 'https://127.0.0.1:3015' }, { origin: 'http://127.0.0.1:3015/path' },
    { origin: 'http://127.0.0.1:3015/' }, { origin: 'https://example.com' }, { origin: 'null' }, { origin: '' },
    { 'sec-fetch-site': 'cross-site' },
  ]) assert.equal(localProfilesAvailable(request(headers), localEnvironment), false, JSON.stringify(headers));
});

test('developed scenario is a reachable city with unique valid cells and research left to play', () => {
  const hq = LOCAL_DEVELOPED_BUILDINGS.find(building => building.type === 'hq').level;
  const lab = LOCAL_DEVELOPED_BUILDINGS.find(building => building.type === 'research_lab').level;
  const completed = new Set(LOCAL_DEVELOPED_RESEARCH);
  const occupied = new Set();
  assert.equal(completed.size, LOCAL_DEVELOPED_RESEARCH.length);
  for (const building of LOCAL_DEVELOPED_BUILDINGS) {
    const config = BUILDINGS[building.type];
    assert.ok(config);
    assert.ok(building.level >= 1 && building.level <= config.maxLevel);
    assert.ok(config.unlockHq <= hq);
    if (config.unlockResearch) assert.ok(completed.has(config.unlockResearch), building.type);
    assert.ok(Number.isInteger(building.x) && building.x >= 0 && building.x < 8);
    assert.ok(Number.isInteger(building.y) && building.y >= 0 && building.y < 8);
    const cell = `${building.x},${building.y}`;
    assert.equal(occupied.has(cell), false, cell);
    occupied.add(cell);
  }
  for (const key of completed) {
    const technology = RESEARCH_TREE.find(item => item.key === key);
    assert.ok(technology, key);
    assert.ok(technology.unlockHq <= hq && technology.labLevel <= lab, key);
    for (const prereq of technology.prereqs) assert.ok(completed.has(prereq), `${key} needs ${prereq}`);
  }
  for (const key of ['compact_storage', 'archive_network', 'autonomous_drones', 'deep_space_protocol']) assert.equal(completed.has(key), false);
});

test('route production responses hide scenarios before body parsing or database access', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    for (const response of [await GET(request()), await POST(new Request('http://127.0.0.1:3015/api/local/profiles', { method: 'POST', body: 'invalid-json' }))]) {
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { ok: false, error: 'Not found' });
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('local catalog and invalid selection responses never need a running database', async () => {
  const previous = Object.fromEntries(Object.keys(localEnvironment).map(key => [key, process.env[key]]));
  Object.assign(process.env, localEnvironment);
  try {
    const catalog = await GET(request());
    assert.equal(catalog.status, 200);
    assert.deepEqual(await catalog.json(), { ok: true, profiles: LOCAL_PROFILES });
    for (const body of ['invalid-json', '{"profile":"developed","id":10001}', '{"profile":"missing"}']) {
      const response = await POST(new Request('http://127.0.0.1:3015/api/local/profiles', { method: 'POST', body }));
      assert.equal(response.status, 400);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
