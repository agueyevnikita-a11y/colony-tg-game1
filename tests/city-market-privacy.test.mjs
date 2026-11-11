import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function compile(path, imports = {}, { jsx = false } = {}) {
  let source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  if (jsx) source = source.replace(/^import ['"][^'"]+\.css['"];?\r?\n/gm, '');
  for (const [specifier, replacement] of Object.entries(imports)) source = source.replaceAll(`'${specifier}'`, `'${replacement}'`);
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return asModule(result.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime'))));
}

const ownId = '11111111-1111-4111-8111-111111111111';
const cityId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const token = 'synthetic-city-privacy-token';
const privateValues = { telegram_id: 987654321, first_name: 'PRIVATE_FIRST_NAME', username: 'PRIVATE_USERNAME', email: 'PRIVATE_EMAIL' };
const state = { queries: [], ensureCalls: [], denied: false, found: true, orders: [] };

// A lazy adapter preserves SQL fragments and records the actual predicates used by the handler.
// It is not a PostgreSQL implementation; integration tests cover the real engine separately.
function query(strings, ...values) {
  const parts = [], params = [];
  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i]);
    if (i < values.length) {
      const value = values[i];
      if (value?.fragment) { parts.push(value.text); params.push(...value.values); }
      else { parts.push('?'); params.push(value); }
    }
  }
  const statement = { fragment: true, text: parts.join('').replace(/\s+/g, ' ').trim(), values: params };
  statement.then = (resolve, reject) => Promise.resolve().then(() => {
    state.queries.push({ text: statement.text, values: statement.values });
    const text = statement.text;
    if (text.includes('FROM users u JOIN game_states')) return state.found ? [{
      id: cityId, colony_name: 'Лунная гавань', profile_bio: 'Исследуем Луну', created_at: '2026-01-01T00:00:00Z',
      hq_level: 3, player_level: 2, city_score: 120, premium_until: '2999-01-01T00:00:00Z',
      buildings_started: 8, contracts_completed: 4, qualified_referrals: 1, ...privateValues,
    }] : [];
    if (text.includes('FROM buildings WHERE user_id=')) return text.startsWith('SELECT 1') ? [{ present: 1 }] : [{ id: 'hq-1', type: 'hq', level: 3, status: 'active', x: 1, y: 1 }];
    if (text.includes('FROM city_decor')) return [];
    if (text.includes('FROM user_cosmetics')) return [{ cosmetic_id: 'frame_test', name: 'Рамка', category: 'frame', metadata: {} }];
    if (text.includes('expires_at<=now()')) return [];
    if (text.includes('JOIN users u ON u.id=mo.user_id')) return state.orders;
    if (text.includes('FROM market_orders WHERE user_id=')) return [{ id: 'own-order', user_id: ownId, resource: 'ore', amount_remaining: 25 }];
    if (text.includes('FROM market_trades')) return [{ resource: 'ore', median_price: 2, volume: 25, trades: 1 }];
    throw new Error(`Unexpected city/market test SQL: ${text}`);
  }).then(resolve, reject);
  return statement;
}
query.array = value => value;
globalThis.__colonyCityMarketPrivacy = { state, sql: query, ownId };
const shim = asModule(`
  const context = globalThis.__colonyCityMarketPrivacy;
  export const sql = context.sql;
  export class NextResponse extends Response { static json(value, init) { return Response.json(value, init); } }
  export async function ensurePlayer(user, startParam) {
    context.state.ensureCalls.push({ user, startParam });
    if (context.state.denied) throw new Error('Игра временно закрыта');
    return context.ownId;
  }
  export const requireColonyFeature = () => { throw new Error('Unexpected trade mutation'); };
  export const recordProgressEvent = () => { throw new Error('Unexpected progress mutation'); };
  export const storageCaps = () => { throw new Error('Unexpected storage mutation'); };
  export const completedResearchKeys = () => { throw new Error('Unexpected research mutation'); };
  export const productionMultipliers = () => { throw new Error('Unexpected production mutation'); };
  // These fixtures are open accounts; ledger behavior has separate PG/FS coverage.
  export const closedPlayerIds = async () => [];
`);
const authUrl = await compile('../lib/server/telegram-auth.ts');
const decorUrl = await compile('../lib/game/decor.ts');
const { POST: city } = await import(await compile('../app/api/social/city/route.ts', {
  'next/server': shim, '@/lib/server/telegram-auth': authUrl, '@/lib/server/game': shim, '@/lib/server/db': shim,
  '@/lib/game/config': await compile('../lib/game/config.ts'),
  '@/lib/game/comfort': await compile('../lib/game/comfort.ts', { './decor': decorUrl }),
  '@/lib/server/closed-player-visibility': shim,
}));
const marketRulesUrl = await compile('../lib/game/market.ts');
const { getMarketState } = await import(await compile('../lib/server/market.ts', {
  './db': shim, './feature-access': shim, '@/lib/game/market': marketRulesUrl, '@/lib/server/progression': shim,
  '@/lib/game/economy': shim, '@/lib/server/research': shim, '@/lib/game/research': shim,
  './closed-player-visibility': shim,
}));

function request(body, authenticated = true) {
  const headers = { 'content-type': 'application/json' };
  if (authenticated) {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42, first_name: 'Viewer' }) });
    const data = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    params.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
    headers['x-telegram-init-data'] = params.toString();
  }
  return new Request('https://colony.test/api/social/city', { method: 'POST', headers, body: JSON.stringify(body) });
}
function setup(t) {
  const keys = ['BOT_TOKEN', 'NODE_ENV', 'ALLOW_DEV_AUTH'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { BOT_TOKEN: token, NODE_ENV: 'production', ALLOW_DEV_AUTH: 'false' });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(state, { queries: [], ensureCalls: [], denied: false, found: true, orders: [] });
}
function assertPrivateFieldsAbsent(value) {
  for (const key of Object.keys(privateValues)) assert.equal(Object.hasOwn(value, key), false, key);
  for (const marker of Object.values(privateValues)) assert.equal(JSON.stringify(value).includes(String(marker)), false, String(marker));
}

test('city UUID lookup returns only game profile and preserves city rendering data', async t => {
  setup(t);
  const response = await city(request({ userId: cityId.toUpperCase(), telegramId: 77 }));
  assert.equal(response.status, 200);
  const { city: result } = await response.json();
  assertPrivateFieldsAbsent(result);
  assert.equal(result.id, cityId);
  assert.equal(result.colony_name, 'Лунная гавань');
  assert.equal(result.premium, true);
  assert.equal(result.buildings[0].id, 'hq-1');
  assert.equal(result.cosmetics[0].cosmetic_id, 'frame_test');
  assert.equal(result.gridSize > 0, true);
  assert.equal(result.contracts_completed, 4);
  assert.equal(Object.hasOwn(result, 'premium_until'), false);
  assert.match(state.queries[0].text, /WHERE u\.id=\?/);
  assert.deepEqual(state.queries[0].values, [cityId, []]);
  assert.equal(state.ensureCalls.length, 1);
});

test('legacy shared city links resolve by numeric Telegram ID without exposing Telegram profile', async t => {
  setup(t);
  const response = await city(request({ telegramId: 77 }));
  assert.equal(response.status, 200);
  assertPrivateFieldsAbsent((await response.json()).city);
  assert.match(state.queries[0].text, /WHERE u\.telegram_id=\?/);
  assert.deepEqual(state.queries[0].values, [77, []]);
});

test('invalid UUID never falls back to supplied Telegram ID; malformed targets stop before city queries', async t => {
  setup(t);
  for (const body of [
    { userId: '', telegramId: 77 }, { userId: null, telegramId: 77 }, { userId: 77, telegramId: 77 },
    { userId: `${cityId} `, telegramId: 77 }, { userId: `${cityId}\n`, telegramId: 77 }, { userId: 'not-a-uuid', telegramId: 77 },
    {}, null, [], { telegramId: '77' }, { telegramId: 0 }, { telegramId: -1 }, { telegramId: 1.5 }, { telegramId: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    const response = await city(request(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).ok, false);
  }
  assert.deepEqual(state.queries, []);
});

test('city lookup keeps authentication and closed-access checks before all target reads', async t => {
  setup(t);
  assert.equal((await city(request({ userId: cityId }, false))).status, 400);
  assert.deepEqual(state.ensureCalls, []);
  assert.deepEqual(state.queries, []);
  state.denied = true;
  assert.equal((await city(request({ userId: cityId }))).status, 400);
  assert.equal(state.ensureCalls.length, 1);
  assert.deepEqual(state.queries, []);
});

test('unknown city stops before secondary profile data queries', async t => {
  setup(t);
  state.found = false;
  const response = await city(request({ userId: cityId }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Колония не найдена');
  assert.equal(state.queries.length, 1);
});

test('market book exposes game seller identity only, preserving UUID ownership and order economics', async t => {
  setup(t);
  state.orders = [
    { id: 'order-1', user_id: cityId, resource: 'ore', amount_total: 100, amount_remaining: 50, unit_price: 2,
      status: 'open', created_at: '2026-01-01', expires_at: '2999-01-01', colony_name: 'Лунная гавань', ...privateValues },
    { id: 'order-2', user_id: ownId, resource: 'parts', amount_total: 10, amount_remaining: 5, unit_price: 10,
      status: 'open', colony_name: '', ...privateValues },
  ];
  const result = await getMarketState(query, ownId);
  assert.equal(result.enabled, true);
  result.orders.forEach(assertPrivateFieldsAbsent);
  assert.equal(result.orders[0].user_id, cityId);
  assert.equal(result.orders[0].amount_remaining * result.orders[0].unit_price, 100);
  assert.equal(result.orders[1].user_id, ownId);
  assert.equal(result.orders[1].colony_name, 'Колонист');
  assert.equal(result.ownOrders[0].id, 'own-order');
  assert.equal(result.stats[0].median_price, 2);
});

test('market UI does not resurrect Telegram name fallback from an old payload', async () => {
  const reactUrl = import.meta.resolve('react');
  const { createElement } = await import(reactUrl);
  const { renderToStaticMarkup } = await import('react-dom/server');
  const uiShim = asModule(`import { createElement } from '${reactUrl}';
    export const GameIcon = () => null;
    export const GameAmount = ({ children }) => createElement('span', null, children);
    export const MechanicGuide = () => null;
    export const durationText = () => '';
  `);
  const { MarketPanel } = await import(await compile('../components/MarketPanel.tsx', {
    react: reactUrl, '@/components/GameIcon': uiShim, '@/components/MechanicGuide': uiShim,
    '@/lib/game/format': uiShim, '@/lib/game/market': marketRulesUrl,
  }, { jsx: true }));
  const markup = renderToStaticMarkup(createElement(MarketPanel, {
    market: { enabled: true, orders: [{ id: 'legacy-order', user_id: cityId, resource: 'ore', amount_remaining: 50, amount_total: 100, unit_price: 2, status: 'open', colony_name: '', ...privateValues }], ownOrders: [], stats: [] },
    view: 'buy', resources: { credits: 1000, ore: 0 }, capacities: { ore: 500 }, userId: ownId,
    featureEnabled: true, busy: false,
  }));
  assert.match(markup, /Продавец: Колонист/);
  assert.equal(markup.includes(privateValues.first_name), false);
  assert.equal(markup.includes(privateValues.username), false);
});
