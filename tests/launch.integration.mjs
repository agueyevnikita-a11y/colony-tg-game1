import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import postgres from 'postgres';
import { runContractsIntegration } from './contracts.integration.mjs';
import { runDecorIntegration } from './decor.integration.mjs';
import { runReferralsIntegration } from './referrals.integration.mjs';
import { runUnlocksIntegration } from './unlocks.integration.mjs';
import { runInboxIntegration } from './inbox.integration.mjs';
import { runQuestRewardsIntegration } from './quest-rewards.integration.mjs';
import { runSeasonRewardsIntegration } from './season-rewards.integration.mjs';
import { runAllianceSocialIntegration } from './alliance-social.integration.mjs';

test('production Mini App launch against PostgreSQL', { skip: process.env.COLONY_TEST_DATABASE !== '1', timeout: 240_000 }, async (t) => {
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

  function initData(id, userFields = {}, authDate = Math.floor(Date.now() / 1000), startParam) {
    const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id, first_name: 'Launch test', ...userFields }), ...(startParam ? { start_param: startParam } : {}) });
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
  await t.test('local scenario tools stay unavailable in production and do not create test identities', async () => {
    const before = await sql`SELECT telegram_id FROM users WHERE telegram_id IN (10001,11001,11002) ORDER BY telegram_id`;
    assert.equal((await request('/api/local/profiles')).status, 404);
    assert.equal((await request('/api/local/profiles', { method: 'POST', body: { profile: 'developed' } })).status, 404);
    assert.equal((await request('/api/local/profiles', { method: 'POST', auth: initData(playerId), body: { profile: 'new' } })).status, 404);
    const after = await sql`SELECT telegram_id FROM users WHERE telegram_id IN (10001,11001,11002) ORDER BY telegram_id`;
    assert.deepEqual(after, before);
  });
  await t.test('recipe migration backfills legacy jobs and can be applied twice without repricing them', async () => {
    const migration = await readFile(new URL('../db/migrations/012_v1_4_recipes.sql', import.meta.url), 'utf8');
    await sql.begin(async (tx) => {
      // A transaction-local table shadows the live test table only on this connection.
      await tx`
        CREATE TEMP TABLE foundry_jobs (
          id UUID PRIMARY KEY,
          ore_spent BIGINT NOT NULL,
          energy_spent BIGINT NOT NULL,
          parts_reward BIGINT NOT NULL,
          started_at TIMESTAMPTZ NOT NULL,
          completes_at TIMESTAMPTZ NOT NULL
        ) ON COMMIT DROP
      `;
      const legacyId = crypto.randomUUID();
      const before = (await tx`
        INSERT INTO foundry_jobs (id,ore_spent,energy_spent,parts_reward,started_at,completes_at)
        VALUES (${legacyId},100,40,35,now()-interval '10 minutes',now()-interval '5 minutes') RETURNING *
      `)[0];
      await tx.unsafe(migration);
      await tx.unsafe(migration);
      const migrated = (await tx`SELECT * FROM foundry_jobs WHERE id=${legacyId}`)[0];
      assert.equal(migrated.recipe_key, 'standard_alloy');
      const { recipe_key, ...retained } = migrated;
      assert.deepEqual(retained, before, 'The migration must preserve prepaid rewards, costs and timestamps');
      const nextId = crypto.randomUUID();
      const next = (await tx`
        INSERT INTO foundry_jobs (id,ore_spent,energy_spent,parts_reward,started_at,completes_at)
        VALUES (${nextId},100,40,35,now(),now()+interval '5 minutes') RETURNING recipe_key
      `)[0];
      assert.equal(next.recipe_key, 'standard_alloy', 'Legacy callers omitting a recipe must retain their default');
      await tx`UPDATE foundry_jobs SET recipe_key='precision_casting' WHERE id=${nextId}`;
      await tx.unsafe(migration);
      assert.equal((await tx`SELECT recipe_key FROM foundry_jobs WHERE id=${nextId}`)[0].recipe_key, 'precision_casting');
      const definition = (await tx`
        SELECT a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS default_value
        FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid='pg_temp.foundry_jobs'::regclass AND a.attname='recipe_key'
      `)[0];
      assert.equal(definition.attnotnull, true);
      assert.match(definition.default_value, /standard_alloy/);
    });
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
    assert.equal(first.data.colonyEvents.unlocked, false);
    const second = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.userId, first.data.userId);
    assert.equal(second.data.buildings.length, 4);
    // This existing regression fixture represents a colony with retained access.
    // Separate unlock tests exercise fresh accounts without these grants.
    await sql`INSERT INTO colony_feature_access(user_id,feature_key) VALUES(${first.data.userId},'market'),(${first.data.userId},'expeditions') ON CONFLICT DO NOTHING`;
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
  async function productionFixture({ activeNeighbors = false, completed = [], activeResearch } = {}) {
    const user = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0];
    assert.ok(user, 'The signed session must have created the test player');
    if (!foreignFoundryId) {
      const admin = await request('/api/session', { method: 'POST', auth: initData(adminId) });
      assert.equal(admin.status, 200, JSON.stringify(admin.data));
      await sql`INSERT INTO colony_feature_access(user_id,feature_key) VALUES(${admin.data.userId},'market'),(${admin.data.userId},'expeditions') ON CONFLICT DO NOTHING`;
      foreignFoundryId = (await sql`
        INSERT INTO buildings (user_id,type,level,x,y,status)
        VALUES (${admin.data.userId},'foundry',1,1,1,'active') RETURNING id
      `)[0].id;
    }
    // Only the two isolated users created by this test can be changed here.
    // No warehouse gives the documented base capacity of 800 parts.
    await sql`DELETE FROM market_orders WHERE user_id=${user.id}`;
    await sql`DELETE FROM user_research WHERE user_id=${user.id}`;
    await sql`DELETE FROM buildings WHERE user_id=${user.id}`;
    await sql`DELETE FROM api_rate_limits WHERE bucket_key=${`global:${user.id}`}`;
    for (const researchKey of completed) {
      await sql`
        INSERT INTO user_research (user_id,research_key,status,started_at,completes_at,completed_at)
        VALUES (${user.id},${researchKey},'completed',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day')
      `;
    }
    if (activeResearch) {
      await sql`
        INSERT INTO user_research (user_id,research_key,status,started_at,completes_at)
        VALUES (${user.id},${activeResearch},'researching',now(),now()+interval '1 day')
      `;
    }
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
      { recipe: 'unknown' }, { recipe: 'constructor' }, { recipe: null }, { recipe: 1 }, { recipe: {} },
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
      assert.ok(jobs.every((job) => job.recipe_key === 'standard_alloy'));
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

  await t.test('legacy production requests retain the standard alloy recipe without research', async () => {
    const fixture = await productionFixture();
    const result = await startFoundry({ buildingId: fixture.low.id });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const jobs = await foundryJobs(fixture.userId);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].recipe_key, 'standard_alloy');
    assert.equal(Number(jobs[0].ore_spent), 100);
    assert.equal(Number(jobs[0].energy_spent), 40);
    assert.equal(Number(jobs[0].parts_reward), 35);
    assertSerial(jobs, [300]);
    assert.deepEqual(await balances(fixture.userId), { ore: 1900, energy: 1160, parts: 0 });
  });

  await t.test('advanced recipes require completed research and snapshot their prices and research bonus', async () => {
    for (const recipe of [
      { key: 'precision_casting', ore: 70, energy: 90, parts: 38, seconds: 420 },
      { key: 'industrial_casting', ore: 240, energy: 60, parts: 77, seconds: 600 },
    ]) {
      const fixture = await productionFixture({ completed: ['basic_theory', 'thermal_recovery', 'extraction_ai'] });
      const order = { buildingId: fixture.low.id, recipe: recipe.key, mode: 'standard', link: 'none', cycles: 1 };
      const before = await balances(fixture.userId);
      const missing = await startFoundry(order);
      assert.equal(missing.status, 400, JSON.stringify(missing.data));
      assert.deepEqual(await balances(fixture.userId), before, 'Posting a locked recipe directly must not charge resources');
      assert.equal((await foundryJobs(fixture.userId)).length, 0);
      await sql`
        INSERT INTO user_research (user_id,research_key,status,started_at,completes_at)
        VALUES (${fixture.userId},${recipe.key},'researching',now(),now()+interval '1 hour')
      `;
      const pending = await startFoundry(order);
      assert.equal(pending.status, 400, JSON.stringify(pending.data));
      assert.deepEqual(await balances(fixture.userId), before, 'An unfinished technology must not unlock its recipe');
      assert.equal((await foundryJobs(fixture.userId)).length, 0);
      await sql`
        UPDATE user_research SET completes_at=now()-interval '1 second'
        WHERE user_id=${fixture.userId} AND research_key=${recipe.key}
      `;
      const unlocked = await startFoundry(order);
      assert.equal(unlocked.status, 200, JSON.stringify(unlocked.data));
      assert.ok(unlocked.data.research.completed.includes(recipe.key));
      assert.equal(unlocked.data.production.partsMultiplier, 1.1);
      const jobs = await foundryJobs(fixture.userId);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].recipe_key, recipe.key);
      assert.equal(Number(jobs[0].ore_spent), recipe.ore);
      assert.equal(Number(jobs[0].energy_spent), recipe.energy);
      assert.equal(Number(jobs[0].parts_reward), recipe.parts);
      assertSerial(jobs, [recipe.seconds]);
      assert.deepEqual(await balances(fixture.userId), { ore: before.ore - recipe.ore, energy: before.energy - recipe.energy, parts: 0 });
    }
  });

  await t.test('mixed recipe queues retain serial prepaid snapshots and durable duplicate receipts after completion', async () => {
    const fixture = await productionFixture({ activeNeighbors: true, completed: ['thermal_recovery', 'precision_casting', 'industrial_casting'] });
    const precision = await startFoundry({ buildingId: fixture.low.id, recipe: 'precision_casting', mode: 'standard', link: 'ore', cycles: 1 });
    assert.equal(precision.status, 200, JSON.stringify(precision.data));
    const industrialOrder = { buildingId: fixture.low.id, recipe: 'industrial_casting', mode: 'rush', link: 'energy', cycles: 1, requestId: crypto.randomUUID() };
    const duplicates = await Promise.all([startFoundry(industrialOrder), startFoundry(industrialOrder)]);
    for (const duplicate of duplicates) assert.equal(duplicate.status, 200, JSON.stringify(duplicate.data));
    assert.equal((await foundryJobs(fixture.userId)).length, 2);
    assert.deepEqual(await balances(fixture.userId), { ore: 1700, energy: 1026, parts: 0 });
    const standard = await startFoundry({ buildingId: fixture.low.id, recipe: 'standard_alloy', mode: 'economy', link: 'ore', cycles: 1 });
    assert.equal(standard.status, 200, JSON.stringify(standard.data));
    const independent = await startFoundry({ buildingId: fixture.high.id, recipe: 'industrial_casting', mode: 'standard', link: 'none', cycles: 1 });
    assert.equal(independent.status, 200, JSON.stringify(independent.data));
    let jobs = await foundryJobs(fixture.userId);
    const queue = jobs.filter((job) => job.building_id === fixture.low.id);
    assertSerial(queue, [420, 300, 600]);
    assert.deepEqual(queue.map((job) => ({ recipe: job.recipe_key, ore: Number(job.ore_spent), energy: Number(job.energy_spent), parts: Number(job.parts_reward) })), [
      { recipe: 'precision_casting', ore: 60, energy: 90, parts: 38 },
      { recipe: 'industrial_casting', ore: 240, energy: 84, parts: 77 },
      { recipe: 'standard_alloy', ore: 85, energy: 25, parts: 38 },
    ]);
    const other = jobs.find((job) => job.building_id === fixture.high.id);
    assert.equal(other.recipe_key, 'industrial_casting');
    assert.equal(other.completes_at - other.started_at, 375_000);
    assert.equal(Number(other.parts_reward), 107);
    assert.ok(other.started_at < queue[0].completes_at, 'A different foundry must not wait for the mixed queue');
    assert.deepEqual(await balances(fixture.userId), { ore: 1375, energy: 941, parts: 0 });
    const snapshots = JSON.stringify(jobs);
    await sql`UPDATE buildings SET x=0,y=0 WHERE id=${fixture.mine.id}`;
    await sql`UPDATE buildings SET level=10 WHERE id=${fixture.low.id}`;
    const changed = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal(JSON.stringify(await foundryJobs(fixture.userId)), snapshots, 'Changing the city must not reprice, reschedule or change the purchased recipe');
    await sql`
      UPDATE foundry_jobs SET started_at=now()-interval '2 hours',completes_at=now()-interval '1 hour'
      WHERE user_id=${fixture.userId}
    `;
    const finished = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(finished.status, 200, JSON.stringify(finished.data));
    assert.equal(Number(finished.data.state.parts), 260);
    assert.equal(finished.data.activeJobs.length, 0);
    const settled = JSON.stringify(await foundryJobs(fixture.userId));
    const beforeRetry = await balances(fixture.userId);
    const retry = await startFoundry(industrialOrder);
    assert.equal(retry.status, 200, JSON.stringify(retry.data));
    assert.equal(retry.data.result.alreadyStarted, true);
    assert.deepEqual(await balances(fixture.userId), beforeRetry, 'Retrying an already collected batch must not pay or grant output twice');
    jobs = await foundryJobs(fixture.userId);
    assert.equal(jobs.length, 4);
    assert.ok(jobs.every((job) => job.claimed_at !== null));
    assert.equal(JSON.stringify(jobs), settled);
  });

  await t.test('an older database keeps standard production playable until the recipe migration is applied', async () => {
    const fixture = await productionFixture({ completed: ['thermal_recovery', 'precision_casting'] });
    let renamed = false;
    try {
      // This suite only runs against the guarded local colony_ci/colony_test database.
      // A reversible rename simulates its pre-migration schema without deleting jobs.
      await sql`ALTER TABLE public.foundry_jobs RENAME COLUMN recipe_key TO recipe_key_pending`;
      renamed = true;
      const ready = await request('/api/ready');
      assert.equal(ready.status, 503, JSON.stringify(ready.data));
      assert.equal(ready.data.checks.schema, 'error');
      const session = await request('/api/session', { method: 'POST', auth: initData(playerId) });
      assert.equal(session.status, 200, JSON.stringify(session.data));
      assert.equal(session.data.production.recipesEnabled, false);
      assert.deepEqual(session.data.production.unlockedRecipes, ['standard_alloy']);
      const legacy = await startFoundry({ buildingId: fixture.low.id });
      assert.equal(legacy.status, 200, JSON.stringify(legacy.data));
      const jobs = await foundryJobs(fixture.userId);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].recipe_key, undefined);
      assert.equal(jobs[0].recipe_key_pending, 'standard_alloy');
      assert.equal(Number(jobs[0].ore_spent), 100);
      assert.equal(Number(jobs[0].energy_spent), 40);
      assert.equal(Number(jobs[0].parts_reward), 38);
      assertSerial(jobs, [300]);
      assert.deepEqual(await balances(fixture.userId), { ore: 1900, energy: 1160, parts: 0 });
      const before = await balances(fixture.userId);
      const advanced = await startFoundry({ buildingId: fixture.low.id, recipe: 'precision_casting' });
      assert.equal(advanced.status, 400, JSON.stringify(advanced.data));
      assert.deepEqual(await balances(fixture.userId), before, 'A pending migration must block advanced recipes before charging resources');
      assert.equal((await foundryJobs(fixture.userId)).length, 1);
    } finally {
      if (renamed) await sql`ALTER TABLE public.foundry_jobs RENAME COLUMN recipe_key_pending TO recipe_key`;
    }
    const restored = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(restored.status, 200, JSON.stringify(restored.data));
    assert.equal(restored.data.production.recipesEnabled, true);
    assert.ok(restored.data.production.unlockedRecipes.includes('precision_casting'));
    const advanced = await startFoundry({ buildingId: fixture.low.id, recipe: 'precision_casting' });
    assert.equal(advanced.status, 200, JSON.stringify(advanced.data));
    const jobs = await foundryJobs(fixture.userId);
    assert.equal(jobs.length, 2);
    assert.deepEqual(jobs.map((job) => job.recipe_key), ['standard_alloy', 'precision_casting']);
    assert.equal(Number(jobs[1].ore_spent), 70);
    assert.equal(Number(jobs[1].energy_spent), 90);
    assert.equal(Number(jobs[1].parts_reward), 38);
    assertSerial(jobs, [300, 420]);
    assert.deepEqual(await balances(fixture.userId), { ore: 1830, energy: 1070, parts: 0 });
    assert.equal((await request('/api/ready')).status, 200, 'Readiness must recover after the migration becomes visible');
  });

  async function researchFixture({ hqLevel = 3, labLevel = 2, labStatus = 'active', completed = [], active,
    science = 2000, credits = 10000, parts = 800 } = {}) {
    const userId = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0].id;
    await sql`DELETE FROM market_orders WHERE user_id=${userId}`;
    await sql`DELETE FROM user_research WHERE user_id=${userId}`;
    await sql`DELETE FROM buildings WHERE user_id=${userId}`;
    await sql`DELETE FROM api_rate_limits WHERE bucket_key=${`global:${userId}`}`;
    await sql`UPDATE player_stats SET research_completed=0 WHERE user_id=${userId}`;
    await sql`
      INSERT INTO buildings (user_id,type,level,x,y,status,created_at)
      VALUES (${userId},'hq',${hqLevel},2,2,'active',now()-interval '2 days')
    `;
    if (labLevel) {
      await sql`
        INSERT INTO buildings (user_id,type,level,x,y,status,target_level,completes_at,created_at)
        VALUES (${userId},'research_lab',${labLevel},1,1,${labStatus},
          ${labStatus === 'active' ? null : labLevel + 1},
          ${labStatus === 'active' ? null : new Date(Date.now() + 86_400_000)},now()-interval '2 days')
      `;
    }
    for (const researchKey of completed) {
      await sql`
        INSERT INTO user_research (user_id,research_key,status,started_at,completes_at,completed_at)
        VALUES (${userId},${researchKey},'completed',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day')
      `;
    }
    if (active) {
      await sql`
        INSERT INTO user_research (user_id,research_key,status,started_at,completes_at)
        VALUES (${userId},${active},'researching',now(),now()+interval '1 day')
      `;
    }
    await sql`
      UPDATE game_states SET hq_level=${hqLevel},ore=2000,energy=1200,parts=${parts},credits=${credits},science=${science},
        premium_until=NULL,passive_carry='{}'::jsonb,last_tick_at=now()+interval '1 day' WHERE user_id=${userId}
    `;
    return { userId };
  }
  function startResearch(researchKey) {
    return request('/api/game/research/start', { method: 'POST', auth: initData(playerId), body: { researchKey } });
  }
  function build(type, x = 0, y = 0) {
    return request('/api/game/build', { method: 'POST', auth: initData(playerId), body: { type, x, y } });
  }
  async function researchBalances(userId) {
    const row = (await sql`SELECT ore,energy,parts,credits,science FROM game_states WHERE user_id=${userId}`)[0];
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  }
  async function researchRows(userId) {
    return sql`SELECT research_key,status,started_at,completes_at,completed_at FROM user_research WHERE user_id=${userId} ORDER BY research_key`;
  }
  async function resetPassiveTick(userId) {
    await sql`UPDATE game_states SET last_tick_at=now()+interval '1 day',passive_carry='{}'::jsonb WHERE user_id=${userId}`;
  }

  await t.test('HQ upgrade preview quotes the same standard and Premium duration as the accepted upgrade', async () => {
    for (const premium of [false, true]) {
      // researchFixture only touches this suite's randomly generated CI player.
      const { userId } = await researchFixture({ hqLevel: 1, labLevel: 0 });
      try {
        if (premium) await sql`UPDATE game_states SET premium_until=now()+interval '1 day' WHERE user_id=${userId}`;
        const session = await request('/api/session', { method: 'POST', auth: initData(playerId) });
        assert.equal(session.status, 200, JSON.stringify(session.data));
        const hq = session.data.buildings.find((building) => building.type === 'hq');
        assert.ok(hq?.nextUpgrade, 'An active level-1 HQ must advertise its configured next upgrade');
        assert.equal(hq.nextUpgrade.level, 2);
        assert.equal(hq.nextUpgrade.timeSec, premium ? 114 : 120, 'The preview must include the existing 5% Premium build-speed bonus');

        const upgraded = await request('/api/game/building/upgrade', {
          method: 'POST', auth: initData(playerId), body: { buildingId: hq.id },
        });
        assert.equal(upgraded.status, 200, JSON.stringify(upgraded.data));
        assert.equal(upgraded.data.result.targetLevel, hq.nextUpgrade.level);
        assert.equal(upgraded.data.result.seconds, hq.nextUpgrade.timeSec, 'Displayed duration must equal the actual accepted upgrade duration');
      } finally {
        await sql`UPDATE game_states SET premium_until=NULL WHERE user_id=${userId}`;
      }
    }
  });

  await t.test('research catalog remains visible before a laboratory exists or while it is upgrading', async () => {
    for (const options of [{ labLevel: 0 }, { labLevel: 1, labStatus: 'building' }, { labLevel: 1, labStatus: 'upgrading', active: 'basic_theory' }]) {
      await researchFixture(options);
      const session = await request('/api/session', { method: 'POST', auth: initData(playerId) });
      assert.equal(session.status, 200, JSON.stringify(session.data));
      assert.equal(session.data.research.enabled, false);
      assert.equal(session.data.research.labStatus, options.labLevel === 0 ? 'missing' : options.labStatus);
      if (options.active) assert.equal(session.data.research.active.research_key, options.active);
      assert.equal(Number(session.data.scienceRate), 0);
      const catalog = session.data.research.catalog;
      assert.ok(catalog.some((tech) => tech.key === 'deep_drilling'));
      assert.ok(catalog.some((tech) => tech.key === 'photovoltaic_arrays'));
      assert.ok(catalog.every((tech) => tech.unlockedByLab === false));
      const basic = catalog.find((tech) => tech.key === 'basic_theory');
      assert.equal(basic.science, 20);
      assert.equal(basic.cost.credits, 300);
      assert.equal(basic.timeSec, 300);
    }
  });

  await t.test('research requirements reject unavailable laboratories, prerequisites and funds without payment', async () => {
    const prerequisites = ['basic_theory', 'extraction_ai'];
    const cases = [
      { options: { labLevel: 0 }, key: 'basic_theory' },
      { options: { labStatus: 'upgrading' }, key: 'basic_theory' },
      { options: { hqLevel: 1, labLevel: 1 }, key: 'basic_theory' },
      { options: { labLevel: 1, completed: prerequisites }, key: 'deep_drilling' },
      { options: { completed: ['basic_theory'] }, key: 'deep_drilling' },
      { options: { completed: prerequisites, science: 359 }, key: 'deep_drilling' },
      { options: { completed: prerequisites, credits: 2799 }, key: 'deep_drilling' },
      { options: { completed: prerequisites, parts: 159 }, key: 'deep_drilling' },
      { options: { completed: prerequisites, active: 'solar_lattice' }, key: 'deep_drilling' },
      { options: {}, key: 'unknown_research' },
    ];
    for (const { options, key } of cases) {
      const { userId } = await researchFixture(options);
      const before = await researchBalances(userId);
      const rowsBefore = JSON.stringify(await researchRows(userId));
      const result = await startResearch(key);
      assert.equal(result.status, 400, `${JSON.stringify(options)}: ${JSON.stringify(result.data)}`);
      assert.deepEqual(await researchBalances(userId), before, `Rejected ${key} must not charge any resource`);
      assert.equal(JSON.stringify(await researchRows(userId)), rowsBefore);
    }
  });

  await t.test('parallel research starts pay once and completion grants the basic science bonus once', async () => {
    const { userId } = await researchFixture({ hqLevel: 2, labLevel: 1, science: 1000 });
    const starts = await Promise.all([startResearch('basic_theory'), startResearch('basic_theory')]);
    assert.deepEqual(starts.map((result) => result.status).sort(), [200, 400], JSON.stringify(starts));
    assert.deepEqual(await researchBalances(userId), { ore: 2000, energy: 1200, parts: 800, credits: 9700, science: 980 });
    let rows = await researchRows(userId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'researching');
    assert.equal(rows[0].completes_at - rows[0].started_at, 300_000);

    await sql`UPDATE user_research SET started_at=now()-interval '6 minutes',completes_at=now()-interval '1 minute' WHERE user_id=${userId}`;
    await resetPassiveTick(userId);
    const completed = await Promise.all([
      request('/api/session', { method: 'POST', auth: initData(playerId) }),
      request('/api/session', { method: 'POST', auth: initData(playerId) }),
    ]);
    for (const session of completed) {
      assert.equal(session.status, 200, JSON.stringify(session.data));
      assert.equal(session.data.research.active, null);
      assert.ok(session.data.research.completed.includes('basic_theory'));
      assert.ok(Math.abs(Number(session.data.scienceRate) - 19.8) < 1e-9);
      assert.equal(Number(session.data.stats.research_completed), 1);
    }
    const paid = await researchBalances(userId);
    assert.equal((await startResearch('basic_theory')).status, 400);
    assert.deepEqual(await researchBalances(userId), paid);

    await resetPassiveTick(userId);
    const branches = await Promise.all([startResearch('extraction_ai'), startResearch('solar_lattice')]);
    assert.deepEqual(branches.map((result) => result.status).sort(), [200, 400], JSON.stringify(branches));
    rows = await researchRows(userId);
    assert.equal(rows.filter((row) => row.status === 'researching').length, 1, 'Different branches must share one research slot');
    assert.deepEqual(await researchBalances(userId), { ore: 2000, energy: 1200, parts: 760, credits: 8500, science: 820 });
  });

  await t.test('new production buildings require their completed technology while ordinary mines remain available', async () => {
    for (const branch of [
      { key: 'deep_drilling', prerequisite: 'extraction_ai', building: 'deep_mine', ore: 900, parts: 180, credits: 1600 },
      { key: 'photovoltaic_arrays', prerequisite: 'solar_lattice', building: 'solar_array', ore: 800, parts: 160, credits: 1400 },
    ]) {
      const { userId } = await researchFixture({ completed: ['basic_theory', branch.prerequisite] });
      let before = await researchBalances(userId);
      const locked = await build(branch.building);
      assert.equal(locked.status, 400, JSON.stringify(locked.data));
      assert.deepEqual(await researchBalances(userId), before);
      assert.equal((await sql`SELECT id FROM buildings WHERE user_id=${userId} AND type=${branch.building}`).length, 0);

      const ordinary = await build('mine', 4, 4);
      assert.equal(ordinary.status, 200, JSON.stringify(ordinary.data));
      assert.deepEqual(await researchBalances(userId), { ...before, ore: before.ore - 120, credits: before.credits - 100 });
      await sql`DELETE FROM buildings WHERE user_id=${userId} AND type='mine'`;
      await resetPassiveTick(userId);
      before = await researchBalances(userId);
      const started = await startResearch(branch.key);
      assert.equal(started.status, 200, JSON.stringify(started.data));
      assert.equal(started.data.catalog.find(item => item.type === branch.building).unlockedByResearch, false);
      assert.deepEqual(await researchBalances(userId), { ...before, science: before.science - 360, credits: before.credits - 2800, parts: before.parts - 160 });
      const active = (await researchRows(userId)).find((row) => row.research_key === branch.key);
      assert.equal(active.completes_at - active.started_at, 3_600_000);

      before = await researchBalances(userId);
      const pending = await build(branch.building);
      assert.equal(pending.status, 400, JSON.stringify(pending.data));
      assert.deepEqual(await researchBalances(userId), before, 'Starting research must not unlock construction early');
      await sql`UPDATE user_research SET completes_at=now()-interval '1 second' WHERE user_id=${userId} AND research_key=${branch.key}`;
      await resetPassiveTick(userId);
      for (let attempt = 0; attempt < 2; attempt++) {
        const finished = await request('/api/session', { method: 'POST', auth: initData(playerId) });
        assert.equal(finished.status, 200, JSON.stringify(finished.data));
        assert.ok(finished.data.research.completed.includes(branch.key));
        assert.equal(Number(finished.data.stats.research_completed), 1);
        assert.equal(finished.data.catalog.find(item => item.type === branch.building).unlockedByResearch, true);
      }

      await resetPassiveTick(userId);
      before = await researchBalances(userId);
      const unlocked = await build(branch.building);
      assert.equal(unlocked.status, 200, JSON.stringify(unlocked.data));
      assert.deepEqual(await researchBalances(userId), { ...before, ore: before.ore - branch.ore, parts: before.parts - branch.parts, credits: before.credits - branch.credits });
      const buildings = await sql`SELECT * FROM buildings WHERE user_id=${userId} AND type=${branch.building}`;
      assert.equal(buildings.length, 1);
      assert.equal(buildings[0].status, 'building');
      assert.equal(buildings[0].target_level, 1);
      assert.equal(buildings[0].completes_at - buildings[0].created_at, 600_000);
    }
    const { userId } = await researchFixture({ hqLevel: 2, completed: ['basic_theory', 'extraction_ai', 'deep_drilling'] });
    const before = await researchBalances(userId);
    assert.equal((await build('deep_mine')).status, 400, 'A completed technology must not bypass the HQ requirement');
    assert.deepEqual(await researchBalances(userId), before);
  });

  await t.test('research completed halfway through an offline hour only boosts the second half', async () => {
    const { userId } = await researchFixture({ hqLevel: 2, labLevel: 1, completed: ['basic_theory'] });
    const anchor = Date.now();
    await sql`
      INSERT INTO buildings (user_id,type,level,x,y,status,created_at)
      VALUES (${userId},'mine',1,0,0,'active',${new Date(anchor - 7_200_000)})
    `;
    await sql`
      INSERT INTO user_research (user_id,research_key,status,started_at,completes_at)
      VALUES (${userId},'extraction_ai','researching',${new Date(anchor - 3_600_000)},${new Date(anchor - 1_800_000)})
    `;
    await sql`
      UPDATE game_states SET ore=0,passive_carry='{}'::jsonb,last_tick_at=${new Date(anchor - 3_600_000)} WHERE user_id=${userId}
    `;
    const session = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(session.status, 200, JSON.stringify(session.data));
    assert.ok(session.data.research.completed.includes('extraction_ai'));
    assert.equal(Number(session.data.stats.research_completed), 1);
    const income = Number(session.data.state.ore) + Number(session.data.state.passive_carry.ore ?? 0);
    const elapsedAfterCompletion = (new Date(session.data.state.last_tick_at).getTime() - (anchor - 1_800_000)) / 3_600_000;
    const expected = 120 * 0.5 + 120 * 1.07 * elapsedAfterCompletion;
    assert.ok(Math.abs(income - expected) < 0.1, `Expected about ${expected} ore, received ${income}; the bonus must not be retroactive`);
  });

  await t.test('storage research does not restore overflow lost before its completion', async () => {
    const { userId } = await researchFixture({ labLevel: 0 });
    const anchor = Date.now();
    await sql`
      INSERT INTO buildings (user_id,type,level,x,y,status,created_at)
      VALUES (${userId},'mine',1,0,0,'active',${new Date(anchor - 7_200_000)})
    `;
    await sql`
      INSERT INTO user_research (user_id,research_key,status,started_at,completes_at)
      VALUES (${userId},'compact_storage','researching',${new Date(anchor - 3_600_000)},${new Date(anchor - 1_800_000)})
    `;
    await sql`UPDATE game_states SET ore=1999,last_tick_at=${new Date(anchor - 3_600_000)},passive_carry='{}'::jsonb WHERE user_id=${userId}`;
    const session = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(session.status, 200, JSON.stringify(session.data));
    assert.equal(session.data.caps.ore, 2200);
    const afterCompletion = (new Date(session.data.state.last_tick_at).getTime() - (anchor - 1_800_000)) / 3_600_000;
    const expected = 2000 + 120 * afterCompletion;
    const actual = Number(session.data.state.ore) + Number(session.data.state.passive_carry.ore ?? 0);
    assert.ok(Math.abs(actual - expected) < 0.1, `Expected ${expected}, received ${actual}; a larger warehouse must not restore earlier overflow`);
  });

  await t.test('a laboratory completed during an offline hour earns science only after it is ready', async () => {
    const { userId } = await researchFixture({ labLevel: 0, science: 0 });
    const anchor = Date.now();
    await sql`
      INSERT INTO buildings (user_id,type,level,x,y,status,target_level,completes_at,created_at)
      VALUES (${userId},'research_lab',0,1,1,'building',1,${new Date(anchor - 1_800_000)},${new Date(anchor - 3_600_000)})
    `;
    await sql`UPDATE game_states SET last_tick_at=${new Date(anchor - 3_600_000)},passive_carry='{}'::jsonb WHERE user_id=${userId}`;
    const session = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(session.status, 200, JSON.stringify(session.data));
    assert.equal(session.data.research.labStatus, 'active');
    assert.equal(session.data.scienceRate, 18);
    const afterCompletion = (new Date(session.data.state.last_tick_at).getTime() - (anchor - 1_800_000)) / 3_600_000;
    const actual = Number(session.data.state.science) + Number(session.data.state.passive_carry.science ?? 0);
    assert.ok(Math.abs(actual - 18 * afterCompletion) < 0.1, `Expected science only after lab completion, received ${actual}`);
  });

  await t.test('tutorial keeps ordered progress, waits for buildings and grants every reward only once', async () => {
    const userId = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0].id;
    await sql`DELETE FROM market_orders WHERE user_id=${userId}`;
    await sql`DELETE FROM user_research WHERE user_id=${userId}`;
    await sql`DELETE FROM buildings WHERE user_id=${userId}`;
    await sql`DELETE FROM city_decor WHERE user_id=${userId}`;
    await sql`DELETE FROM npc_contracts WHERE user_id=${userId}`;
    await sql`DELETE FROM tutorial_claims WHERE user_id=${userId}`;
    await sql`DELETE FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id='title_cadet'`;
    await sql`DELETE FROM api_rate_limits WHERE bucket_key=${`global:${userId}`}`;
    await sql`UPDATE player_stats SET foundry_jobs_started=0,contracts_completed=0 WHERE user_id=${userId}`;
    await sql`
      UPDATE game_states SET hq_level=1,ore=500,energy=200,parts=100,credits=1000,crystals=0,science=0,
        premium_until=NULL,tutorial_step=0,tutorial_completed_at=NULL,
        passive_carry='{}'::jsonb,last_tick_at=now()+interval '1 day' WHERE user_id=${userId}
    `;
    const hq = (await sql`
      INSERT INTO buildings (user_id,type,level,x,y,status)
      VALUES (${userId},'hq',1,2,2,'active') RETURNING id
    `)[0];
    const keys = ['welcome', 'build_foundry', 'first_smelt', 'build_trade_hub', 'first_contract', 'hq2'];
    const rewards = [
      { ore: 50, credits: 100 }, { energy: 60, credits: 100 }, { parts: 15, credits: 100 },
      { credits: 200 }, { ore: 350, parts: 20, credits: 250, crystals: 8 }, { crystals: 20 },
    ];
    const claim = () => request('/api/game/tutorial/claim', { method: 'POST', auth: initData(playerId) });
    const state = async () => (await sql`
      SELECT ore,energy,parts,credits,crystals,tutorial_step,tutorial_completed_at FROM game_states WHERE user_id=${userId}
    `)[0];
    function checkReward(before, after, index) {
      for (const resource of ['ore', 'energy', 'parts', 'credits', 'crystals']) {
        assert.equal(Number(after[resource]) - Number(before[resource]), rewards[index][resource] ?? 0, `${keys[index]} reward: ${resource}`);
      }
      assert.equal(Number(after.tutorial_step), index + 1);
    }
    async function blockedClaim(index) {
      const before = await state();
      assert.equal(Number(before.tutorial_step), index);
      const result = await claim();
      assert.equal(result.status, 400, JSON.stringify(result.data));
      assert.deepEqual(await state(), before, 'An unmet or completed step must not change balances or tutorial progress');
      assert.equal(Number((await sql`SELECT count(*) AS count FROM tutorial_claims WHERE user_id=${userId}`)[0].count), index);
    }
    async function claimStep(index) {
      const before = await state();
      const result = await claim();
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.equal(result.data.result.stepIndex, index);
      assert.equal(result.data.result.step.key, keys[index]);
      checkReward(before, await state(), index);
      return result;
    }

    const first = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.tutorial.current.action, 'claim');
    assert.ok(first.data.tutorial.current.why && first.data.tutorial.current.hint);
    const beforeWelcome = await state();
    const welcome = await Promise.all([claim(), claim()]);
    assert.deepEqual(welcome.map((result) => result.status).sort(), [200, 400], JSON.stringify(welcome));
    checkReward(beforeWelcome, await state(), 0);
    await blockedClaim(1);

    const foundry = await request('/api/game/build', { method: 'POST', auth: initData(playerId), body: { type: 'foundry', x: 1, y: 1 } });
    assert.equal(foundry.status, 200, JSON.stringify(foundry.data));
    assert.equal(foundry.data.tutorial.current.key, 'build_foundry');
    assert.equal(foundry.data.tutorial.current.conditionMet, false);
    await blockedClaim(1);
    await sql`UPDATE buildings SET completes_at=now()-interval '1 second' WHERE id=${foundry.data.result.buildingId}`;
    const foundryReward = await claimStep(1);
    assert.equal(foundryReward.data.tutorial.current.action, 'production');
    assert.equal(foundryReward.data.tutorial.current.actionTab, 'city');
    assert.equal(foundryReward.data.tutorial.current.conditionMet, false);
    await blockedClaim(2);
    const smelt = await startFoundry({ buildingId: foundry.data.result.buildingId });
    assert.equal(smelt.status, 200, JSON.stringify(smelt.data));
    assert.equal(Number(smelt.data.stats.foundry_jobs_started), 1);
    assert.equal(smelt.data.tutorial.current.conditionMet, true);
    await claimStep(2);
    await blockedClaim(3);

    const trade = await request('/api/game/build', { method: 'POST', auth: initData(playerId), body: { type: 'trade_hub', x: 3, y: 1 } });
    assert.equal(trade.status, 200, JSON.stringify(trade.data));
    assert.equal(trade.data.tutorial.current.conditionMet, false);
    await blockedClaim(3);
    await sql`UPDATE buildings SET completes_at=now()-interval '1 second' WHERE id=${trade.data.result.buildingId}`;
    await claimStep(3);
    await blockedClaim(4);
    const contract = (await sql`
      INSERT INTO npc_contracts (user_id,resource,amount,credit_reward,expires_at)
      VALUES (${userId},'parts',1,10,now()+interval '1 hour') RETURNING id
    `)[0];
    const completedContract = await request('/api/game/contracts/complete', { method: 'POST', auth: initData(playerId), body: { contractId: contract.id } });
    assert.equal(completedContract.status, 200, JSON.stringify(completedContract.data));
    assert.equal(Number(completedContract.data.stats.contracts_completed), 1);
    assert.equal(completedContract.data.tutorial.current.conditionMet, true);
    await claimStep(4);
    await blockedClaim(5);

    const upgrade = await request('/api/game/building/upgrade', { method: 'POST', auth: initData(playerId), body: { buildingId: hq.id } });
    assert.equal(upgrade.status, 200, JSON.stringify(upgrade.data));
    assert.equal(upgrade.data.tutorial.current.conditionMet, false);
    await blockedClaim(5);
    await sql`UPDATE buildings SET completes_at=now()-interval '1 second' WHERE id=${hq.id}`;
    const final = await claimStep(5);
    assert.equal(final.data.tutorial.completed, true);
    assert.equal(final.data.tutorial.current, null);
    assert.ok(final.data.tutorial.completedAt);
    assert.deepEqual((await sql`SELECT step_key FROM tutorial_claims WHERE user_id=${userId} ORDER BY step_index`).map((row) => row.step_key), keys);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id='title_cadet'`)[0].count), 1);
    await blockedClaim(6);
    await blockedClaim(6);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id='title_cadet'`)[0].count), 1);
  });

  await t.test('cosmetic appearance enforces ownership, supports removal and serializes category switches', async () => {
    const userId = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0].id;
    const otherUserId = (await sql`SELECT id FROM users WHERE telegram_id=${adminId}`)[0].id;
    await sql`DELETE FROM user_cosmetics WHERE user_id=${userId}`;
    await sql`DELETE FROM api_rate_limits WHERE bucket_key=${`global:${userId}`}`;
    await sql`
      INSERT INTO user_cosmetics (user_id,cosmetic_id,source,expires_at,equipped,acquired_at)
      VALUES
        (${userId},'frame_orbit','integration',NULL,false,'2024-01-01T00:00:00.123001Z'),
        (${userId},'frame_orbit','integration',NULL,false,'2024-01-01T00:00:00.123999Z'),
        (${userId},'founder_frame','integration',now()+interval '1 day',false,'2024-01-01T00:00:00.124001Z'),
        (${userId},'theme_neon','integration',NULL,true,'2024-01-01T00:00:00.125001Z'),
        (${userId},'weather_aurora','integration',now()-interval '1 day',true,'2024-01-01T00:00:00.126001Z'),
        (${otherUserId},'founder_badge','integration',NULL,true,'2024-01-01T00:00:00.127001Z')
    `;
    const equip = (body) => request('/api/shop/equip', { method: 'POST', auth: initData(playerId), body });
    const owned = (ownerId = userId) => sql`
      SELECT cosmetic_id,acquired_at::text AS acquired_at,expires_at::text AS expires_at,equipped
      FROM user_cosmetics WHERE user_id=${ownerId} ORDER BY cosmetic_id,acquired_at
    `;
    const appearanceEvents = async () => Number((await sql`
      SELECT count(*) AS count FROM analytics_events WHERE user_id=${userId}
        AND event_name IN ('cosmetic_equipped','cosmetic_unequipped')
    `)[0].count);
    const activeFrames = (game) => game.cosmetics.filter((item) => item.category === 'frame' && item.equipped);
    const moneyBefore = (await sql`SELECT ore,energy,parts,credits,crystals FROM game_states WHERE user_id=${userId}`)[0];
    const initialOwned = await owned();
    const otherOwned = await owned(otherUserId);
    for (const body of [
      { cosmeticId: 'founder_badge' }, { cosmeticId: 'missing_cosmetic' },
      { cosmeticId: 'weather_aurora' }, { cosmeticId: 'weather_aurora', equipped: false },
      { cosmeticId: 'frame_orbit', equipped: 'false' }, { cosmeticId: 'frame_orbit', equipped: null }, [],
    ]) {
      const rejected = await equip(body);
      assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
      assert.deepEqual(await owned(), initialOwned, 'Rejected ownership or malformed requests cannot alter appearance');
      assert.deepEqual(await owned(otherUserId), otherOwned, 'Another player\'s items must remain unchanged');
    }

    // Omitting equipped remains compatible with existing callers. Deliberate
    // microseconds in the composite key also catch accidental JS Date rounding.
    const first = await equip({ cosmeticId: 'frame_orbit' });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.deepEqual(activeFrames(first.data).map((item) => item.cosmetic_id), ['frame_orbit']);
    const frameCopies = (await owned()).filter((item) => item.cosmetic_id === 'frame_orbit');
    assert.deepEqual(frameCopies.map((item) => item.equipped), [false, true], 'Only the latest active copy may be equipped');
    assert.ok(first.data.cosmetics.some((item) => item.cosmetic_id === 'theme_neon' && item.equipped));
    assert.ok(!first.data.cosmetics.some((item) => item.cosmetic_id === 'weather_aurora'), 'Expired ownership is absent from the private session');
    const beforeRepeat = await owned();
    const eventsBeforeRepeat = await appearanceEvents();
    assert.equal((await equip({ cosmeticId: 'frame_orbit' })).status, 200);
    assert.deepEqual(await owned(), beforeRepeat);
    assert.equal(await appearanceEvents(), eventsBeforeRepeat, 'Repeating an equip is idempotent');

    const switched = await equip({ cosmeticId: 'founder_frame', equipped: true });
    assert.equal(switched.status, 200, JSON.stringify(switched.data));
    assert.deepEqual(activeFrames(switched.data).map((item) => item.cosmetic_id), ['founder_frame']);
    const removeOld = await equip({ cosmeticId: 'frame_orbit', equipped: false });
    assert.equal(removeOld.status, 200, JSON.stringify(removeOld.data));
    assert.deepEqual(activeFrames(removeOld.data).map((item) => item.cosmetic_id), ['founder_frame'], 'Removing one item must not remove the category replacement');
    const removed = await equip({ cosmeticId: 'founder_frame', equipped: false });
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    assert.deepEqual(activeFrames(removed.data), []);
    const afterRemoval = await owned();
    const eventsAfterRemoval = await appearanceEvents();
    assert.equal((await equip({ cosmeticId: 'founder_frame', equipped: false })).status, 200);
    assert.deepEqual(await owned(), afterRemoval);
    assert.equal(await appearanceEvents(), eventsAfterRemoval, 'Repeating a removal is idempotent');

    const concurrent = await Promise.all([
      equip({ cosmeticId: 'frame_orbit', equipped: true }),
      equip({ cosmeticId: 'founder_frame', equipped: true }),
    ]);
    assert.ok(concurrent.every((result) => result.status === 200), JSON.stringify(concurrent));
    const session = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(session.status, 200, JSON.stringify(session.data));
    assert.equal(activeFrames(session.data).length, 1, 'Concurrent requests must leave exactly one frame equipped');
    assert.equal((await owned()).filter((item) => ['frame_orbit', 'founder_frame'].includes(item.cosmetic_id) && item.equipped).length, 1);
    assert.ok(session.data.cosmetics.some((item) => item.cosmetic_id === 'theme_neon' && item.equipped), 'Other categories stay equipped');
    const publicCity = await request('/api/social/city', { method: 'POST', auth: initData(adminId), body: { telegramId: playerId } });
    assert.equal(publicCity.status, 200, JSON.stringify(publicCity.data));
    assert.deepEqual(publicCity.data.city.cosmetics.map((item) => item.cosmetic_id).sort(), [activeFrames(session.data)[0].cosmetic_id, 'theme_neon'].sort());
    assert.deepEqual((await sql`SELECT ore,energy,parts,credits,crystals FROM game_states WHERE user_id=${userId}`)[0], moneyBefore, 'Changing appearance does not charge game resources');
  });

  await t.test('invoices reject permanently owned cosmetics and a complete Founder Pack before creating a purchase', async () => {
    const userId = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0].id;
    await sql`DELETE FROM user_cosmetics WHERE user_id=${userId}`;
    await sql`DELETE FROM api_rate_limits WHERE bucket_key=${`global:${userId}`}`;
    for (const cosmeticId of ['theme_neon', 'weather_aurora', 'frame_orbit', 'founder_badge', 'founder_monument', 'founder_frame', 'founder_sky']) {
      await sql`INSERT INTO user_cosmetics (user_id,cosmetic_id,source) VALUES (${userId},${cosmeticId},'integration')`;
    }
    // Existing created invoices are deliberately not used as an ownership test:
    // they may be cancelled, and the player must be able to retry those purchases.
    await sql`
      INSERT INTO purchases (user_id,product_id,stars_paid,invoice_payload)
      VALUES (${userId},'theme_neon',149,${`integration:cancelled:${crypto.randomUUID()}`})
    `;
    const before = await sql`SELECT id,product_id,status,invoice_payload FROM purchases WHERE user_id=${userId} ORDER BY id`;
    for (const productId of ['theme_neon', 'weather_aurora', 'frame_orbit', 'founder_pack']) {
      const rejected = await request('/api/payments/invoice', { method: 'POST', auth: initData(playerId), body: { productId } });
      assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
      assert.match(rejected.data.error, /уже есть у тебя навсегда/);
      assert.deepEqual(await sql`SELECT id,product_id,status,invoice_payload FROM purchases WHERE user_id=${userId} ORDER BY id`, before,
        'Owned products must be rejected before inserting a purchase or reaching the subsequent Telegram request');
    }
    for (const productId of ['constructor', 'toString', 'missing_product']) {
      const rejected = await request('/api/payments/invoice', { method: 'POST', auth: initData(playerId), body: { productId } });
      assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
      assert.equal(rejected.data.error, 'Товар не найден');
      assert.deepEqual(await sql`SELECT id,product_id,status,invoice_payload FROM purchases WHERE user_id=${userId} ORDER BY id`, before);
    }
  });

  async function colonyEventFixture({ hqLevel = 2, tutorialStep = 6, buildingTypes = ['mine'], resources = {} } = {}) {
    const userId = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0].id;
    await sql`DELETE FROM colony_events WHERE user_id=${userId}`;
    await sql`DELETE FROM market_orders WHERE user_id=${userId}`;
    await sql`DELETE FROM user_research WHERE user_id=${userId}`;
    await sql`DELETE FROM buildings WHERE user_id=${userId}`;
    await sql`DELETE FROM city_decor WHERE user_id=${userId}`;
    await sql`DELETE FROM api_rate_limits WHERE bucket_key=${`global:${userId}`}`;
    await sql`
      INSERT INTO buildings (user_id,type,level,x,y,status) VALUES (${userId},'hq',${hqLevel},2,2,'active')
    `;
    for (let index = 0; index < buildingTypes.length; index++) {
      await sql`INSERT INTO buildings (user_id,type,level,x,y,status) VALUES (${userId},${buildingTypes[index]},1,${index},0,'active')`;
    }
    await sql`
      UPDATE game_states SET hq_level=${hqLevel},tutorial_step=${tutorialStep},
        ore=${resources.ore ?? 500},energy=${resources.energy ?? 500},parts=${resources.parts ?? 200},
        credits=${resources.credits ?? 1000},science=${resources.science ?? 10},premium_until=NULL,
        passive_carry='{}'::jsonb,last_tick_at=now()+interval '1 day' WHERE user_id=${userId}
    `;
    return userId;
  }
  async function colonyEventSession() {
    const session = await request('/api/session', { method: 'POST', auth: initData(playerId) });
    assert.equal(session.status, 200, JSON.stringify(session.data));
    return session.data;
  }
  const resolveColonyEvent = (eventId, choiceId, extra = {}) => request('/api/game/event/resolve', {
    method: 'POST', auth: initData(playerId), body: { eventId, choiceId, ...extra },
  });
  async function colonyEventBalances(userId) {
    const row = (await sql`SELECT ore,energy,parts,credits,science FROM game_states WHERE user_id=${userId}`)[0];
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  }

  await t.test('colony event migration can run twice without changing saved events', async () => {
    const migration = await readFile(new URL('../db/migrations/013_v1_8_colony_events.sql', import.meta.url), 'utf8');
    const before = await sql`SELECT * FROM colony_events ORDER BY id`;
    await sql.unsafe(migration);
    await sql.unsafe(migration);
    assert.deepEqual(await sql`SELECT * FROM colony_events ORDER BY id`, before);
    const index = (await sql`
      SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname='colony_events_one_pending_idx'
    `)[0];
    assert.match(index.indexdef, /UNIQUE/);
    assert.match(index.indexdef, /pending/);
  });

  await t.test('colony events stay locked until both centre level two and the six tutorial steps', async () => {
    for (const options of [{ hqLevel: 2, tutorialStep: 5 }, { hqLevel: 1, tutorialStep: 6 }]) {
      const userId = await colonyEventFixture(options);
      const session = await colonyEventSession();
      assert.equal(session.colonyEvents.enabled, true);
      assert.equal(session.colonyEvents.unlocked, false);
      assert.equal(session.colonyEvents.active, null);
      assert.equal(Number((await sql`SELECT count(*) AS count FROM colony_events WHERE user_id=${userId}`)[0].count), 0);
    }
  });

  await t.test('one saved colony event survives reloads and long absence, with decisions using its snapshot', async () => {
    const userId = await colonyEventFixture();
    const first = (await colonyEventSession()).colonyEvents.active;
    assert.equal(first.key, 'rich_vein');
    assert.ok(first.id && first.createdAt);
    assert.deepEqual((await colonyEventSession()).colonyEvents.active, first);
    await sql`UPDATE colony_events SET created_at=now()-interval '30 days' WHERE id=${first.id}`;
    const afterAbsence = (await colonyEventSession()).colonyEvents.active;
    assert.equal(afterAbsence.id, first.id);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM colony_events WHERE user_id=${userId}`)[0].count), 1);
    const { id, createdAt, ...definition } = first;
    definition.title = 'Сохранённое предложение';
    definition.choices = definition.choices.map((choice) => choice.id === 'extract'
      ? { ...choice, cost: { energy: 17 }, reward: { credits: 123 }, resultText: 'Применены сохранённые условия.' } : choice);
    await sql`UPDATE colony_events SET event_json=${sql.json(definition)} WHERE id=${id}`;
    const before = await colonyEventBalances(userId);
    const resolved = await resolveColonyEvent(id, 'extract', { cost: {}, reward: { science: 99999 } });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
    assert.equal(resolved.data.result.title, definition.title);
    assert.deepEqual(resolved.data.result.cost, { energy: 17 });
    assert.deepEqual(resolved.data.result.reward, { credits: 123 });
    assert.deepEqual(await colonyEventBalances(userId), { ...before, energy: before.energy - 17, credits: before.credits + 123 });
  });

  await t.test('foreign, unknown and malformed colony event decisions leave the pending event intact', async () => {
    const userId = await colonyEventFixture();
    const event = (await colonyEventSession()).colonyEvents.active;
    const before = await colonyEventBalances(userId);
    const foreign = await request('/api/game/event/resolve', { method: 'POST', auth: initData(adminId), body: { eventId: event.id, choiceId: 'delegate' } });
    assert.equal(foreign.status, 400, JSON.stringify(foreign.data));
    for (const [eventId, choiceId] of [[event.id, 'unknown'], [crypto.randomUUID(), 'delegate'], ['invalid', 'delegate'], [event.id, ''], [event.id, null], [null, 'delegate']]) {
      const rejected = await resolveColonyEvent(eventId, choiceId);
      assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
    }
    assert.deepEqual(await colonyEventBalances(userId), before);
    assert.equal((await sql`SELECT status FROM colony_events WHERE id=${event.id}`)[0].status, 'pending');
  });

  await t.test('event shortages and escrow-aware overflow reject atomically, while storage research increases capacity', async () => {
    const userId = await colonyEventFixture({ resources: { energy: 99 } });
    const event = (await colonyEventSession()).colonyEvents.active;
    let before = await colonyEventBalances(userId);
    const shortage = await resolveColonyEvent(event.id, 'extract');
    assert.equal(shortage.status, 400, JSON.stringify(shortage.data));
    assert.match(shortage.data.error, /Не хватает/);
    assert.deepEqual(await colonyEventBalances(userId), before);
    await sql`UPDATE game_states SET energy=500,ore=1900 WHERE user_id=${userId}`;
    before = await colonyEventBalances(userId);
    const full = await resolveColonyEvent(event.id, 'extract');
    assert.equal(full.status, 400, JSON.stringify(full.data));
    assert.match(full.data.error, /складе/);
    assert.deepEqual(await colonyEventBalances(userId), before);
    await sql`UPDATE game_states SET ore=1700 WHERE user_id=${userId}`;
    await sql`
      INSERT INTO market_orders (user_id,resource,amount_total,amount_remaining,unit_price,expires_at)
      VALUES (${userId},'ore',100,100,2,now()+interval '1 day')
    `;
    before = await colonyEventBalances(userId);
    const reserved = await resolveColonyEvent(event.id, 'extract');
    assert.equal(reserved.status, 400, JSON.stringify(reserved.data));
    assert.deepEqual(await colonyEventBalances(userId), before);
    assert.equal((await sql`SELECT status FROM colony_events WHERE id=${event.id}`)[0].status, 'pending');
    await sql`
      INSERT INTO user_research (user_id,research_key,status,started_at,completes_at,completed_at)
      VALUES (${userId},'compact_storage','completed',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 hour')
    `;
    const accepted = await resolveColonyEvent(event.id, 'extract');
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.deepEqual(await colonyEventBalances(userId), { ...before, ore: 2000, energy: before.energy - 100 });
  });

  await t.test('a safe event choice preserves over-capacity stock and needs no payment', async () => {
    const userId = await colonyEventFixture({ resources: { ore: 2500, energy: 2000, parts: 1000 } });
    const event = (await colonyEventSession()).colonyEvents.active;
    const before = await colonyEventBalances(userId);
    const safe = await resolveColonyEvent(event.id, 'delegate');
    assert.equal(safe.status, 200, JSON.stringify(safe.data));
    assert.deepEqual(await colonyEventBalances(userId), { ...before, credits: before.credits + 90 });
  });

  await t.test('a research-gated event choice remains pending until its required technology completes', async () => {
    const userId = await colonyEventFixture({ buildingTypes: ['foundry'] });
    const event = (await colonyEventSession()).colonyEvents.active;
    assert.equal(event.key, 'cooling_loop');
    const before = await colonyEventBalances(userId);
    const rejected = await resolveColonyEvent(event.id, 'recycle');
    assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
    assert.match(rejected.data.error, /исследование/);
    assert.deepEqual(await colonyEventBalances(userId), before);
    await sql`
      INSERT INTO user_research (user_id,research_key,status,started_at,completes_at,completed_at)
      VALUES (${userId},'thermal_recovery','completed',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 hour')
    `;
    const accepted = await resolveColonyEvent(event.id, 'recycle');
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.deepEqual(await colonyEventBalances(userId), { ...before, ore: before.ore - 60, energy: before.energy - 100, parts: before.parts + 40 });
  });

  await t.test('parallel event decisions and retries grant one result and reject changing a saved decision', async () => {
    const userId = await colonyEventFixture({ buildingTypes: ['research_lab'] });
    const event = (await colonyEventSession()).colonyEvents.active;
    const before = await colonyEventBalances(userId);
    const results = await Promise.all([resolveColonyEvent(event.id, 'simulate'), resolveColonyEvent(event.id, 'simulate')]);
    assert.ok(results.every((result) => result.status === 200), JSON.stringify(results));
    assert.deepEqual(results[0].data.result, results[1].data.result);
    assert.deepEqual(await colonyEventBalances(userId), { ...before, credits: before.credits - 160, science: before.science + 30 });
    const retried = await resolveColonyEvent(event.id, 'simulate');
    assert.equal(retried.status, 200, JSON.stringify(retried.data));
    assert.deepEqual(retried.data.result, results[0].data.result);
    const after = await colonyEventBalances(userId);
    const changed = await resolveColonyEvent(event.id, 'calibrate');
    assert.equal(changed.status, 400, JSON.stringify(changed.data));
    assert.deepEqual(await colonyEventBalances(userId), after);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM colony_events WHERE user_id=${userId} AND status='resolved'`)[0].count), 1);
  });

  await t.test('event cooldown is twelve hours after resolution and a long absence creates only one different event', async () => {
    const userId = await colonyEventFixture({ buildingTypes: ['mine', 'solar'] });
    const event = (await colonyEventSession()).colonyEvents.active;
    const resolved = await resolveColonyEvent(event.id, 'delegate');
    assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
    const events = resolved.data.colonyEvents;
    assert.equal(events.active, null);
    assert.equal(events.lastResolved.id, event.id);
    assert.equal(new Date(events.nextAt).getTime() - new Date(events.lastResolved.resolvedAt).getTime(), 43_200_000);
    assert.equal((await colonyEventSession()).colonyEvents.active, null);
    await sql`UPDATE colony_events SET resolved_at=now()-interval '30 days' WHERE id=${event.id}`;
    const next = (await colonyEventSession()).colonyEvents.active;
    assert.ok(next && next.id !== event.id);
    assert.notEqual(next.key, event.key, 'Choose another eligible situation when possible');
    assert.equal((await colonyEventSession()).colonyEvents.active.id, next.id);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM colony_events WHERE user_id=${userId}`)[0].count), 2);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM colony_events WHERE user_id=${userId} AND status='pending'`)[0].count), 1);
  });

  await t.test('missing event schema gracefully disables only events and restores the saved pending situation', async () => {
    const userId = await colonyEventFixture();
    const event = (await colonyEventSession()).colonyEvents.active;
    const before = await colonyEventBalances(userId);
    let renamed = false;
    try {
      await sql`ALTER TABLE public.colony_events RENAME TO colony_events_pending`;
      renamed = true;
      const session = await colonyEventSession();
      assert.equal(session.colonyEvents.enabled, false);
      assert.equal(session.colonyEvents.active, null);
      const rejected = await resolveColonyEvent(event.id, 'delegate');
      assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
      assert.match(rejected.data.error, /временно недоступны/);
      assert.deepEqual(await colonyEventBalances(userId), before);
      assert.equal((await request('/api/ready')).status, 503);
    } finally {
      if (renamed) await sql`ALTER TABLE public.colony_events_pending RENAME TO colony_events`;
    }
    const restored = await colonyEventSession();
    assert.equal(restored.colonyEvents.enabled, true);
    assert.equal(restored.colonyEvents.active.id, event.id);
    assert.equal((await request('/api/ready')).status, 200);
  });

  async function expeditionFixture() {
    const userId = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0].id;
    await sql`DELETE FROM expeditions WHERE user_id=${userId}`;
    await sql`DELETE FROM user_artifacts WHERE user_id=${userId}`;
    await sql`DELETE FROM market_orders WHERE user_id=${userId}`;
    await sql`DELETE FROM user_research WHERE user_id=${userId}`;
    await sql`DELETE FROM buildings WHERE user_id=${userId}`;
    await sql`DELETE FROM api_rate_limits WHERE bucket_key=${`global:${userId}`}`;
    await sql`UPDATE player_stats SET expeditions_started=0,expeditions_completed=0,artifacts_found=0,unique_artifacts_found=0 WHERE user_id=${userId}`;
    await sql`
      INSERT INTO buildings (user_id,type,level,x,y,status)
      VALUES (${userId},'hq',3,2,2,'active'),(${userId},'expedition_center',1,0,0,'active')
    `;
    await sql`
      UPDATE game_states SET hq_level=3,ore=500,energy=500,parts=100,credits=1000,science=0,crystals=0,
        premium_until=NULL,passive_carry='{}'::jsonb,last_tick_at=now()+interval '1 day' WHERE user_id=${userId}
    `;
    return userId;
  }
  const expeditionReward = { ore: 120, parts: 30, credits: 400, science: 25, crystals: 2 };
  async function seededExpedition(userId, { status = 'ready', eventKey = null, artifactId = 'alloy_core', reward = expeditionReward } = {}) {
    return (await sql`
      INSERT INTO expeditions (user_id,expedition_key,status,started_at,completes_at,completed_at,reward_json,event_key,artifact_id,reward_claimed)
      VALUES (${userId},'local_survey',${status},now()-interval '2 hours',
        ${status === 'active' ? new Date(Date.now()+3_600_000) : new Date(Date.now()-3_600_000)},
        ${status === 'claimed' ? new Date(Date.now()-60_000) : null},${sql.json(reward)},${eventKey},${artifactId},${status === 'claimed'})
      RETURNING id
    `)[0].id;
  }
  const resolveExpedition = (expeditionId, choiceId) => request('/api/game/expedition/resolve', {
    method: 'POST', auth: initData(playerId), body: { expeditionId, ...(choiceId === undefined ? {} : { choiceId }) },
  });
  const expeditionBalances = async (userId) => Object.fromEntries(Object.entries((await sql`
    SELECT ore,energy,parts,credits,science,crystals FROM game_states WHERE user_id=${userId}
  `)[0]).map(([key,value]) => [key,Number(value)]));

  await t.test('expeditions hide cargo while travelling and reveal exact saved cargo when ready', async () => {
    const userId = await expeditionFixture();
    const id = await seededExpedition(userId, { status: 'active' });
    const travelling = (await colonyEventSession()).expeditions.runs.find((run) => run.id === id);
    assert.equal(travelling.baseReward, null);
    assert.equal(travelling.baseArtifactId, null);
    assert.equal(travelling.event, null);
    assert.ok(!Object.hasOwn(travelling, 'reward_json') && !Object.hasOwn(travelling, 'artifact_id'));
    const before = await expeditionBalances(userId);
    assert.equal((await resolveExpedition(id)).status, 400, 'Cargo cannot be claimed while the expedition is travelling');
    const busy = await request('/api/game/expedition/start', { method: 'POST', auth: initData(playerId), body: { expeditionKey: 'local_survey' } });
    assert.equal(busy.status, 400, JSON.stringify(busy.data));
    assert.deepEqual(await expeditionBalances(userId), before);
    await sql`UPDATE expeditions SET completes_at=now()-interval '1 second' WHERE id=${id}`;
    const ready = (await colonyEventSession()).expeditions.runs.find((run) => run.id === id);
    assert.equal(ready.status, 'ready');
    assert.deepEqual(ready.baseReward, expeditionReward);
    assert.equal(ready.baseArtifactId, 'alloy_core');
    const claimed = await resolveExpedition(id);
    assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
    assert.deepEqual(claimed.data.result, { ...expeditionReward, artifactId: 'alloy_core', extraArtifactId: null, cost: {}, choiceId: null });
    const retry = await resolveExpedition(id);
    assert.equal(retry.status, 200, JSON.stringify(retry.data));
    assert.deepEqual(retry.data.result, claimed.data.result);
    assert.deepEqual(claimed.data.expeditions.recent.find((run) => run.id === id).result, claimed.data.result);
    assert.equal(claimed.data.expeditions.recent.find((run) => run.id === id).config.key, 'local_survey');
    assert.deepEqual(await expeditionBalances(userId), { ore: 620, energy: 500, parts: 130, credits: 1400, science: 25, crystals: 2 });
  });

  await t.test('event cargo and both artifacts wait intact on shortage or full escrow-reserved storage, then settle once', async () => {
    const userId = await expeditionFixture();
    const id = await seededExpedition(userId, { status: 'event', eventKey: 'ancient_probe', artifactId: 'quantum_lens' });
    const preview = (await colonyEventSession()).expeditions.runs.find((run) => run.id === id);
    assert.deepEqual(preview.baseReward, expeditionReward);
    assert.equal(preview.baseArtifactId, 'quantum_lens');
    assert.equal(preview.event.title, 'Неизвестный зонд');
    await sql`UPDATE game_states SET parts=29 WHERE user_id=${userId}`;
    let before = await expeditionBalances(userId);
    assert.equal((await resolveExpedition(id, 'recover')).status, 400);
    assert.deepEqual(await expeditionBalances(userId), before, 'Incoming parts cannot pay the upfront decision cost');
    await sql`UPDATE game_states SET parts=800,ore=1990 WHERE user_id=${userId}`;
    before = await expeditionBalances(userId);
    const full = await resolveExpedition(id, 'recover');
    assert.equal(full.status, 400, JSON.stringify(full.data));
    assert.match(full.data.error, /складе/);
    assert.deepEqual(await expeditionBalances(userId), before);
    assert.deepEqual((await sql`SELECT status,event_choice,reward_claimed FROM expeditions WHERE id=${id}`)[0], { status: 'event', event_choice: null, reward_claimed: false });
    assert.equal(Number((await sql`SELECT count(*) AS count FROM user_artifacts WHERE user_id=${userId}`)[0].count), 0);
    assert.equal(Number((await sql`SELECT expeditions_completed FROM player_stats WHERE user_id=${userId}`)[0].expeditions_completed), 0);
    await sql`UPDATE game_states SET ore=1880 WHERE user_id=${userId}`;
    await sql`
      INSERT INTO market_orders (user_id,resource,amount_total,amount_remaining,unit_price,expires_at)
      VALUES (${userId},'ore',100,100,2,now()+interval '1 day')
    `;
    before = await expeditionBalances(userId);
    const reserved = await resolveExpedition(id, 'recover');
    assert.equal(reserved.status, 400, JSON.stringify(reserved.data));
    assert.deepEqual(await expeditionBalances(userId), before);
    await sql`UPDATE game_states SET ore=1780 WHERE user_id=${userId}`;
    const results = await Promise.all([resolveExpedition(id, 'recover'), resolveExpedition(id, 'recover')]);
    assert.ok(results.every((result) => result.status === 200), JSON.stringify(results));
    assert.deepEqual(results[0].data.result, results[1].data.result);
    assert.deepEqual(results[0].data.result, { ore: 120, parts: 30, credits: 900, science: 25, crystals: 2,
      artifactId: 'quantum_lens', extraArtifactId: 'signal_fragment', cost: { parts: 30 }, choiceId: 'recover' });
    assert.deepEqual(await expeditionBalances(userId), { ore: 1900, energy: 500, parts: 800, credits: 1900, science: 25, crystals: 2 });
    const stats = (await sql`SELECT expeditions_completed,artifacts_found,unique_artifacts_found FROM player_stats WHERE user_id=${userId}`)[0];
    assert.equal(Number(stats.expeditions_completed), 1);
    assert.equal(Number(stats.artifacts_found), 2);
    assert.equal(Number(stats.unique_artifacts_found), 2);
    assert.deepEqual((await sql`SELECT artifact_id,count::int FROM user_artifacts WHERE user_id=${userId} ORDER BY artifact_id`).map((row) => ({ ...row })),
      [{ artifact_id: 'quantum_lens', count: 1 }, { artifact_id: 'signal_fragment', count: 1 }]);
    const after = await expeditionBalances(userId);
    const retried = await resolveExpedition(id, 'recover');
    assert.equal(retried.status, 200, JSON.stringify(retried.data));
    assert.deepEqual(retried.data.result, results[0].data.result);
    assert.equal((await resolveExpedition(id, 'decode')).status, 400);
    assert.deepEqual(await expeditionBalances(userId), after);
  });

  await t.test('expedition ownership and request validation reject malformed actions, preserving legacy claims', async () => {
    const userId = await expeditionFixture();
    const id = await seededExpedition(userId);
    const before = await expeditionBalances(userId);
    const foreign = await request('/api/game/expedition/resolve', { method: 'POST', auth: initData(adminId), body: { expeditionId: id } });
    assert.equal(foreign.status, 400, JSON.stringify(foreign.data));
    for (const body of [null, [], { expeditionId: null }, { expeditionId: 'bad' }, { expeditionId: crypto.randomUUID() }, { expeditionId: id, choiceId: {} }, { expeditionId: id, choiceId: 'unknown' }]) {
      const rejected = await request('/api/game/expedition/resolve', { method: 'POST', auth: initData(playerId), body });
      assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
    }
    for (const body of [null, [], { expeditionKey: {} }, { expeditionKey: 'constructor' }, { expeditionKey: 'unknown' }]) {
      const rejected = await request('/api/game/expedition/start', { method: 'POST', auth: initData(playerId), body });
      assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
    }
    assert.deepEqual(await expeditionBalances(userId), before);
    const legacyId = await seededExpedition(userId, { status: 'claimed' });
    const legacy = await resolveExpedition(legacyId);
    assert.equal(legacy.status, 400, JSON.stringify(legacy.data));
    assert.match(legacy.data.error, /уже получена/);
    const session = await colonyEventSession();
    assert.equal(session.expeditions.recent.find((run) => run.id === legacyId).result, null);
    assert.deepEqual(await expeditionBalances(userId), before);
  });

  await t.test('temporary cosmetic rewards extend exact microsecond keys and permanent ownership is unchanged', async () => {
    const { grantCosmetic } = await import('../lib/server/cosmetics.ts');
    const userId = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0].id;
    await sql`DELETE FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id IN ('frame_orbit','theme_neon')`;
    await sql`
      INSERT INTO user_cosmetics (user_id,cosmetic_id,source,expires_at,acquired_at)
      VALUES (${userId},'frame_orbit','integration',now()+interval '3 days',TIMESTAMPTZ '2026-10-01 12:00:00.123456+00'),
             (${userId},'theme_neon','integration',NULL,TIMESTAMPTZ '2026-10-01 12:00:00.654321+00')
    `;
    const before = (await sql`SELECT acquired_at::text,expires_at FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id='frame_orbit'`)[0];
    await sql.begin((tx) => grantCosmetic(tx,userId,'frame_orbit','integration_again',7));
    const after = await sql`SELECT acquired_at::text,expires_at FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id='frame_orbit'`;
    assert.equal(after.length, 1);
    assert.equal(after[0].acquired_at, before.acquired_at);
    assert.equal(new Date(after[0].expires_at).getTime() - new Date(before.expires_at).getTime(), 7 * 86_400_000);
    const permanent = await sql`SELECT acquired_at::text,expires_at FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id='theme_neon'`;
    await sql.begin((tx) => grantCosmetic(tx,userId,'theme_neon','integration_again',7));
    assert.deepEqual(await sql`SELECT acquired_at::text,expires_at FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id='theme_neon'`, permanent);
  });

  await runContractsIntegration({ t, sql, request, initData, playerId, adminId });
  await runDecorIntegration({ t, sql, request, initData, playerId, adminId });
  await runReferralsIntegration({ t, sql, request, initData, playerId, adminId });
  await runUnlocksIntegration({ t, sql, request, initData, playerId, adminId });
  await runInboxIntegration({ t, sql, request, initData, playerId, adminId });
  await runQuestRewardsIntegration({ t, sql, request, initData, playerId, adminId });
  await runSeasonRewardsIntegration({ t, sql, request, initData, playerId, adminId });
  await runAllianceSocialIntegration({ t, sql, request, initData, playerId });

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
