import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const STATUS = '/api/account/closure/status';
const CLOSE = '/api/account/closure/request';
const CANCEL = '/api/account/closure/cancel';
const LIST = '/api/admin/account-closures/list';
const PLAN = '/api/admin/account-closures/plan';
const CONFIRM_CLOSE = 'ЗАКРЫТЬ АККАУНТ';
const CONFIRM_CANCEL = 'ОТОЗВАТЬ ЗАПРОС';
const plain = value => JSON.parse(JSON.stringify(value));

/** Real signed HTTP checks against an isolated database and disposable FS ledger. */
export async function runAccountClosureIntegration({ t, sql, request, initData, adminId, playerId, privacy }) {
  assert.equal(process.env.COLONY_TEST_DATABASE, '1');
  const database = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.match(database.pathname, /^\/colony_(ci|test)$/);
  assert.ok(privacy && typeof privacy.directory === 'string' && /^[a-f0-9]{64}$/.test(privacy.secret || ''), 'A test-only privacy store is required');
  const directory = path.resolve(privacy.directory);
  const relative = path.relative(path.resolve(os.tmpdir()), directory);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Use a unique temporary privacy directory, never the production ledger');
  assert.equal((await fs.lstat(directory)).isSymbolicLink(), false);
  await fs.access(path.join(directory, 'meta.json'));

  const originalSettings = await sql`SELECT setting_key,value FROM system_settings WHERE setting_key IN ('maintenance','beta_required')`;
  assert.equal(originalSettings.length, 2);
  const fixtures = [];
  const unknownId = crypto.randomInt(730_000_000_000, 739_999_999_999);
  const key = telegramId => crypto.createHmac('sha256', privacy.secret).update(`colony-account-v1:${telegramId}`).digest('hex');
  const filename = fixture => path.join(directory, `${key(fixture.telegramId)}.json`);
  const rateKey = fixture => `privacy-request:${key(fixture.telegramId)}`;
  const post = (url, body = {}, auth, headers) => request(url, { method: 'POST', body, auth, headers });
  const close = fixture => post(CLOSE, { confirmation: CONFIRM_CLOSE }, initData(fixture.telegramId));
  const status = fixture => post(STATUS, {}, initData(fixture.telegramId));
  const cancel = (fixture, requestId) => post(CANCEL, { requestId, confirmation: CONFIRM_CANCEL }, initData(fixture.telegramId));

  function check(reply, expected) {
    assert.equal(reply.status, expected);
    assert.match(reply.headers.get('cache-control') || '', /(?:^|[,\s])no-store(?:$|[,\s])/i);
    assert.equal(reply.data.ok, expected === 200);
    return reply.data;
  }
  async function readCase(fixture) {
    return JSON.parse(await fs.readFile(filename(fixture), 'utf8')).value;
  }
  async function noCase(fixture) {
    await assert.rejects(fs.access(filename(fixture)), error => error.code === 'ENOENT');
  }
  async function snapshot(fixture) {
    return plain({
      users: await sql`SELECT * FROM users WHERE telegram_id=${fixture.telegramId}`,
      state: await sql`SELECT * FROM game_states WHERE user_id=${fixture.userId}`,
      preferences: await sql`SELECT * FROM notification_preferences WHERE user_id=${fixture.userId}`,
      jobs: await sql`SELECT * FROM notification_jobs WHERE user_id=${fixture.userId} ORDER BY id`,
    });
  }
  async function countUsers() { return Number((await sql`SELECT count(*) AS count FROM users`)[0].count); }
  async function createFixture() {
    const telegramId = crypto.randomInt(740_000_000_000, 749_999_999_999);
    const suffix = crypto.randomBytes(5).toString('hex');
    assert.ok(telegramId !== adminId && telegramId !== playerId);
    const [row] = await sql`INSERT INTO users(telegram_id,first_name,username,colony_name,profile_bio,profile_completed_at,last_seen_at,bot_write_allowed)
      VALUES(${telegramId},'Closure integration fixture',${`closure_${suffix}`},${`Close_${suffix}`},'Synthetic closure test',now(),TIMESTAMPTZ '2025-01-01 00:00:00+00',true) RETURNING id`;
    const fixture = { telegramId, userId: row.id };
    fixtures.push(fixture);
    await sql`INSERT INTO game_states(user_id,credits,crystals,last_tick_at) VALUES(${row.id},4321,54,now()+interval '1 day')`;
    await sql`INSERT INTO notification_preferences(user_id,enabled) VALUES(${row.id},true)`;
    await sql`INSERT INTO notification_jobs(user_id,kind,dedupe_key,scheduled_at,payload)
      VALUES(${row.id},'building_ready',${`closure_${suffix}`},now()+interval '1 day',${sql.json({name:'Synthetic ready building'})})`;
    return fixture;
  }

  let actor, other, restored, missing, untouched;
  let actorRequest;
  let cancelledCaseBytes;
  try {
    for (const setting of originalSettings) await sql`UPDATE system_settings SET value=${sql.json({ ...setting.value, enabled: false })} WHERE setting_key=${setting.setting_key}`;
    actor = await createFixture();
    other = await createFixture();
    restored = await createFixture();
    missing = await createFixture();
    untouched = await createFixture();

    await t.test('closure routes require fresh real Telegram signatures and never accept the development header', async () => {
      const forged = new URLSearchParams(initData(actor.telegramId));
      forged.set('hash', '0'.repeat(64));
      const stale = Math.floor(Date.now() / 1000) - 301;
      const routes = [
        [STATUS, {}], [CLOSE, {confirmation:CONFIRM_CLOSE}],
        [CANCEL, {requestId:crypto.randomUUID(),confirmation:CONFIRM_CANCEL}], [LIST, {}], [PLAN, {requestId:crypto.randomUUID()}],
      ];
      const before = await snapshot(actor);
      for (const [url, body] of routes) {
        for (const auth of [undefined, forged.toString(), initData(actor.telegramId, {}, stale)]) check(await post(url, body, auth), 401);
        check(await post(url, body, undefined, {'x-dev-user-id':String(actor.telegramId)}), 401);
      }
      // This also proves the harness forwards extra headers; otherwise the dev
      // header check above could pass without ever transmitting that header.
      check(await post(STATUS, {}, initData(actor.telegramId), {origin:'https://untrusted-closure-test.invalid'}),403);
      assert.deepEqual(await snapshot(actor), before);
      await noCase(actor);
    });

    await t.test('status lookup and attempted closure of an unknown identity do not create a game account or case', async () => {
      assert.equal((await sql`SELECT id FROM users WHERE telegram_id=${unknownId}`).length, 0);
      const before = await countUsers();
      assert.equal(check(await post(STATUS, {}, initData(unknownId)), 200).request, null);
      check(await post(CLOSE, {confirmation:CONFIRM_CLOSE}, initData(unknownId)), 404);
      assert.equal(await countUsers(), before);
      assert.equal((await sql`SELECT id FROM users WHERE telegram_id=${unknownId}`).length, 0);
      await noCase({telegramId:unknownId});
    });

    await t.test('closure requires the exact instruction and rejects client-selected targets or a support ownership code', async () => {
      const before = await snapshot(actor);
      for (const body of [
        {}, {confirmation:'закрыть аккаунт'}, {confirmation:` ${CONFIRM_CLOSE}`},
        {confirmation:'CG-00000000-00000000-00000000-00000000'},
        {confirmation:CONFIRM_CLOSE,userId:other.userId}, {confirmation:CONFIRM_CLOSE,telegramId:other.telegramId},
      ]) check(await post(CLOSE, body, initData(actor.telegramId)), 400);
      assert.deepEqual(await snapshot(actor), before);
      await noCase(actor); await noCase(other);
    });

    await t.test('an administrative account cannot be closed through the ordinary self-service route', async () => {
      const before = plain(await sql`SELECT * FROM users WHERE telegram_id=${adminId}`);
      check(await post(CLOSE, {confirmation:CONFIRM_CLOSE}, initData(adminId)), 409);
      assert.deepEqual(plain(await sql`SELECT * FROM users WHERE telegram_id=${adminId}`), before);
      await noCase({telegramId:adminId});
    });

    await t.test('an explicit closure stores a durable request outside PostgreSQL and cancels pending delivery without deleting progress', async () => {
      const before = await snapshot(actor);
      const userCount = await countUsers();
      actorRequest = check(await close(actor), 200).request;
      assert.match(actorRequest.id, /^[a-f0-9-]{36}$/i);
      assert.equal(actorRequest.status, 'requested');
      assert.ok(Number.isFinite(new Date(actorRequest.requestedAt).getTime()));
      assert.deepEqual(Object.keys(actorRequest).sort(), ['id','status','requestedAt','updatedAt'].sort());
      const after = await snapshot(actor);
      assert.equal(await countUsers(), userCount);
      assert.deepEqual(after.state, before.state);
      assert.deepEqual({...after.users[0],bot_write_allowed:true},before.users[0]);
      assert.equal(after.preferences[0].enabled, false);
      assert.ok(after.jobs[0].cancelled_at);
      assert.equal(after.jobs[0].processing_at, null);
      assert.equal(after.jobs[0].sent_at, null);
      const stored = await readCase(actor);
      assert.equal(stored.id, actorRequest.id);
      assert.equal(stored.userId, actor.userId);
      assert.equal(stored.status, 'requested');
      assert.ok(stored.events.some(event=>event.action==='self_closure_requested'));
      const serialized = await fs.readFile(filename(actor), 'utf8');
      assert.equal(serialized.includes(String(actor.telegramId)), false);
      assert.equal(serialized.includes(privacy.secret), false);
      assert.equal(serialized.includes(initData(actor.telegramId)), false);
      assert.equal(/auth_date|x-telegram-init-data|first_name|Closure integration fixture/.test(serialized),false);
      const journal = await fs.readFile(path.join(directory,'events.jsonl'), 'utf8');
      assert.ok(journal.split('\n').filter(Boolean).map(line=>JSON.parse(line).value).some(event=>event.requestId===actorRequest.id));
    });

    await t.test('repeating the same closure instruction returns the existing request instead of creating another case', async () => {
      const before = await readCase(actor);
      const first = check(await close(actor), 200).request;
      const second = check(await close(actor), 200).request;
      assert.deepEqual(first, actorRequest);
      assert.deepEqual(second, actorRequest);
      assert.deepEqual(await readCase(actor), before);
    });

    await t.test('closed sessions disclose no profile or progress and cannot update the account through normal gameplay routes', async () => {
      const before = await snapshot(actor);
      const session = check(await post('/api/session', {}, initData(actor.telegramId)), 200);
      assert.equal(session.closed, true);
      assert.equal(session.limited, true);
      assert.equal(session.userId, null);
      assert.equal(session.access.blockReason, 'account_closed');
      assert.equal(session.closure.id, actorRequest.id);
      for (const forbidden of ['profile','state','buildings','market','alliance']) assert.equal(Object.hasOwn(session,forbidden),false);
      const changed = await post('/api/profile/update', {colonyName:'Must not be saved',bio:'No mutation'}, initData(actor.telegramId));
      assert.ok(changed.status >= 400 && changed.status < 500);
      const build = await post('/api/game/build', {type:'mine',x:1,y:1}, initData(actor.telegramId));
      assert.ok(build.status >= 400 && build.status < 500);
      assert.deepEqual(await snapshot(actor), before);
    });

    await t.test('administrative listing and deletion preview are read-only and unavailable to an ordinary player', async () => {
      const before = await snapshot(actor);
      const adminBefore = plain({user:await sql`SELECT * FROM users WHERE telegram_id=${adminId}`,
        state:await sql`SELECT gs.* FROM game_states gs JOIN users u ON u.id=gs.user_id WHERE u.telegram_id=${adminId}`});
      for (const auth of [initData(actor.telegramId),initData(other.telegramId)]) {
        check(await post(LIST, {}, auth), 403);
        check(await post(PLAN, {requestId:actorRequest.id}, auth), 403);
      }
      const listed = check(await post(LIST, {}, initData(adminId)), 200).requests;
      assert.ok(listed.some(row=>row.id===actorRequest.id && row.userId===actor.userId));
      const plan = check(await post(PLAN, {requestId:actorRequest.id}, initData(adminId)), 200).plan;
      assert.equal(plan.request.id, actorRequest.id);
      assert.equal(plan.executable, false);
      assert.equal(plan.copiesStatus, 'not_reviewed');
      assert.equal(typeof plan.counts, 'object');
      assert.ok(Array.isArray(plan.blockers));
      assert.ok(Array.isArray(plan.categories));
      assert.deepEqual(await snapshot(actor), before);
      assert.deepEqual(plain({user:await sql`SELECT * FROM users WHERE telegram_id=${adminId}`,
        state:await sql`SELECT gs.* FROM game_states gs JOIN users u ON u.id=gs.user_id WHERE u.telegram_id=${adminId}`}),adminBefore);
    });

    await t.test('closure status stays private and another account cannot cancel the request', async () => {
      assert.equal(check(await status(other),200).request,null);
      const before = await readCase(actor);
      check(await cancel(other,actorRequest.id),404);
      check(await cancel(actor,crypto.randomUUID()),404);
      check(await post(CANCEL,{requestId:actorRequest.id,confirmation:'Отменить'},initData(actor.telegramId)),400);
      assert.deepEqual(await readCase(actor),before);
    });

    await t.test('withdrawing an unexecuted request reopens normal play without restoring notification permission', async () => {
      const cancelled = check(await cancel(actor,actorRequest.id),200).request;
      assert.equal(cancelled.id,actorRequest.id);
      assert.equal(cancelled.status,'cancelled');
      cancelledCaseBytes=await fs.readFile(filename(actor));
      assert.equal(check(await status(actor),200).request.status,'cancelled');
      const session = check(await post('/api/session',{},initData(actor.telegramId)),200);
      assert.notEqual(session.closed,true);
      assert.equal(session.userId,actor.userId);
      assert.ok(session.state);
      assert.equal((await sql`SELECT enabled FROM notification_preferences WHERE user_id=${actor.userId}`)[0].enabled,false);
      assert.equal((await sql`SELECT bot_write_allowed FROM users WHERE id=${actor.userId}`)[0].bot_write_allowed,false);
    });

    await t.test('a new explicit request after withdrawal has its own request ID and cannot be cancelled using the old ID', async () => {
      await sql`DELETE FROM api_rate_limits WHERE bucket_key=${rateKey(actor)}`;
      const fresh = check(await close(actor),200).request;
      assert.notEqual(fresh.id,actorRequest.id);
      assert.equal(fresh.status,'requested');
      check(await cancel(actor,actorRequest.id),404);
      const events = (await fs.readFile(path.join(directory,'events.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line).value);
      assert.ok(events.some(event=>event.requestId===actorRequest.id && event.action==='self_closure_cancelled'));
      assert.ok(events.some(event=>event.requestId===fresh.id && event.action==='self_closure_requested'));
      actorRequest=fresh;
    });

    await t.test('restoring an older signed cancelled case cannot override the newer requested closure in the durable index and journal', async () => {
      assert.ok(cancelledCaseBytes);
      const current=await fs.readFile(filename(actor));
      const before=await snapshot(actor);
      await fs.writeFile(filename(actor),cancelledCaseBytes);
      try {
        const response=await post('/api/session',{},initData(actor.telegramId));
        if(response.status===200) {
          assert.equal(response.data.closed,true);
          assert.equal(response.data.userId,null);
          assert.equal(response.data.closure.id,actorRequest.id);
        } else check(response,503);
        assert.deepEqual(await snapshot(actor),before);
      } finally {await fs.writeFile(filename(actor),current);}
      assert.equal(check(await status(actor),200).request.id,actorRequest.id);
    });

    await t.test('a closure remains effective after a PostgreSQL-only rollback recreates the Telegram identity under a different UUID', async () => {
      const closed = check(await close(restored),200).request;
      await sql`DELETE FROM users WHERE id=${restored.userId}`;
      const [replacement] = await sql`INSERT INTO users(telegram_id,first_name,colony_name,last_seen_at)
        VALUES(${restored.telegramId},'Restored database snapshot','Restored synthetic account',TIMESTAMPTZ '2024-01-01 00:00:00+00') RETURNING *`;
      assert.notEqual(replacement.id,restored.userId);
      const before = plain(replacement);
      const count = await countUsers();
      const session=check(await post('/api/session',{},initData(restored.telegramId)),200);
      assert.equal(session.closed,true);
      assert.equal(session.userId,null);
      assert.equal(session.closure.id,closed.id);
      assert.equal(await countUsers(),count);
      assert.deepEqual(plain((await sql`SELECT * FROM users WHERE id=${replacement.id}`)[0]),before);
      assert.equal((await sql`SELECT 1 FROM game_states WHERE user_id=${replacement.id}`).length,0);
      assert.equal(check(await status(restored),200).request.id,closed.id);
    });

    await t.test('loss of an individual case file cannot reopen a closed account when its signed journal and index survive', async () => {
      const closed=check(await close(missing),200).request;
      const original=filename(missing);const hidden=original+'.integration-hidden';
      const before=await snapshot(missing);
      await fs.rename(original,hidden);
      try {
        const response=await post('/api/session',{},initData(missing.telegramId));
        if(response.status===200){
          assert.equal(response.data.closed,true);
          assert.equal(response.data.userId,null);
          assert.equal(response.data.closure.id,closed.id);
        } else check(response,503);
        assert.deepEqual(await snapshot(missing),before);
      } finally {await fs.rename(hidden,original);}
      assert.equal(check(await status(missing),200).request.id,closed.id);
    });

    await t.test('a tampered signed store fails closed and returns a generic error without echoing credentials or case contents', async () => {
      const meta=path.join(directory,'meta.json');const bytes=await fs.readFile(meta);
      const before=await snapshot(untouched);
      const envelope=JSON.parse(bytes.toString('utf8'));envelope.signature='0'.repeat(64);
      await fs.writeFile(meta,JSON.stringify(envelope));
      try {
        for(const reply of [await status(untouched),await post('/api/session',{},initData(untouched.telegramId))]) {
          check(reply,503);
          const serialized=JSON.stringify(reply.data);
          assert.equal(serialized.includes(privacy.secret),false);
          assert.equal(serialized.includes(key(untouched.telegramId)),false);
          assert.equal(serialized.includes(String(untouched.telegramId)),false);
          assert.equal(/signature|meta\.json|Privacy key|SELECT|postgres/i.test(serialized),false);
        }
        assert.deepEqual(await snapshot(untouched),before);
      } finally {await fs.writeFile(meta,bytes);}
      assert.equal(check(await status(untouched),200).request,null);
    });

    await t.test('an unavailable privacy directory never falls back to ordinary account registration', async () => {
      const hidden=directory+'.integration-unavailable';const before=await snapshot(untouched);
      const count=await countUsers();
      await fs.rename(directory,hidden);
      try {
        check(await status(untouched),503);
        check(await post('/api/session',{},initData(untouched.telegramId)),503);
        assert.equal(await countUsers(),count);
        assert.deepEqual(await snapshot(untouched),before);
      } finally {await fs.rename(hidden,directory);}
      assert.equal(check(await status(untouched),200).request,null);
    });
  } finally {
    // Keep the disposable signed ledger intact until the parent stops the server
    // and removes this complete unique temporary store. Partial cleanup could
    // invalidate its index or make a test account appear open again.
    const telegramIds=fixtures.map(fixture=>fixture.telegramId);
    if(telegramIds.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(telegramIds)}::bigint[])`;
    const keys=[...fixtures.map(rateKey),`privacy-request:${key(unknownId)}`];
    await sql`DELETE FROM api_rate_limits WHERE bucket_key=ANY(${sql.array(keys)}::text[])`;
    for(const setting of originalSettings) await sql`UPDATE system_settings SET value=${sql.json(setting.value)} WHERE setting_key=${setting.setting_key}`;
  }
}
