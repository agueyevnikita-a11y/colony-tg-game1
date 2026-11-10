import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const ISSUE = '/api/support/ownership-proof';
const VERIFY = '/api/admin/support/ownership-proof';
const CODE = /^CG-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/;
const BAD_CODE = 'CG-00000000-00000000-00000000-00000000';
const FAILURE_CONSTRAINT = 'ownership_proof_integration_block_writes';
const plain = value => JSON.parse(JSON.stringify(value));

/** Signed production API checks; never accepts the live database as a target. */
export async function runSupportOwnershipIntegration({ t, sql, request, initData, playerId, adminId }) {
  assert.equal(process.env.COLONY_TEST_DATABASE, '1');
  const database = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.match(database.pathname, /^\/colony_(ci|test)$/);
  const [maintenance] = await sql`SELECT value FROM system_settings WHERE setting_key='maintenance'`;
  assert.ok(maintenance);
  const players = [];
  const unknownId = playerId + 42_999;
  const verifyKey = `support-proof:verify:${adminId}`;
  let failureConstraintAdded = false;

  function check(reply, status) {
    assert.equal(reply.status, status);
    assert.match(reply.headers.get('cache-control') || '', /(?:^|[,\s])no-store(?:$|[,\s])/i);
    assert.equal(reply.data.ok, status === 200);
    return reply.data;
  }
  const issue = (player, body = {}, auth = initData(player.telegramId)) => request(ISSUE, { method: 'POST', auth, body });
  const verify = (code, requestRef = 'COLONY-TEST-001', auth = initData(adminId), extra = {}) =>
    request(VERIFY, { method: 'POST', auth, body: { code, requestRef, ...extra } });
  const keys = () => [...players.flatMap(player => [
    `support-proof:issue:${player.userId}:hour`, `support-proof:issue:${player.userId}:day`,
  ]), verifyKey];
  const resetLimits = () => sql`DELETE FROM api_rate_limits WHERE bucket_key=ANY(${sql.array(keys())}::text[])`;
  const proofs = userId => sql`SELECT * FROM account_ownership_proofs WHERE user_id=${userId} ORDER BY issued_at,id`;
  async function issued(player) {
    const data = check(await issue(player), 200);
    assert.deepEqual(Object.keys(data).sort(), ['ok', 'code', 'expiresAt'].sort());
    assert.equal(data.code.length, 38);
    assert.match(data.code, CODE);
    assert.ok(Number.isFinite(new Date(data.expiresAt).getTime()));
    return data;
  }
  async function snapshot() {
    const ids = players.map(player => player.userId);
    const [admin] = await sql`SELECT id FROM users WHERE telegram_id=${adminId}`;
    if (admin) ids.push(admin.id);
    return plain({
      users: await sql`SELECT * FROM users WHERE id=ANY(${sql.array(ids)}::uuid[]) ORDER BY id`,
      states: await sql`SELECT * FROM game_states WHERE user_id=ANY(${sql.array(ids)}::uuid[]) ORDER BY user_id`,
      beta: await sql`SELECT * FROM beta_access WHERE user_id=ANY(${sql.array(ids)}::uuid[]) ORDER BY user_id`,
      preferences: await sql`SELECT * FROM notification_preferences WHERE user_id=ANY(${sql.array(ids)}::uuid[]) ORDER BY user_id`,
      buildings: await sql`SELECT * FROM buildings WHERE user_id=ANY(${sql.array(ids)}::uuid[]) ORDER BY id`,
      jobs: await sql`SELECT * FROM notification_jobs WHERE user_id=ANY(${sql.array(ids)}::uuid[]) ORDER BY id`,
      settings: await sql`SELECT setting_key,value FROM system_settings WHERE setting_key IN ('maintenance','beta_required') ORDER BY setting_key`,
      flags: await sql`SELECT flag_key,enabled,rollout_percent FROM feature_flags WHERE flag_key IN ('notifications','stars_shop') ORDER BY flag_key`,
      metrics: await sql`SELECT 'analytics' AS kind,count(*)::int AS count FROM analytics_events
                        UNION ALL SELECT 'errors',count(*)::int FROM error_events ORDER BY kind`,
      userCount: Number((await sql`SELECT count(*)::int AS count FROM users`)[0].count),
    });
  }
  async function scenario(name, run) {
    await t.test(name, async () => {
      await resetLimits();
      const before = await snapshot();
      try { await run(); }
      finally { assert.deepEqual(await snapshot(), before, 'Proof endpoints must not mutate profiles, game, beta, notifications or metrics'); }
    });
  }
  async function seedLimit(bucketKey, count) {
    await sql`INSERT INTO api_rate_limits(bucket_key,window_started_at,request_count,updated_at)
      VALUES(${bucketKey},now(),${count},now())
      ON CONFLICT(bucket_key) DO UPDATE SET window_started_at=now(),request_count=${count},updated_at=now()`;
  }

  try {
    await sql`UPDATE system_settings SET value=${sql.json({ ...maintenance.value, enabled: true })} WHERE setting_key='maintenance'`;
    for (let index = 0; index < 2; index++) {
      const telegramId = playerId + 42_000 + index;
      const [row] = await sql`INSERT INTO users(telegram_id,first_name,username,colony_name,profile_bio,last_seen_at,bot_write_allowed)
        VALUES(${telegramId},'PRIVATE_SUPPORT_NAME',${`support_private_${index}`},${`Проверка поддержки ${index}`},'Исходный профиль',TIMESTAMPTZ '2025-01-01 00:00:00+00',false)
        RETURNING id`;
      const player = { userId: row.id, telegramId };
      players.push(player);
      await sql`INSERT INTO game_states(user_id,credits,last_tick_at) VALUES(${row.id},4321,now()+interval '1 day')`;
      await sql`INSERT INTO notification_preferences(user_id,enabled) VALUES(${row.id},false)`;
    }
    const [owner, other] = players;

    await scenario('support proof rejects missing, forged and older-than-five-minute authentication on both routes', async () => {
      const forged = new URLSearchParams(initData(owner.telegramId));
      forged.set('user', JSON.stringify({ id: owner.telegramId, first_name: 'Tampered support identity' }));
      const forgedAdmin = new URLSearchParams(initData(adminId));
      forgedAdmin.set('hash', '0'.repeat(64));
      const stale = Math.floor(Date.now() / 1000) - 301;
      for (const auth of [undefined, forged.toString(), initData(owner.telegramId, {}, stale)]) {
        check(await request(ISSUE, { method: 'POST', auth, body: {} }), 401);
      }
      for (const auth of [undefined, forgedAdmin.toString(), initData(adminId, {}, stale)]) {
        check(await request(VERIFY, { method: 'POST', auth, body: { code: BAD_CODE, requestRef: 'COLONY-TEST-001' } }), 401);
      }
      assert.equal((await proofs(owner.userId)).length, 0);
    });

    await scenario('support proof does not register an unknown signed Telegram identity during maintenance', async () => {
      assert.equal((await sql`SELECT id FROM users WHERE telegram_id=${unknownId}`).length, 0);
      const before = Number((await sql`SELECT count(*)::int AS count FROM account_ownership_proofs`)[0].count);
      check(await request(ISSUE, { method: 'POST', auth: initData(unknownId), body: {} }), 404);
      assert.equal((await sql`SELECT id FROM users WHERE telegram_id=${unknownId}`).length, 0);
      assert.equal(Number((await sql`SELECT count(*)::int AS count FROM account_ownership_proofs`)[0].count), before);
    });

    await scenario('support proof issuance rejects another account target and unsupported operations', async () => {
      const before = plain(await proofs(owner.userId));
      for (const body of [{ userId: other.userId }, { telegramId: other.telegramId }, { action: 'delete' }, { action: 'export' }, []]) {
        check(await issue(owner, body), 400);
      }
      assert.deepEqual(plain(await proofs(owner.userId)), before);
      assert.equal((await proofs(other.userId)).length, 0);
    });

    await scenario('existing players without beta access obtain a 24-hour hashed proof while maintenance stays enabled', async () => {
      assert.equal((await sql`SELECT user_id FROM beta_access WHERE user_id=${owner.userId}`).length, 0);
      const result = await issued(owner);
      const [row] = (await proofs(owner.userId)).filter(proof => !proof.consumed_at && !proof.revoked_at);
      assert.ok(row);
      assert.match(row.token_hash, /^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(row).toLowerCase().includes(result.code.toLowerCase()), false);
      assert.equal(JSON.stringify(row).toLowerCase().includes(result.code.slice(3).replaceAll('-', '').toLowerCase()), false);
      assert.equal(new Date(row.expires_at).toISOString(), result.expiresAt);
      assert.ok(Math.abs(new Date(row.expires_at).getTime() - new Date(row.issued_at).getTime() - 86_400_000) < 5000);
      assert.equal((await sql`SELECT value FROM system_settings WHERE setting_key='maintenance'`)[0].value.enabled, true);
    });

    await scenario('admin verification consumes a legitimate proof and returns only the bound game identity', async () => {
      const result = await issued(owner);
      const data = check(await verify(result.code), 200);
      assert.deepEqual(Object.keys(data).sort(), ['ok', 'verification'].sort());
      assert.deepEqual(Object.keys(data.verification).sort(), ['id', 'userId', 'colonyName', 'issuedAt', 'verifiedAt', 'requestRef'].sort());
      assert.equal(data.verification.userId, owner.userId);
      assert.equal(data.verification.colonyName, 'Проверка поддержки 0');
      assert.equal(data.verification.requestRef, 'COLONY-TEST-001');
      const [row] = await sql`SELECT * FROM account_ownership_proofs WHERE id=${data.verification.id}`;
      assert.equal(row.user_id, owner.userId);
      assert.equal(String(row.verified_by_telegram_id), String(adminId));
      assert.equal(new Date(row.issued_at).toISOString(), data.verification.issuedAt);
      assert.equal(new Date(row.consumed_at).toISOString(), data.verification.verifiedAt);
      assert.equal(row.request_ref, 'COLONY-TEST-001');
      assert.equal(JSON.stringify(data).includes(result.code), false);
      assert.equal(JSON.stringify(data).includes(row.token_hash), false);
    });

    await scenario('ordinary players cannot probe or consume a proof through the admin route', async () => {
      const result = await issued(owner);
      const before = plain(await proofs(owner.userId));
      for (const code of [result.code, BAD_CODE]) check(await verify(code, 'COLONY-TEST-001', initData(other.telegramId)), 403);
      assert.deepEqual(plain(await proofs(owner.userId)), before);
      assert.equal((await sql`SELECT bucket_key FROM api_rate_limits WHERE bucket_key=${verifyKey}`).length, 0);
      check(await verify(result.code), 200);
    });

    await scenario('verification requires a bounded request reference and rejects target, export and delete fields', async () => {
      const result = await issued(owner);
      const before = plain(await proofs(owner.userId));
      const invalid = [
        { code: result.code }, { code: result.code, requestRef: '' }, { code: result.code, requestRef: null },
        { code: result.code, requestRef: 'COLONY TEST' }, { code: result.code, requestRef: 'A'.repeat(65) },
        { code: result.code, requestRef: '../request' },
        { code: result.code, requestRef: 'COLONY-TEST-001', userId: other.userId },
        { code: result.code, requestRef: 'COLONY-TEST-001', action: 'delete' },
        { code: result.code, requestRef: 'COLONY-TEST-001', action: 'export' },
      ];
      for (const body of invalid) check(await request(VERIFY, { method: 'POST', auth: initData(adminId), body }), 400);
      assert.deepEqual(plain(await proofs(owner.userId)), before);
      check(await verify(result.code, 'COLONY_test-001'), 200);
    });

    await scenario('incorrect and malformed proof codes do not consume another active proof', async () => {
      const result = await issued(owner);
      const before = plain(await proofs(owner.userId));
      for (const code of [BAD_CODE, 'not-a-proof']) check(await verify(code), 400);
      assert.deepEqual(plain(await proofs(owner.userId)), before);
      check(await verify(result.code), 200);
    });

    await scenario('expired ownership proofs are rejected without consumption', async () => {
      const result = await issued(owner);
      await sql`UPDATE account_ownership_proofs SET issued_at=now()-interval '2 days',expires_at=now()-interval '1 day'
        WHERE user_id=${owner.userId} AND consumed_at IS NULL AND revoked_at IS NULL`;
      check(await verify(result.code), 400);
      const [row] = (await proofs(owner.userId)).filter(proof => !proof.consumed_at && !proof.revoked_at);
      assert.ok(row);
      assert.equal(row.consumed_at, null);
    });

    await scenario('issuing a replacement revokes the previous unused code', async () => {
      const first = await issued(owner);
      const second = await issued(owner);
      assert.notEqual(first.code, second.code);
      check(await verify(first.code), 400);
      check(await verify(second.code), 200);
    });

    await scenario('a consumed ownership proof cannot be replayed for another request', async () => {
      const result = await issued(owner);
      const first = check(await verify(result.code, 'COLONY-FIRST'), 200);
      check(await verify(result.code, 'COLONY-SECOND'), 400);
      const [row] = await sql`SELECT request_ref,consumed_at FROM account_ownership_proofs WHERE id=${first.verification.id}`;
      assert.equal(row.request_ref, 'COLONY-FIRST');
      assert.equal(new Date(row.consumed_at).toISOString(), first.verification.verifiedAt);
    });

    await scenario('simultaneous issuance leaves only one usable code for an account', async () => {
      const issuedReplies = await Promise.all([issue(owner), issue(owner)]);
      const codes = issuedReplies.map(reply => check(reply, 200).code);
      assert.notEqual(codes[0], codes[1]);
      assert.equal((await proofs(owner.userId)).filter(proof => !proof.consumed_at && !proof.revoked_at).length, 1);
      const replies = await Promise.all(codes.map((code, index) => verify(code, `COLONY-ISSUE-RACE-${index}`)));
      for (const reply of replies) check(reply, reply.status);
      assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 400]);
    });

    await scenario('two simultaneous verifications consume a code exactly once', async () => {
      const result = await issued(owner);
      const replies = await Promise.all([
        verify(result.code, 'COLONY-RACE-A'), verify(result.code, 'COLONY-RACE-B'),
      ]);
      for (const reply of replies) check(reply, reply.status);
      assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 400]);
      const winner = replies.find(reply => reply.status === 200).data.verification;
      const [row] = await sql`SELECT consumed_at,request_ref FROM account_ownership_proofs WHERE id=${winner.id}`;
      assert.equal(row.request_ref, winner.requestRef);
      assert.equal(new Date(row.consumed_at).toISOString(), winner.verifiedAt);
    });

    await scenario('issuance is limited to three codes per hour without revoking the last permitted code', async () => {
      const before = (await proofs(owner.userId)).length;
      for (let count = 0; count < 3; count++) await issued(owner);
      const permitted = plain(await proofs(owner.userId));
      const rejected = await issue(owner);
      check(rejected, 429);
      assert.ok(Number(rejected.headers.get('retry-after')) > 0);
      assert.equal((await proofs(owner.userId)).length, before + 3);
      assert.deepEqual(plain(await proofs(owner.userId)), permitted);
    });

    await scenario('the daily issuance ceiling is enforced independently of a fresh hourly window', async () => {
      await seedLimit(`support-proof:issue:${owner.userId}:day`, 20);
      const before = plain(await proofs(owner.userId));
      check(await issue(owner), 429);
      assert.deepEqual(plain(await proofs(owner.userId)), before);
    });

    await scenario('the admin verification ceiling cannot consume a code after thirty checks', async () => {
      const result = await issued(owner);
      await seedLimit(verifyKey, 30);
      const before = plain(await proofs(owner.userId));
      check(await verify(result.code), 429);
      assert.deepEqual(plain(await proofs(owner.userId)), before);
      await sql`DELETE FROM api_rate_limits WHERE bucket_key=${verifyKey}`;
      check(await verify(result.code), 200);
    });

    await scenario('unexpected database write failures return safe uncached 503 replies and preserve the proof', async () => {
      const result = await issued(owner);
      assert.equal((await sql`SELECT conname FROM pg_constraint WHERE conname=${FAILURE_CONSTRAINT}`).length, 0);
      try {
        // Only in the guarded isolated database: fail writes without deleting or renaming rows.
        await sql.unsafe(`ALTER TABLE account_ownership_proofs ADD CONSTRAINT ${FAILURE_CONSTRAINT} CHECK (false) NOT VALID`);
        failureConstraintAdded = true;
        for (const reply of [await issue(owner), await verify(result.code)]) {
          const data = check(reply, 503);
          assert.deepEqual(Object.keys(data).sort(), ['ok', 'error'].sort());
          assert.equal(typeof data.error, 'string');
          assert.equal(/postgres|account_ownership|token_hash|constraint|\b(?:SELECT|UPDATE|INSERT)\b/i.test(data.error), false);
          assert.equal(JSON.stringify(data).includes(result.code), false);
        }
      } finally {
        if (failureConstraintAdded) {
          await sql.unsafe(`ALTER TABLE account_ownership_proofs DROP CONSTRAINT ${FAILURE_CONSTRAINT}`);
          failureConstraintAdded = false;
        }
      }
      check(await verify(result.code), 200);
    });
  } finally {
    if (failureConstraintAdded) await sql.unsafe(`ALTER TABLE account_ownership_proofs DROP CONSTRAINT ${FAILURE_CONSTRAINT}`);
    await resetLimits();
    if (players.length) {
      const ids = players.map(player => player.userId);
      await sql`DELETE FROM account_ownership_proofs WHERE user_id=ANY(${sql.array(ids)}::uuid[])`;
      await sql`DELETE FROM users WHERE id=ANY(${sql.array(ids)}::uuid[])`;
    }
    await sql`UPDATE system_settings SET value=${sql.json(maintenance.value)} WHERE setting_key='maintenance'`;
  }
}
