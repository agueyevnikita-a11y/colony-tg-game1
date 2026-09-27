import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateLaunchConfig } from '../scripts/launch-config.mjs';
import { ALLOWED_UPDATES, BOT_COMMANDS, checkDatabase, inspectSchema, inspectWebhook, runDoctor, runTelegramSetup, schemaRequirements, telegramCall } from '../scripts/launch-tools.mjs';

// Synthetic configuration: these are fixtures, never live service credentials.
function config(overrides = {}) {
  return {
    BOT_TOKEN: ['123456789', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345678'].join(':'),
    BOT_USERNAME: 'colony_checks_bot', NEXT_PUBLIC_BOT_USERNAME: 'colony_checks_bot',
    APP_URL: 'https://colony-ci.telegram.org',
    DATABASE_URL: 'postgres://colony:SyntheticDbPassword_2026@localhost:5432/colony',
    TELEGRAM_WEBHOOK_SECRET: 'WebhookSynthetic_0123456789AbCdEfGhIj',
    CRON_SECRET: 'CronSynthetic_9876543210AbCdEfGhIjKlMn',
    ADMIN_TELEGRAM_IDS: '123456789, 987654321', ALLOW_DEV_AUTH: 'false',
    ...overrides,
  };
}

function fakeTelegram(overrides = {}) {
  const calls = [];
  const env = config();
  const responses = {
    getMe: { id: 123456789, is_bot: true, username: env.BOT_USERNAME, has_main_web_app: true },
    getWebhookInfo: { url: `${env.APP_URL}/api/telegram/webhook`, allowed_updates: ALLOWED_UPDATES, pending_update_count: 0 },
    getChatMenuButton: { type: 'web_app', text: 'Играть в COLONY', web_app: { url: env.APP_URL } },
    getMyCommands: BOT_COMMANDS,
    ...overrides,
  };
  return {
    calls,
    fetchImpl: async (url, options) => {
      const method = new URL(url).pathname.split('/').at(-1);
      calls.push({ method, payload: JSON.parse(options.body), signal: options.signal, redirect: options.redirect });
      return Response.json({ ok: true, result: responses[method] ?? true });
    },
  };
}

test('launch validation accepts configured deployment and rejects unsafe production overrides', () => {
  assert.deepEqual(validateLaunchConfig(config()), { ok: true, issues: [] });
  for (const [key, values] of Object.entries({
    APP_URL: ['http://colony.telegram.org', 'https://u:p@colony.telegram.org', 'https://colony.telegram.org/game', 'https://colony.telegram.org?x=1', 'https://colony.telegram.org#app', 'https://localhost', 'https://your-domain.example', 'https://colony.telegram.org:3000'],
    ALLOW_DEV_AUTH: ['true', '', undefined],
    BOT_TOKEN: ['123456:replace_me', 'arbitrary'],
    BOT_USERNAME: ['@colony_checks_bot', 'replace_me_bot', 'notabotname'],
    NEXT_PUBLIC_BOT_USERNAME: ['different_bot'],
    DATABASE_URL: ['https://db.telegram.org', 'postgres://colony:postgres@localhost:5432/colony', 'postgres://colony@localhost:5432/colony'],
    TELEGRAM_WEBHOOK_SECRET: ['short', 'x'.repeat(64), 'replace_with_long_random_string', 'AbCdEfGhIjKlMnOpQrStUvWxYz01234567$'],
    CRON_SECRET: ['short', 'A'.repeat(64), 'secret with spaces secret with spaces'],
    ADMIN_TELEGRAM_IDS: ['-1', '1.5', '1e3', '1,,2', '0', '9007199254740992'],
    SUPPORT_URL: ['http://t.me/support', 'https://u:p@t.me/support'],
  })) {
    for (const value of values) {
      const result = validateLaunchConfig(config({ [key]: value }));
      assert.ok(result.issues.some((issue) => issue.key === key), `${key} should be rejected`);
      if (value && value.length > 12) assert.ok(!JSON.stringify(result).includes(value), 'Values must not appear in diagnostic errors');
    }
  }
  assert.equal(validateLaunchConfig(config({ APP_URL: 'http://localhost:3000', ALLOW_DEV_AUTH: 'true' }), { production: false }).ok, true);
  assert.equal(validateLaunchConfig(config({ SUPPORT_URL: 'https://t.me/colony_support' })).ok, true);
  assert.equal(validateLaunchConfig(config({ CRON_SECRET: config().TELEGRAM_WEBHOOK_SECRET })).ok, false);
});

test('doctor local mode is offline and invalid config prevents network or database access', async () => {
  const noAccess = () => { throw new Error('Must stay offline'); };
  const result = await runDoctor({ env: config(), local: true, fetchImpl: noAccess, databaseCheck: noAccess });
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /Offline/);
  const invalid = await runDoctor({ env: config({ BOT_TOKEN: '' }), fetchImpl: noAccess, databaseCheck: noAccess });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.checks[0].name, 'BOT_TOKEN');
});

test('setup defaults to dry-run and never exposes secrets in its plan', async () => {
  const fake = fakeTelegram();
  const result = await runTelegramSetup({ env: config(), fetchImpl: fake.fetchImpl });
  assert.equal(result.applied, false);
  assert.equal(fake.calls.length, 0);
  for (const key of ['BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'CRON_SECRET', 'DATABASE_URL']) {
    assert.ok(!JSON.stringify(result).includes(config()[key]));
  }
});

test('setup fails before Telegram mutation on invalid configuration or wrong bot identity', async () => {
  const fake = fakeTelegram({ getMe: { id: 123456789, is_bot: true, username: 'wrong_bot' } });
  await assert.rejects(runTelegramSetup({ env: config({ APP_URL: 'http://localhost' }), apply: true, fetchImpl: fake.fetchImpl }), /APP_URL/);
  assert.equal(fake.calls.length, 0);
  await assert.rejects(runTelegramSetup({ env: config(), apply: true, fetchImpl: fake.fetchImpl }), /different bot/);
  assert.deepEqual(fake.calls.map((call) => call.method), ['getMe']);
});

test('setup preserves pending updates and verifies webhook, private-chat commands and menu', async () => {
  const fake = fakeTelegram();
  const result = await runTelegramSetup({ env: config(), apply: true, fetchImpl: fake.fetchImpl });
  assert.equal(result.applied, true);
  assert.deepEqual(fake.calls.map((call) => call.method), ['getMe', 'setMyCommands', 'setChatMenuButton', 'setWebhook', 'getWebhookInfo', 'getChatMenuButton', 'getMyCommands']);
  const webhook = fake.calls.find((call) => call.method === 'setWebhook');
  assert.deepEqual(webhook.payload.allowed_updates, ['message', 'pre_checkout_query']);
  assert.equal(webhook.payload.drop_pending_updates, false);
  assert.equal(webhook.payload.secret_token, config().TELEGRAM_WEBHOOK_SECRET);
  assert.deepEqual(fake.calls[1].payload.scope, { type: 'all_private_chats' });
  assert.ok(fake.calls.every((call) => call.signal instanceof AbortSignal && call.redirect === 'error'));
});

test('webhook-only setup changes no menu or bot commands', async () => {
  const fake = fakeTelegram();
  const result = await runTelegramSetup({ env: config(), apply: true, webhookOnly: true, fetchImpl: fake.fetchImpl });
  assert.equal(result.applied, true);
  assert.deepEqual(fake.calls.map((call) => call.method), ['getMe', 'setWebhook', 'getWebhookInfo']);
});

test('setup does not report success when Telegram reads back the wrong configuration', async () => {
  for (const [method, result] of Object.entries({
    getWebhookInfo: { url: 'https://other.telegram.org/api/telegram/webhook' },
    getChatMenuButton: { type: 'commands' },
    getMyCommands: [{ command: 'start', description: 'Open' }],
  })) {
    const fake = fakeTelegram({ [method]: result });
    await assert.rejects(runTelegramSetup({ env: config(), apply: true, fetchImpl: fake.fetchImpl }), /Webhook URL|verification failed/);
  }
});

test('Telegram diagnostics redact transport errors and API error descriptions', async () => {
  const secret = config().BOT_TOKEN;
  for (const fetchImpl of [
    async () => { throw new Error(`request failed https://api.telegram.org/bot${secret}/getMe`); },
    async () => Response.json({ ok: false, error_code: 401, description: `private token ${secret}` }, { status: 401 }),
    async () => new Response(`private token ${secret}`, { status: 502 }),
  ]) {
    await assert.rejects(telegramCall(secret, 'getMe', {}, { fetchImpl }), (error) => {
      assert.ok(!error.message.includes(secret));
      assert.match(error.message, /Telegram getMe/);
      return true;
    });
  }
});

test('Telegram timeout is bounded even when a transport never settles', async () => {
  let signal;
  await assert.rejects(telegramCall(config().BOT_TOKEN, 'getMe', {}, {
    timeoutMs: 10,
    fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); },
  }), /timed out/);
  assert.equal(signal.aborted, true);
});

test('webhook diagnostics reject missing payment updates and flag delivery failures without raw messages', () => {
  const url = `${config().APP_URL}/api/telegram/webhook`;
  assert.equal(inspectWebhook({ url }, config().APP_URL).ok, true);
  assert.equal(inspectWebhook({ url, allowed_updates: [] }, config().APP_URL).ok, true);
  assert.equal(inspectWebhook({ url, allowed_updates: ['message'] }, config().APP_URL).ok, false);
  const result = inspectWebhook({ url, pending_update_count: 3, last_error_date: 123, last_error_message: 'sensitive details' }, config().APP_URL);
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes('sensitive details'));
  assert.match(result.warnings[0], /3 updates/);
});

test('doctor checks bot and webhook even when database fails without leaking the DB URL', async () => {
  const fake = fakeTelegram();
  const result = await runDoctor({ env: config(), fetchImpl: fake.fetchImpl, databaseCheck: async () => { throw new Error(config().DATABASE_URL); } });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.name === 'Telegram webhook').ok, true);
  assert.ok(!JSON.stringify(result).includes(config().DATABASE_URL));
});

test('schema diagnostics cover cumulative tables and added columns', async () => {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const requirements = schemaRequirements(schema);
  assert.ok(requirements.tables.includes('purchases'));
  assert.ok(requirements.tables.includes('system_settings'));
  assert.ok(requirements.columns.includes('game_states.passive_carry'));
  assert.ok(requirements.columns.includes('users.bot_write_allowed'));
  const rows = requirements.tables.map((table_name) => ({ table_name, column_name: 'id' }));
  rows.push(...requirements.columns.map((column) => { const [table_name, column_name] = column.split('.'); return { table_name, column_name }; }));
  assert.deepEqual(inspectSchema(rows, requirements), []);
  assert.ok(inspectSchema(rows.filter((row) => row.column_name !== 'passive_carry'), requirements).some((issue) => issue.includes('game_states.passive_carry')));
  assert.ok(inspectSchema(rows.filter((row) => row.table_name !== 'purchases'), requirements).some((issue) => issue.includes('purchases')));
});

test('database check sanitizes connection errors and always closes its client', async () => {
  let ended = false;
  const sql = Object.assign(async () => { throw new Error(config().DATABASE_URL); }, { end: async () => { ended = true; } });
  await assert.rejects(checkDatabase(config().DATABASE_URL, { postgresImpl: () => sql }), (error) => {
    assert.ok(!error.message.includes(config().DATABASE_URL));
    assert.match(error.message, /PostgreSQL check failed/);
    return true;
  });
  assert.equal(ended, true);
});

test('database check times out even if a connected server never answers', async () => {
  let ended = false;
  const sql = Object.assign(async () => new Promise(() => {}), { end: async () => { ended = true; } });
  await assert.rejects(checkDatabase(config().DATABASE_URL, { postgresImpl: () => sql, timeoutMs: 10 }), /timed out/);
  assert.equal(ended, true);
});
