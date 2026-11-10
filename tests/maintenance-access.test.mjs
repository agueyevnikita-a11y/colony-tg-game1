import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const state = { db: null, queries: [], calls: [], transactions: [] };
const userId = '00000000-0000-4000-8000-000000000101';
const token = 'synthetic-maintenance-test-token';
const playerId = 101, adminId = 909;

// A transactional adapter observes attempted writes, including writes that would roll back.
// The real access policy, ensurePlayer, authentication and HTTP routes execute against it.
function sql(strings, ...values) {
  const text = strings.join('?').replace(/\s+/g, ' ').trim();
  state.queries.push({ text, write: /^(INSERT|UPDATE|DELETE)\b/.test(text) });
  if (text.startsWith('SELECT setting_key,value FROM system_settings')) return Promise.resolve([
    { setting_key: 'maintenance', value: state.db.maintenance },
    { setting_key: 'beta_required', value: { enabled: state.db.betaRequired } },
  ]);
  if (text.startsWith('SELECT granted_at,source FROM beta_access')) return Promise.resolve(state.db.betaAccess.filter(row => row.user_id === values[0]));
  if (text.startsWith('INSERT INTO users (telegram_id, username, first_name, language_code)')) {
    let user = state.db.users.find(row => row.telegram_id === values[0]);
    if (!user) {
      user = { id: userId, telegram_id: values[0], created_at: new Date('2026-01-02T00:00:00Z'), bot_write_allowed: false };
      state.db.users.push(user);
    }
    Object.assign(user, { username: values[1], first_name: values[2], language_code: values[3], last_seen_at: new Date('2026-02-01T00:00:00Z') });
    return Promise.resolve([{ id: user.id, created_at: user.created_at }]);
  }
  if (text.startsWith('UPDATE users SET bot_write_allowed=true')) {
    state.db.users.find(row => row.id === values[0]).bot_write_allowed = true;
    return Promise.resolve([]);
  }
  if (text.startsWith('INSERT INTO api_rate_limits')) {
    state.db.rateLimits.push(values[0]);
    return Promise.resolve([{ request_count: 1, retry_after: 60 }]);
  }
  if (text.startsWith('INSERT INTO game_states')) {
    if (!state.db.gameStates.some(row => row.user_id === values[0])) state.db.gameStates.push({ user_id: values[0] });
    return Promise.resolve([]);
  }
  if (text.startsWith('SELECT count(*)::text AS count FROM buildings')) return Promise.resolve([
    { count: String(state.db.buildings.filter(row => row.user_id === values[0]).length) },
  ]);
  if (text.startsWith('INSERT INTO buildings')) {
    for (const type of ['hq', 'mine', 'solar', 'warehouse']) state.db.buildings.push({ user_id: values[0], type });
    return Promise.resolve([]);
  }
  if (text.startsWith('SELECT user_id FROM beta_access')) return Promise.resolve(state.db.betaAccess.filter(row => row.user_id === values[0]));
  if (text.startsWith('SELECT * FROM beta_invite_codes')) return Promise.resolve(state.db.invites.filter(row => row.code_hash === values[0] && row.active));
  if (text.startsWith('INSERT INTO beta_access')) {
    if (state.db.betaAccess.some(row => row.user_id === values[0])) return Promise.resolve([]);
    state.db.betaAccess.push({ user_id: values[0], source: 'code', granted_at: new Date(), invite_code_hash: values[1] });
    return Promise.resolve([{ user_id: values[0] }]);
  }
  if (text.startsWith('UPDATE beta_invite_codes SET uses=uses+1')) {
    state.db.invites.find(row => row.code_hash === values[0]).uses++;
    return Promise.resolve([]);
  }
  if (text.startsWith('UPDATE users SET colony_name=')) {
    Object.assign(state.db.users.find(row => row.id === values[2]), { colony_name: values[0], profile_bio: values[1] });
    return Promise.resolve([]);
  }
  throw new Error(`Unexpected maintenance test SQL: ${text}`);
}
sql.begin = async callback => {
  const before = structuredClone(state.db);
  state.transactions.push('begin');
  try { const result = await callback(sql); state.transactions.push('commit'); return result; }
  catch (error) { state.db = before; state.transactions.push('rollback'); throw error; }
};
globalThis.__colonyMaintenanceTest = { state, sql };

const shared = asModule(`
  const context = globalThis.__colonyMaintenanceTest;
  export const sql = context.sql;
  export class NextResponse extends Response { static json(value, init) { return Response.json(value, init); } }
  export const APP_VERSION = 'synthetic-maintenance-test';
  export async function logErrorEvent() { context.state.calls.push('telemetry'); }
  export async function ensureProgressionRows() { context.state.calls.push('progression'); }
  export async function recordDailySession(_tx, id) { context.state.calls.push('daily-session'); context.state.db.dailySessions.push(id); }
  export function recordProgressEvent() { throw new Error('Unexpected progression call'); }
  export function unlockAchievements() { throw new Error('Unexpected achievement call'); }
`);
async function compile(path, imports = {}, stubUnused = false) {
  let source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  if (stubUnused) {
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    for (const statement of tree.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (imports[specifier]) continue;
      const names = statement.importClause.namedBindings.elements.filter(item => !item.isTypeOnly).map(item => (item.propertyName ?? item.name).text);
      imports[specifier] = asModule(names.map(name => `export function ${name}() { throw new Error('Unexpected dependency: ${name}'); }`).join('\n'));
    }
  }
  for (const [specifier, replacement] of Object.entries(imports)) source = source.replaceAll(`'${specifier}'`, `'${replacement}'`);
  return asModule(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const accessUrl = await compile('../lib/server/access.ts', { '@/lib/server/db': shared });
const authUrl = await compile('../lib/server/telegram-auth.ts');
const rateLimitUrl = await compile('../lib/server/rate-limit.ts', { '@/lib/server/db': shared });
const gameUrl = await compile('../lib/server/game.ts', {
  './db': shared,
  '@/lib/server/access': accessUrl,
  '@/lib/server/rate-limit': rateLimitUrl,
  '@/lib/server/progression': shared,
  '@/lib/game/referrals': await compile('../lib/game/referrals.ts'),
}, true);
const gameRouteShim = asModule(`
  export { ensurePlayer } from '${gameUrl}';
  export async function reconcilePlayer(id) {
    const { state } = globalThis.__colonyMaintenanceTest;
    state.calls.push('reconcile');
    return { state: { hq_level: 1 }, buildings: state.db.buildings.filter(row => row.user_id === id) };
  }
`);
const routeImports = {
  'next/server': shared,
  '@/lib/server/db': shared,
  '@/lib/server/telegram-auth': authUrl,
  '@/lib/server/game': gameRouteShim,
  '@/lib/server/access': accessUrl,
  '@/lib/server/rate-limit': rateLimitUrl,
  '@/lib/server/progression': shared,
  '@/lib/server/errors': shared,
  '@/lib/version': shared,
};
const { POST: session } = await import(await compile('../app/api/session/route.ts', routeImports));
const { POST: redeem } = await import(await compile('../app/api/beta/redeem/route.ts', routeImports));
const { POST: profile } = await import(await compile('../app/api/profile/update/route.ts', routeImports));
const { POST: clientError } = await import(await compile('../app/api/client/error/route.ts', routeImports));
const { hashBetaCode, MaintenanceAccessError } = await import(accessUrl);
const { ensurePlayer } = await import(gameUrl);

function setup(t, { maintenance = true, betaRequired = true, existing = false } = {}) {
  const env = ['BOT_TOKEN', 'ADMIN_TELEGRAM_IDS', 'NODE_ENV', 'ALLOW_DEV_AUTH'];
  const previous = Object.fromEntries(env.map(key => [key, process.env[key]]));
  Object.assign(process.env, { BOT_TOKEN: token, ADMIN_TELEGRAM_IDS: String(adminId), NODE_ENV: 'production', ALLOW_DEV_AUTH: 'false' });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  state.db = {
    maintenance: { enabled: maintenance, message: 'Closed preparation' }, betaRequired,
    users: existing ? [{ id: userId, telegram_id: playerId, username: 'old_name', first_name: 'Old name', language_code: 'en', last_seen_at: new Date('2025-01-01Z'), bot_write_allowed: false }] : [],
    gameStates: existing ? [{ user_id: userId, credits: 123 }] : [],
    buildings: existing ? [{ user_id: userId, type: 'hq' }] : [],
    betaAccess: [], invites: [{ code_hash: hashBetaCode('TEST-CODE'), uses: 0, max_uses: 3, active: true }],
    rateLimits: [], dailySessions: [],
  };
  state.queries = []; state.calls = []; state.transactions = [];
}
function signedRequest(path, id = playerId, body = {}) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'New name', username: 'new_name', language_code: 'ru', allows_write_to_pm: true }) });
  const data = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return new Request(`https://colony.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-init-data': params.toString() }, body: JSON.stringify(body) });
}
function assertNoWrites(before) {
  assert.deepEqual(state.db, before);
  assert.equal(state.queries.filter(query => query.write).length, 0, 'A denial must happen before any attempted persistent write');
  assert.deepEqual(state.calls, [], 'No progression, daily session, reconciliation or telemetry on denial');
}

test('actual signed session returns maintenance screen without creating a new profile or telemetry', async t => {
  setup(t);
  const before = structuredClone(state.db);
  const response = await session(signedRequest('/api/session'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.ok, true); assert.equal(body.limited, true); assert.equal(body.userId, null);
  assert.equal(body.telegramUser.id, playerId); assert.equal(body.access.blockReason, 'maintenance');
  assert.equal(body.access.maintenance.message, 'Closed preparation'); assert.equal(body.admin, false);
  assert.equal(body.state, undefined);
  assertNoWrites(before);
  assert.deepEqual(state.transactions, ['begin', 'rollback']);
});

test('existing visitor cannot refresh Telegram fields, last_seen, write permission or game data during maintenance', async t => {
  setup(t, { existing: true });
  const before = structuredClone(state.db);
  const response = await session(signedRequest('/api/session'));
  assert.equal((await response.json()).access.blockReason, 'maintenance');
  assertNoWrites(before);
});

test('skipAccessGate cannot bypass maintenance through beta redemption or direct ensurePlayer', async t => {
  setup(t);
  const before = structuredClone(state.db);
  const response = await redeem(signedRequest('/api/beta/redeem', playerId, { code: 'TEST-CODE' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).ok, false);
  await assert.rejects(ensurePlayer({ id: playerId, first_name: 'Synthetic' }, undefined, { skipAccessGate: true }), MaintenanceAccessError);
  assertNoWrites(before);
});

test('direct profile mutation and client telemetry cannot create or update profiles during maintenance', async t => {
  setup(t, { existing: true });
  const before = structuredClone(state.db);
  assert.equal((await profile(signedRequest('/api/profile/update', playerId, { colonyName: 'Changed colony', bio: 'Changed bio' }))).status, 400);
  assert.equal((await clientError(signedRequest('/api/client/error', playerId, { message: 'Synthetic error', stack: 'Synthetic stack' }))).status, 200);
  assertNoWrites(before);
});

test('administrator can create and load a colony while maintenance and beta restrictions are enabled', async t => {
  setup(t);
  const response = await session(signedRequest('/api/session', adminId));
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.admin, true); assert.equal(body.access.allowed, true);
  assert.equal(body.limited, undefined); assert.equal(body.state.hq_level, 1); assert.equal(body.buildings.length, 4);
  assert.equal(state.db.users[0].telegram_id, adminId); assert.equal(state.db.users[0].bot_write_allowed, true);
  assert.equal(state.db.dailySessions.length, 1); assert.equal(state.calls.includes('telemetry'), false);
});

test('normal beta registration and code redemption still work after maintenance is disabled', async t => {
  setup(t, { maintenance: false });
  const first = await session(signedRequest('/api/session'));
  const firstBody = await first.json();
  assert.equal(first.status, 200); assert.equal(firstBody.limited, true);
  assert.equal(firstBody.access.blockReason, 'beta_required'); assert.equal(firstBody.userId, userId);
  assert.equal(state.db.users.length, 1); assert.equal(state.db.buildings.length, 4); assert.equal(state.db.dailySessions.length, 0);
  const activation = await redeem(signedRequest('/api/beta/redeem', playerId, { code: 'TEST-CODE' }));
  assert.equal(activation.status, 200); assert.equal((await activation.json()).ok, true);
  assert.equal(state.db.invites[0].uses, 1); assert.equal(state.db.betaAccess.length, 1);
  const second = await session(signedRequest('/api/session'));
  const secondBody = await second.json();
  assert.equal(second.status, 200); assert.equal(secondBody.access.allowed, true); assert.equal(secondBody.limited, undefined);
  assert.equal(secondBody.userId, userId); assert.equal(state.db.users.length, 1); assert.equal(state.db.buildings.length, 4);
  assert.equal(state.db.dailySessions.length, 1);
});

test('unsigned sessions remain rejected before any database lookup', async t => {
  setup(t);
  const response = await session(new Request('https://colony.test/api/session', { method: 'POST' }));
  assert.equal(response.status, 401); assert.equal((await response.json()).code, 'TELEGRAM_AUTH_REQUIRED');
  assert.deepEqual(state.queries, []); assert.deepEqual(state.calls, []);
});
