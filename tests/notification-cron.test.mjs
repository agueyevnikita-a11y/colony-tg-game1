import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function compile(path, imports = {}) {
  let source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  for (const [specifier, replacement] of Object.entries(imports)) source = source.replaceAll(`'${specifier}'`, `'${replacement}'`);
  return asModule(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}

// Exercise the actual handler against a small queue adapter and a mocked transport.
// This does not simulate PostgreSQL locking or send real Telegram messages.
const state = { queries: [], jobs: [], api: [], errors: [], cleanups: 0, flag: true };
globalThis.__colonyNotificationCronTest = state;
const stubs = asModule(`
  const state = globalThis.__colonyNotificationCronTest;
  export class NextResponse extends Response { static json(value, init) { return Response.json(value, init); } }
  export const cleanupRateLimits = async () => { state.cleanups++; };
  export const logErrorEvent = async value => { state.errors.push(value); };
  export async function sql(strings, ...values) {
    const text = strings.join('?'); state.queries.push({ text, values });
    if (text.includes('SELECT enabled FROM feature_flags')) {
      if (state.flagFailure) throw new Error('Flag lookup unavailable');
      return state.flag === undefined ? [] : [{ enabled: state.flag }];
    }
    if (text.includes('WITH due AS')) {
      const due = state.jobs.filter(job => job.sent_at === null && job.cancelled_at === null && job.processing_at === null);
      for (const job of due) job.processing_at = 'claimed';
      return due.map(job => ({ id: job.id }));
    }
    if (text.includes('SELECT nj.*')) return state.jobs.filter(job => values[0].includes(job.id)).map(job => ({ ...job }));
    if (text.includes('SET sent_at=now()')) {
      const job = state.jobs.find(job => job.id === values[0]);
      job.sent_at = 'sent'; job.processing_at = null; job.error_text = null;
      return [];
    }
    if (text.includes("error_text='notifications_disabled'")) {
      const job = state.jobs.find(job => job.id === values[0]);
      job.cancelled_at = 'cancelled'; job.processing_at = null; job.error_text = 'notifications_disabled';
      return [];
    }
    throw new Error('Unexpected notification test SQL');
  }
  sql.array = value => value;
  sql.begin = async callback => callback(sql);
`);
const { POST } = await import(await compile('../app/api/cron/notifications/route.ts', {
  'next/server': stubs, '@/lib/server/db': stubs, '@/lib/server/errors': stubs,
  '@/lib/server/rate-limit': stubs, '@/lib/server/notifications': await compile('../lib/server/notifications.ts'),
}));

const pendingJob = overrides => ({
  id: 'job-1', user_id: 'player-1', telegram_id: 42, kind: 'building_ready', payload: { name: 'Шахта' },
  enabled: true, building_ready: true, research_ready: true, expedition_ready: true, bot_write_allowed: true,
  sent_at: null, cancelled_at: null, processing_at: null, error_text: null, ...overrides,
});
const request = (authorization = 'Bearer test-cron-secret') => new Request('https://colony.test/api/cron/notifications', {
  method: 'POST', headers: authorization === null ? {} : { authorization },
});
function setup(t) {
  const keys = ['CRON_SECRET', 'BOT_TOKEN', 'NEXT_PUBLIC_BOT_USERNAME'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { CRON_SECRET: 'test-cron-secret', BOT_TOKEN: 'test-only-token', NEXT_PUBLIC_BOT_USERNAME: 'colony_test_bot' });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(state, { queries: [], jobs: [pendingJob()], api: [], errors: [], cleanups: 0, flag: true, flagFailure: false });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    state.api.push({ url, body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: true });
  });
}

test('notification cron rejects missing, incorrect and unconfigured secrets before queue or transport access', async t => {
  setup(t);
  const original = structuredClone(state.jobs);
  for (const header of [null, 'Bearer wrong', 'test-cron-secret']) assert.equal((await POST(request(header))).status, 401);
  delete process.env.CRON_SECRET;
  assert.equal((await POST(request())).status, 401);
  assert.deepEqual(state.jobs, original);
  assert.equal(state.queries.length, 0);
  assert.equal(state.cleanups, 0);
  assert.equal(state.api.length, 0);
});

test('global notifications false leaves eligible pending jobs untouched and never contacts Telegram', async t => {
  setup(t);
  state.flag = false;
  delete process.env.BOT_TOKEN;
  const original = structuredClone(state.jobs);
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, disabled: true, processed: 0, sent: 0, skipped: 0, failed: 0 });
  assert.deepEqual(state.jobs, original);
  assert.equal(state.cleanups, 0);
  assert.equal(state.api.length, 0);
  assert.equal(state.queries.length, 1);
});

test('missing global notification flag fails closed without consuming the pending queue', async t => {
  setup(t);
  state.flag = undefined;
  const original = structuredClone(state.jobs);
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).disabled, true);
  assert.deepEqual(state.jobs, original);
  assert.equal(state.api.length, 0);
  assert.equal(state.cleanups, 0);
});

test('a disabled run can resume after re-enabling without losing or sending the same job twice', async t => {
  setup(t);
  state.flag = false;
  await POST(request());
  assert.equal(state.jobs[0].processing_at, null);
  state.flag = true;
  const response = await POST(request());
  assert.deepEqual(await response.json(), { ok: true, processed: 1, sent: 1, skipped: 0, failed: 0 });
  assert.equal(state.api.length, 1);
  assert.equal(state.api[0].body.chat_id, 42);
  assert.match(state.api[0].body.text, /Шахта/);
  assert.equal(state.api[0].body.reply_markup.inline_keyboard[0][0].url, 'https://t.me/colony_test_bot?startapp');
  assert.equal(state.jobs[0].sent_at, 'sent');
  assert.equal(state.jobs[0].processing_at, null);
  const repeated = await POST(request());
  assert.equal((await repeated.json()).processed, 0);
  assert.equal(state.api.length, 1);
});

test('enabled cron still respects the player permission and cancellation behavior', async t => {
  setup(t);
  state.jobs = [pendingJob({ bot_write_allowed: false })];
  const response = await POST(request());
  assert.deepEqual(await response.json(), { ok: true, processed: 1, sent: 0, skipped: 1, failed: 0 });
  assert.equal(state.api.length, 0);
  assert.equal(state.jobs[0].cancelled_at, 'cancelled');
  assert.equal(state.jobs[0].processing_at, null);
});

test('a failed global flag lookup does not claim jobs or attempt delivery', async t => {
  setup(t);
  state.flagFailure = true;
  const original = structuredClone(state.jobs);
  const response = await POST(request());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, error: 'cron_error' });
  assert.deepEqual(state.jobs, original);
  assert.equal(state.api.length, 0);
  assert.equal(state.cleanups, 0);
});
