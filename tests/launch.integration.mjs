import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import postgres from 'postgres';

test('production Mini App launch against PostgreSQL', { skip: process.env.COLONY_TEST_DATABASE !== '1', timeout: 120_000 }, async (t) => {
  const databaseUrl = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname), 'Integration tests require a local test database');
  assert.match(databaseUrl.pathname, /^\/colony_(ci|test)$/, 'Use colony_ci or colony_test, never the live game database');
  const sql = postgres(databaseUrl.toString(), { max: 1, connect_timeout: 5 });
  const botToken = `123456789:${crypto.randomBytes(26).toString('base64url')}`;
  const webhookSecret = crypto.randomBytes(32).toString('hex');
  const adminId = crypto.randomInt(900_000_000_000, 999_999_999_000);
  const playerId = adminId + 1;
  const port = 3210;
  const baseUrl = `http://127.0.0.1:${port}`;
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  let output = '';
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: {
      ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', BOT_TOKEN: botToken,
      APP_URL: 'https://colony-ci.app', BOT_USERNAME: 'colony_ci_bot', NEXT_PUBLIC_BOT_USERNAME: 'colony_ci_bot',
      ADMIN_TELEGRAM_IDS: String(adminId), ALLOW_DEV_AUTH: 'false',
      TELEGRAM_WEBHOOK_SECRET: webhookSecret, CRON_SECRET: crypto.randomBytes(32).toString('hex'),
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  server.stdout.on('data', (chunk) => { output = (output + chunk).slice(-8000); });
  server.stderr.on('data', (chunk) => { output = (output + chunk).slice(-8000); });
  let maintenanceChanged = false;
  let originalMaintenance;
  t.after(async () => {
    server.kill();
    if (server.exitCode === null) await Promise.race([once(server, 'exit'), delay(3000)]);
    if (maintenanceChanged) await sql`UPDATE system_settings SET value=${sql.json(originalMaintenance)} WHERE setting_key='maintenance'`;
    await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array([adminId, playerId])}::bigint[])`;
    await sql.end({ timeout: 2 });
  });

  function initData(id, userFields = {}, authDate = Math.floor(Date.now() / 1000)) {
    const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id, first_name: 'Launch test', ...userFields }) });
    const data = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
    const key = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    params.set('hash', crypto.createHmac('sha256', key).update(data).digest('hex'));
    return params.toString();
  }
  async function request(path, { method = 'GET', body, auth, secret } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method, signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', ...(auth ? { 'x-telegram-init-data': auth } : {}), ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }

  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Production server exited: ${output}`);
    try { await fetch(baseUrl, { signal: AbortSignal.timeout(500) }); break; }
    catch { if (attempt === 79) throw new Error(`Production server did not start: ${output}`); await delay(250); }
  }

  await t.test('health and readiness confirm schema and production config', async () => {
    assert.equal((await request('/')).status, 200);
    const ready = await request('/api/ready');
    assert.equal(ready.status, 200, JSON.stringify(ready.data));
    assert.equal(ready.data.version, version);
    assert.deepEqual(ready.data.checks, { configuration: 'ok', database: 'ok', schema: 'ok' });
    assert.equal((await request('/api/health')).status, 200);
  });
  await t.test('missing, forged and expired Telegram signatures are rejected', async () => {
    const missing = await request('/api/session', { method: 'POST' });
    assert.equal(missing.status, 401);
    assert.equal(missing.data.code, 'TELEGRAM_AUTH_REQUIRED');
    assert.equal((await request('/api/session', { method: 'POST', auth: `${initData(playerId)}bad` })).status, 401);
    const expired = await request('/api/session', { method: 'POST', auth: initData(playerId, {}, Math.floor(Date.now() / 1000) - 3601) });
    assert.equal(expired.data.code, 'TELEGRAM_AUTH_EXPIRED');
  });
  await t.test('first signed session creates a playable colony and keeps repeated sessions stable', async () => {
    const first = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.version, version);
    assert.equal(first.data.buildings.length, 4);
    assert.equal(first.data.state.hq_level, 1);
    const second = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.userId, first.data.userId);
    assert.equal(second.data.buildings.length, 4);
  });
  await t.test('client claims cannot grant bot write access; signed Telegram data can', async () => {
    const fakeGrant = await request('/api/settings/notifications', { method: 'POST', auth: initData(playerId), body: { enabled: true, permissionGranted: true } });
    assert.equal(fakeGrant.status, 200, JSON.stringify(fakeGrant.data));
    assert.equal(fakeGrant.data.notifications.bot_write_allowed, false);
    const signedGrant = await request('/api/session', { method: 'POST', auth: initData(playerId, { allows_write_to_pm: true }) });
    assert.equal(signedGrant.status, 200, JSON.stringify(signedGrant.data));
    assert.equal(signedGrant.data.notifications.bot_write_allowed, true);
  });
  await t.test('webhook rejects invalid secret and accepts harmless authenticated updates', async () => {
    assert.equal((await request('/api/telegram/webhook', { method: 'POST', secret: 'wrong', body: { update_id: 1 } })).status, 401);
    assert.equal((await request('/api/telegram/webhook', { method: 'POST', secret: webhookSecret, body: { update_id: 1 } })).status, 200);
  });
  await t.test('maintenance blocks ordinary players while preserving admin access', async () => {
    originalMaintenance = (await sql`SELECT value FROM system_settings WHERE setting_key='maintenance'`)[0].value;
    await sql`UPDATE system_settings SET value='{"enabled":true,"message":"Launch test"}'::jsonb WHERE setting_key='maintenance'`;
    maintenanceChanged = true;
    const player = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(player.data.limited, true);
    assert.equal(player.data.access.blockReason, 'maintenance');
    const admin = await request('/api/session', { method: 'POST', auth: initData(adminId) });
    assert.equal(admin.status, 200, JSON.stringify(admin.data));
    assert.equal(admin.data.admin, true);
    assert.ok(admin.data.state);
  });
});
