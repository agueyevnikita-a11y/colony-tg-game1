import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function compile(path, imports = {}) {
  let source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  for (const [specifier, replacement] of Object.entries(imports)) source = source.replaceAll(`'${specifier}'`, `'${replacement}'`);
  return asModule(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const commandsUrl = await compile('../lib/server/bot-commands.ts');
const apiUrl = await compile('../lib/server/telegram-api.ts');
const { parseBotUpdate, buildBotReply, parseBotCommand } = await import(commandsUrl);
const { callTelegramApi, matchesWebhookSecret, withDeadline } = await import(apiUrl);
const { TelegramAuthError, getInitDataFromRequest, validateTelegramInitData } = await import(await compile('../lib/server/telegram-auth.ts'));
const env = { APP_URL: 'https://colony.app', BOT_USERNAME: 'colony_launch_bot' };
const message = (extra, chat = { id: 42, type: 'private' }) => ({ update_id: 123, message: { message_id: 1, chat, from: { id: 42, is_bot: false }, ...extra } });
const payment = { invoice_payload: 'purchase-123', currency: 'XTR', total_amount: 199, telegram_payment_charge_id: 'charge-123' };
const preCheckout = (extra = {}) => ({ update_id: 124, pre_checkout_query: { id: 'checkout-123', from: { id: 42 }, ...payment, ...extra } });

test('bot commands support mentions, preserve start arguments, and ignore other bots', () => {
  assert.deepEqual(parseBotCommand('/start@COLONY_LAUNCH_BOT ref_123', env.BOT_USERNAME), { command: 'start', argument: 'ref_123' });
  assert.equal(parseBotCommand('/help@other_bot', env.BOT_USERNAME), undefined);
  assert.equal(parseBotCommand('/helpful', env.BOT_USERNAME), undefined);
  const reply = buildBotReply(parseBotUpdate(message({ text: '/start' })), env);
  assert.equal(reply.reply_markup.inline_keyboard[0][0].web_app.url, 'https://colony.app/');
  assert.match(reply.text, /Добро пожаловать/);
  const referral = buildBotReply(parseBotUpdate(message({ text: '/start ref_123' })), env);
  assert.equal(referral.reply_markup.inline_keyboard[0][0].url, 'https://t.me/colony_launch_bot?startapp=ref_123');
});

test('payment support is private and has an in-app fallback', () => {
  const command = parseBotUpdate(message({ text: '/paysupport' }));
  assert.match(buildBotReply(command, env).text, /Обратная связь/);
  const supportEnv = { ...env, SUPPORT_URL: 'https://t.me/colony_support' };
  assert.equal(buildBotReply(command, supportEnv).reply_markup.inline_keyboard[1][0].url, supportEnv.SUPPORT_URL);
  for (const name of ['start', 'help', 'paysupport']) {
    const group = buildBotReply(parseBotUpdate(message({ text: `/${name}` }, { id: -42, type: 'supergroup' })), supportEnv);
    assert.equal(group.reply_markup.inline_keyboard[0][0].web_app, undefined);
    assert.doesNotMatch(JSON.stringify(group), /colony_support|идентификатор платежа|Обратная связь/);
    assert.equal(group.reply_markup.inline_keyboard[0][0].url, 'https://t.me/colony_launch_bot?start=launch');
  }
  assert.throws(() => buildBotReply(command, { ...env, APP_URL: 'http://colony.app' }), /HTTPS/);
  assert.throws(() => buildBotReply(command, { ...env, SUPPORT_URL: 'https://user:password@colony.app' }), /HTTPS/);
});

test('malformed Telegram envelopes and forged private consent are rejected', () => {
  for (const update of [null, [], {}, { update_id: '1' }, message({ successful_payment: { ...payment, total_amount: '199' } }),
    message({ successful_payment: { ...payment, telegram_payment_charge_id: '' } }),
    message({ write_access_allowed: true }), message({ write_access_allowed: {} }, { id: -42, type: 'group' }),
    message({ write_access_allowed: {} }, { id: 43, type: 'private' }),
    message({ write_access_allowed: { from_request: 'yes' } }),
    { ...preCheckout(), message: message({ text: '/start' }).message },
  ]) assert.throws(() => parseBotUpdate(update), /Invalid Telegram update/);
  assert.deepEqual(parseBotUpdate(message({ write_access_allowed: { from_request: true } })), { kind: 'write_access_allowed', userId: 42 });
  assert.equal(parseBotUpdate(message({ successful_payment: payment })).kind, 'payment');
  assert.equal(parseBotUpdate(message({ refunded_payment: payment })).kind, 'refund');
  assert.deepEqual(parseBotUpdate({ update_id: 1, edited_message: {} }), { kind: 'ignore' });
});

test('Telegram API failures and timeouts never expose tokens or upstream descriptions', async (t) => {
  const token = 'test-only-private-token';
  t.mock.method(globalThis, 'fetch', async () => { throw new Error(`Network failed https://api.telegram.org/bot${token}/sendMessage`); });
  await assert.rejects(callTelegramApi(token, 'sendMessage', {}), error => error.message === 'Telegram sendMessage failed' && !error.stack.includes(token));
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, description: token }), { status: 403 });
  await assert.rejects(callTelegramApi(token, 'sendMessage', {}), error => error.message === 'Telegram sendMessage failed (403)');
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(token)), { once: true });
  });
  await assert.rejects(callTelegramApi(token, 'answerPreCheckoutQuery', {}, 10), /timed out/);
});

test('webhook secret comparison rejects missing and mismatched values', () => {
  assert.equal(matchesWebhookSecret(null, 'secret'), false);
  assert.equal(matchesWebhookSecret('secret-extra', 'secret'), false);
  assert.equal(matchesWebhookSecret('секрет', 'secret'), false);
  assert.equal(matchesWebhookSecret('secret', 'secret'), true);
});

test('session authentication distinguishes missing, invalid and expired data; consent must be a signed boolean', t => {
  const keys = ['BOT_TOKEN', 'NODE_ENV', 'ALLOW_DEV_AUTH'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { BOT_TOKEN: 'test-auth-token', NODE_ENV: 'production', ALLOW_DEV_AUTH: 'false' });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  function signed(overrides = {}) {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42, first_name: 'Test', allows_write_to_pm: true }), ...overrides });
    const secret = createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
    const content = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
    params.set('hash', createHmac('sha256', secret).update(content).digest('hex'));
    return params.toString();
  }
  const code = expected => error => error instanceof TelegramAuthError && error.code === expected;
  assert.throws(() => getInitDataFromRequest(new Request('https://colony.app')), code('TELEGRAM_AUTH_REQUIRED'));
  assert.throws(() => validateTelegramInitData('hash=invalid'), code('TELEGRAM_AUTH_INVALID'));
  assert.throws(() => validateTelegramInitData(signed({ auth_date: '1' })), code('TELEGRAM_AUTH_EXPIRED'));
  assert.throws(() => validateTelegramInitData(signed({ user: '{invalid' })), code('TELEGRAM_AUTH_INVALID'));
  assert.throws(() => validateTelegramInitData(signed({ user: JSON.stringify({ id: 42, first_name: 'Test', allows_write_to_pm: 'true' }) })), code('TELEGRAM_AUTH_INVALID'));
  assert.equal(validateTelegramInitData(signed()).user.allows_write_to_pm, true);
  delete process.env.BOT_TOKEN;
  assert.throws(() => validateTelegramInitData('anything'), error => !(error instanceof TelegramAuthError));
});

test('purchase lookup deadline cancels a stalled query', async () => {
  let cancelled = false;
  const pending = Object.assign(new Promise(() => {}), { cancel() { cancelled = true; } });
  await assert.rejects(withDeadline(pending, 10), /timed out/);
  assert.equal(cancelled, true);
  assert.equal(await withDeadline(Promise.resolve(42), 10), 42);
});

// Run the actual route and fulfillment implementation against a tiny in-memory SQL adapter.
// No real database or Telegram credentials/network are used by these tests.
const state = { queries: [], purchases: [], api: [], errors: [], premiumGrants: 0, inbox: [], analytics: [], grants: [] };
globalThis.__colonyWebhookTest = state;
const stubs = asModule(`
  const state = globalThis.__colonyWebhookTest;
  export class NextResponse extends Response { static json(value, init) { return Response.json(value, init); } }
  export const logErrorEvent = async value => state.errors.push(value);
  export const pushInbox = async (_tx, _id, value) => state.inbox.push(value);
  export const analyticsEvent = async (_tx, _id, name) => state.analytics.push(name);
  export function sql(strings, ...values) {
    const text = strings.join('?'); state.queries.push({ text, values });
    if (state.dbFailure) return Promise.reject(new Error('Database unavailable'));
    if (text.includes('SELECT p.*')) return Promise.resolve(state.purchases.filter(p => p.invoice_payload === values[0] && (!text.includes("status='created'") || p.status === 'created')).map(p => ({ ...p })));
    if (text.includes("SET status='paid'")) {
      const p = state.purchases.find(p => p.id === values[1] && p.status === 'created');
      if (!p) return Promise.resolve([]); p.status = 'paid'; p.telegram_payment_charge_id = values[0]; return Promise.resolve([{ id: p.id }]);
    }
    if (text.includes("SET status='refunded'")) {
      const p = state.purchases.find(p => p.telegram_payment_charge_id === values[0] && p.status === 'paid');
      if (!p) return Promise.resolve([]); p.status = 'refunded'; return Promise.resolve([{ ...p }]);
    }
    if (text.includes('SET premium_until')) { state.premiumGrants++; return Promise.resolve([]); }
    if (text.includes('SET bot_write_allowed=true')) { state.grants.push(values[0]); return Promise.resolve([]); }
    throw new Error('Unexpected test SQL');
  }
  sql.begin = async callback => callback(sql);
`);
const paymentsUrl = await compile('../lib/server/payments.ts', {
  '@/lib/game/config': await compile('../lib/game/config.ts'), '@/lib/server/progression': stubs, '@/lib/server/inbox': stubs,
});
const { POST } = await import(await compile('../app/api/telegram/webhook/route.ts', {
  'next/server': stubs, '@/lib/server/db': stubs, '@/lib/server/errors': stubs, '@/lib/server/payments': paymentsUrl,
  '@/lib/server/bot-commands': commandsUrl, '@/lib/server/telegram-api': apiUrl,
}));

function setup(t) {
  const keys = ['BOT_TOKEN', 'BOT_USERNAME', 'APP_URL', 'TELEGRAM_WEBHOOK_SECRET'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, env, { BOT_TOKEN: 'test-only-token', TELEGRAM_WEBHOOK_SECRET: 'test-only-secret' });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(state, { queries: [], api: [], errors: [], premiumGrants: 0, inbox: [], analytics: [], grants: [], dbFailure: false,
    purchases: [{ id: 'purchase-123', invoice_payload: 'purchase-123', product_id: 'premium_30d', stars_paid: 199, telegram_id: 42, user_id: 'user-42', status: 'created' }],
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    state.api.push({ method: url.split('/').at(-1), body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: true });
  });
}
function request(update, secret = 'test-only-secret') {
  return new Request('https://colony.app/api/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(update) });
}

test('actual webhook rejects unauthenticated and malformed updates without DB or API activity', async t => {
  setup(t);
  assert.equal((await POST(request(message({ text: '/start' }), 'wrong'))).status, 401);
  assert.equal((await POST(request({ update_id: 1, message: null }))).status, 400);
  assert.equal((await POST(request(preCheckout({ total_amount: '199' })))).status, 400);
  assert.equal(state.queries.length, 0);
  assert.equal(state.errors.length, 0);
  assert.equal(state.api.length, 0);
});

test('actual webhook sends bot reply and persists only verified service-message consent', async t => {
  setup(t);
  assert.equal((await POST(request(message({ text: '/start' })))).status, 200);
  assert.equal(state.api[0].method, 'sendMessage');
  assert.equal(state.api[0].body.reply_markup.inline_keyboard[0][0].web_app.url, 'https://colony.app/');
  assert.equal(state.queries.length, 0);
  assert.equal((await POST(request(message({ write_access_allowed: { from_request: true } })))).status, 200);
  assert.deepEqual(state.grants, [42]);
});

test('actual pre-checkout validates payer, Stars amount, status, and safely declines DB failure', async t => {
  setup(t);
  for (const [extra, expected] of [[{}, true], [{ from: { id: 43 } }, false], [{ total_amount: 1 }, false], [{ currency: 'USD' }, false], [{ invoice_payload: 'missing' }, false]]) {
    assert.equal((await POST(request(preCheckout(extra)))).status, 200);
    assert.equal(state.api.at(-1).method, 'answerPreCheckoutQuery');
    assert.equal(state.api.at(-1).body.ok, expected);
  }
  state.dbFailure = true;
  assert.equal((await POST(request(preCheckout()))).status, 200);
  assert.equal(state.api.at(-1).body.ok, false);
  assert.equal(state.errors.length, 0);
});

test('successful payment and refund retries remain idempotent through the actual fulfillment code', async t => {
  setup(t);
  for (let retry = 0; retry < 2; retry++) assert.equal((await POST(request(message({ successful_payment: payment })))).status, 200);
  assert.equal(state.purchases[0].status, 'paid');
  assert.equal(state.premiumGrants, 1);
  assert.deepEqual(state.analytics, ['stars_purchase']);
  assert.equal(state.inbox.length, 1);
  assert.ok(state.queries.some(query => query.text.includes('FOR UPDATE OF p')));
  for (let retry = 0; retry < 2; retry++) assert.equal((await POST(request(message({ refunded_payment: payment })))).status, 200);
  assert.equal(state.purchases[0].status, 'refunded');
  assert.deepEqual(state.analytics, ['stars_purchase', 'stars_refund']);
  assert.equal(state.inbox.length, 2);
});

test('successful payment rejects amount or payer mismatch without granting items', async t => {
  setup(t);
  assert.equal((await POST(request(message({ successful_payment: { ...payment, total_amount: 1 } })))).status, 500);
  const wrongPayer = message({ successful_payment: payment, from: { id: 43 } }, { id: 43, type: 'private' });
  assert.equal((await POST(request(wrongPayer))).status, 500);
  assert.equal(state.purchases[0].status, 'created');
  assert.equal(state.premiumGrants, 0);
});
