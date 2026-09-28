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

  let foreignFoundryId;
  async function productionFixture({ activeNeighbors = false } = {}) {
    const user = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0];
    assert.ok(user, 'The signed session must have created the test player');
    if (!foreignFoundryId) {
      const admin = await request('/api/session', { method: 'POST', auth: initData(adminId) });
      assert.equal(admin.status, 200, JSON.stringify(admin.data));
      foreignFoundryId = (await sql`
        INSERT INTO buildings (user_id,type,level,x,y,status)
        VALUES (${admin.data.userId},'foundry',1,1,1,'active') RETURNING id
      `)[0].id;
    }
    // Only the two isolated users created by this test can be changed here.
    // No warehouse gives the documented base capacity of 800 parts.
    await sql`DELETE FROM market_orders WHERE user_id=${user.id}`;
    await sql`DELETE FROM buildings WHERE user_id=${user.id}`;
    const buildings = await sql`
      INSERT INTO buildings (user_id,type,level,x,y,status,completes_at)
      VALUES
        (${user.id},'hq',1,2,2,'active',NULL),
        (${user.id},'foundry',1,1,1,'active',NULL),
        (${user.id},'foundry',6,4,4,'active',NULL),
        (${user.id},'foundry',1,3,3,'building',now()+interval '1 day'),
        (${user.id},'mine',1,0,1,${activeNeighbors ? 'active' : 'building'},now()+interval '1 day'),
        (${user.id},'solar',1,1,0,${activeNeighbors ? 'active' : 'building'},now()+interval '1 day')
      RETURNING *
    `;
    await sql`
      UPDATE game_states SET ore=2000,energy=1200,parts=0,passive_carry='{}'::jsonb,
        last_tick_at=now()+interval '1 day' WHERE user_id=${user.id}
    `;
    return {
      userId: user.id,
      low: buildings.find((b) => b.type === 'foundry' && b.x === 1),
      high: buildings.find((b) => b.type === 'foundry' && b.x === 4),
      inactive: buildings.find((b) => b.type === 'foundry' && b.status === 'building'),
      mine: buildings.find((b) => b.type === 'mine'),
    };
  }
  function startFoundry(body) {
    return request('/api/game/foundry/start', { method: 'POST', auth: initData(playerId), body });
  }
  async function foundryJobs(userId) {
    return sql`SELECT * FROM foundry_jobs WHERE user_id=${userId} ORDER BY started_at,id`;
  }
  async function balances(userId) {
    const row = (await sql`SELECT ore,energy,parts FROM game_states WHERE user_id=${userId}`)[0];
    return { ore: Number(row.ore), energy: Number(row.energy), parts: Number(row.parts) };
  }
  function assertSerial(jobs, seconds) {
    for (let index = 0; index < jobs.length; index++) {
      assert.equal(jobs[index].completes_at - jobs[index].started_at, seconds[index] * 1000);
      if (index) assert.equal(+jobs[index].started_at, +jobs[index - 1].completes_at, 'Queued cycles must start at the previous completion');
    }
  }

  await t.test('selected foundries retain priced serial queues, one adjacency discount and independent production', async () => {
    const fixture = await productionFixture({ activeNeighbors: true });
    const first = await startFoundry({ buildingId: fixture.low.id, mode: 'standard', link: 'ore', cycles: 2, requestId: crypto.randomUUID() });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.production.partsMultiplier, 1);
    let jobs = await foundryJobs(fixture.userId);
    assert.equal(jobs.length, 2);
    for (const job of jobs) {
      assert.equal(job.building_id, fixture.low.id, 'The selected level-1 foundry must be used instead of the highest level');
      assert.equal(Number(job.ore_spent), 85);
      assert.equal(Number(job.energy_spent), 40, 'An ore link must not stack with the adjacent solar discount');
      assert.equal(Number(job.parts_reward), 35);
    }
    assertSerial(jobs, [300, 300]);
    // Neighbors produce slowly in real time. Inspect the exact prepaid snapshots
    // and bound the balance by elapsed production rather than assuming a fast CI.
    const firstBalance = await balances(fixture.userId);
    const secondsSinceStart = Math.max(0, (Date.now() - jobs[0].started_at) / 1000);
    assert.ok(firstBalance.ore >= 1830 && firstBalance.ore <= 1830 + Math.ceil(secondsSinceStart * 120 / 3600));
    assert.ok(firstBalance.energy >= 1120 && firstBalance.energy <= 1120 + Math.ceil(secondsSinceStart * 100 / 3600));

    const economy = await startFoundry({ buildingId: fixture.low.id, mode: 'economy', link: 'energy', cycles: 1 });
    assert.equal(economy.status, 200, JSON.stringify(economy.data));
    jobs = await foundryJobs(fixture.userId);
    assertSerial(jobs, [300, 300, 600]);
    assert.equal(Number(jobs[2].ore_spent), 100);
    assert.equal(Number(jobs[2].energy_spent), 20);
    assert.equal(Number(jobs[2].parts_reward), 35);

    const rush = await startFoundry({ buildingId: fixture.high.id, mode: 'rush', link: 'none', cycles: 1 });
    assert.equal(rush.status, 200, JSON.stringify(rush.data));
    jobs = await foundryJobs(fixture.userId);
    const independent = jobs.find((job) => job.building_id === fixture.high.id);
    const queued = jobs.filter((job) => job.building_id === fixture.low.id);
    assert.ok(independent);
    assert.ok(independent.started_at < queued[0].completes_at, 'Another foundry must not wait for the first foundry queue');
    assert.equal(independent.completes_at - independent.started_at, Math.ceil(150 / 1.6) * 1000);
    assert.equal(Number(independent.ore_spent), 100);
    assert.equal(Number(independent.energy_spent), 70);
    assert.equal(Number(independent.parts_reward), Math.floor(35 * 1.4));

    const originalJobs = JSON.stringify(jobs);
    await sql`UPDATE buildings SET x=0,y=0 WHERE id=${fixture.mine.id}`;
    await sql`UPDATE buildings SET level=10 WHERE id=${fixture.low.id}`;
    const changedCity = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(changedCity.status, 200, JSON.stringify(changedCity.data));
    assert.equal(JSON.stringify(await foundryJobs(fixture.userId)), originalJobs, 'Moving a neighbor or upgrading a foundry must not reprice work already purchased');
  });

  await t.test('invalid production orders cannot create jobs or spend player resources', async () => {
    const fixture = await productionFixture();
    const valid = { buildingId: fixture.low.id, mode: 'standard', link: 'none', cycles: 1 };
    const invalidOrders = [
      { mode: 'unknown' }, { link: 'unknown' }, { link: 'ore,energy' },
      { cycles: 0 }, { cycles: -1 }, { cycles: 1.5 }, { cycles: 7 },
      { buildingId: foreignFoundryId }, { buildingId: fixture.inactive.id },
      { buildingId: fixture.high.id, link: 'ore' }, { buildingId: 'not-a-uuid' },
    ];
    for (const override of invalidOrders) {
      const before = await balances(fixture.userId);
      const result = await startFoundry({ ...valid, ...override });
      assert.equal(result.status, 400, `${JSON.stringify(override)}: ${JSON.stringify(result.data)}`);
      assert.deepEqual(await balances(fixture.userId), before);
      assert.equal((await foundryJobs(fixture.userId)).length, 0);
    }
    await sql`UPDATE game_states SET ore=99,energy=39 WHERE user_id=${fixture.userId}`;
    const insufficient = await startFoundry(valid);
    assert.equal(insufficient.status, 400, JSON.stringify(insufficient.data));
    assert.deepEqual(await balances(fixture.userId), { ore: 99, energy: 39, parts: 0 });
    assert.equal((await foundryJobs(fixture.userId)).length, 0);
  });

  await t.test('duplicate requests charge once and each foundry enforces its own remaining queue capacity', async () => {
    const fixture = await productionFixture();
    const order = { buildingId: fixture.low.id, mode: 'standard', link: 'none', cycles: 2, requestId: crypto.randomUUID() };
    const duplicates = await Promise.all([startFoundry(order), startFoundry(order)]);
    for (const duplicate of duplicates) assert.equal(duplicate.status, 200, JSON.stringify(duplicate.data));
    assert.equal((await foundryJobs(fixture.userId)).length, 2);
    assert.deepEqual(await balances(fixture.userId), { ore: 1800, energy: 1120, parts: 0 });
    const retry = await startFoundry(order);
    assert.equal(retry.status, 200, JSON.stringify(retry.data));
    assert.equal((await foundryJobs(fixture.userId)).length, 2);
    assert.deepEqual(await balances(fixture.userId), { ore: 1800, energy: 1120, parts: 0 });

    const fillLow = await startFoundry({ ...order, cycles: 4, requestId: crypto.randomUUID() });
    assert.equal(fillLow.status, 200, JSON.stringify(fillLow.data));
    assert.equal((await foundryJobs(fixture.userId)).length, 6);
    const fullBalance = await balances(fixture.userId);
    const overflow = await startFoundry({ ...order, cycles: 1, requestId: crypto.randomUUID() });
    assert.equal(overflow.status, 400, JSON.stringify(overflow.data));
    assert.deepEqual(await balances(fixture.userId), fullBalance);
    assert.equal((await foundryJobs(fixture.userId)).length, 6);

    const fillHigh = await startFoundry({ buildingId: fixture.high.id, mode: 'standard', link: 'none', cycles: 8 });
    assert.equal(fillHigh.status, 200, JSON.stringify(fillHigh.data));
    const jobs = await foundryJobs(fixture.userId);
    assert.equal(jobs.filter((job) => job.building_id === fixture.high.id).length, 8);
    assert.equal(jobs.filter((job) => job.building_id === fixture.low.id).length, 6);
    assert.deepEqual(await balances(fixture.userId), { ore: 600, energy: 640, parts: 0 });
  });

  await t.test('finished production and legacy jobs credit their stored rewards exactly once', async () => {
    const fixture = await productionFixture();
    const started = await startFoundry({ buildingId: fixture.low.id, mode: 'standard', link: 'none', cycles: 2 });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    await sql`
      UPDATE foundry_jobs SET started_at=now()-interval '10 minutes',completes_at=now()-interval '1 minute'
      WHERE user_id=${fixture.userId}
    `;
    // A pre-update job has only the original schema fields and must still settle.
    await sql`
      INSERT INTO foundry_jobs (user_id,building_id,ore_spent,energy_spent,parts_reward,started_at,completes_at)
      VALUES (${fixture.userId},${fixture.high.id},100,40,17,now()-interval '15 minutes',now()-interval '2 minutes')
    `;
    for (let attempt = 0; attempt < 2; attempt++) {
      const collected = await request('/api/session', { method: 'POST', auth: initData(playerId) });
      assert.equal(collected.status, 200, JSON.stringify(collected.data));
      assert.equal(Number(collected.data.state.parts), 87);
      assert.equal(collected.data.activeJobs.length, 0);
      const jobs = await foundryJobs(fixture.userId);
      assert.equal(jobs.length, 3);
      assert.ok(jobs.every((job) => job.claimed_at !== null));
      assert.deepEqual(await balances(fixture.userId), { ore: 1800, energy: 1120, parts: 87 });
    }
  });

  await t.test('a full warehouse preserves finished jobs and respects resources reserved on the market', async () => {
    const fixture = await productionFixture();
    await sql`UPDATE game_states SET parts=800 WHERE user_id=${fixture.userId}`;
    await sql`
      INSERT INTO foundry_jobs (user_id,building_id,ore_spent,energy_spent,parts_reward,started_at,completes_at)
      VALUES (${fixture.userId},${fixture.low.id},100,40,35,now()-interval '10 minutes',now()-interval '1 minute')
    `;
    const full = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(full.status, 200, JSON.stringify(full.data));
    assert.equal(Number(full.data.state.parts), 800);
    assert.equal((await foundryJobs(fixture.userId))[0].claimed_at, null);

    // Upgrading a warehouse temporarily removes its active capacity. Existing
    // stock above that reduced limit must survive, while new output still waits.
    await sql`
      INSERT INTO buildings (user_id,type,level,x,y,status,target_level,completes_at)
      VALUES (${fixture.userId},'warehouse',1,0,4,'upgrading',2,now()+interval '1 day')
    `;
    await sql`UPDATE game_states SET parts=900 WHERE user_id=${fixture.userId}`;
    const reducedCapacity = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(reducedCapacity.status, 200, JSON.stringify(reducedCapacity.data));
    assert.equal(Number(reducedCapacity.data.caps.parts), 800);
    assert.equal(Number(reducedCapacity.data.state.parts), 900, 'A capacity reduction must not destroy stored parts');
    assert.equal((await foundryJobs(fixture.userId))[0].claimed_at, null, 'Output must wait while stock exceeds capacity');

    await sql`
      INSERT INTO market_orders (user_id,resource,amount_total,amount_remaining,unit_price,expires_at)
      VALUES (${fixture.userId},'parts',100,100,20,now()+interval '1 day')
    `;
    await sql`UPDATE game_states SET parts=700 WHERE user_id=${fixture.userId}`;
    const reserved = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(reserved.status, 200, JSON.stringify(reserved.data));
    assert.equal(Number(reserved.data.state.parts), 700);
    assert.equal(Number(reserved.data.escrow.parts), 100);
    assert.equal((await foundryJobs(fixture.userId))[0].claimed_at, null, 'Escrow must reserve warehouse capacity');

    await sql`UPDATE game_states SET parts=665 WHERE user_id=${fixture.userId}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const collected = await request('/api/session', { method: 'POST', auth: initData(playerId) });
      assert.equal(collected.status, 200, JSON.stringify(collected.data));
      assert.equal(Number(collected.data.state.parts), 700);
      assert.equal(Number(collected.data.escrow.parts), 100);
      assert.equal(collected.data.activeJobs.length, 0);
      assert.notEqual((await foundryJobs(fixture.userId))[0].claimed_at, null);
    }
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
