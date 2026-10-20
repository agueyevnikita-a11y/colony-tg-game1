import assert from 'node:assert/strict';

export async function runReferralsIntegration({ t, sql, request, initData, playerId }) {
  const ids = [];
  let sequence = playerId + 100;
  const post = (telegramId, path, body, startParam) => request(path, {
    method: 'POST', auth: initData(telegramId, {}, undefined, startParam), body,
  });
  const session = async (telegramId, startParam) => {
    const response = await post(telegramId, '/api/session', undefined, startParam);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  const claim = (telegramId, body) => post(telegramId, '/api/referrals/claim', body);
  const balance = async (userId) => {
    const [row] = await sql`SELECT credits,crystals FROM game_states WHERE user_id=${userId}`;
    return { credits: Number(row.credits), crystals: Number(row.crystals) };
  };
  async function player({ ageSeconds = 120, hq = 1, inviter, qualified = false } = {}) {
    const telegramId = sequence++;
    ids.push(telegramId);
    const [row] = await sql`
      INSERT INTO users(telegram_id,first_name,colony_name,created_at,referred_by,referral_qualified_at)
      VALUES(${telegramId},'Referral test',${`Колония ${telegramId}`},now()-make_interval(secs=>${ageSeconds}),${inviter ?? null},${qualified ? new Date() : null}) RETURNING id
    `;
    await sql`INSERT INTO game_states(user_id,hq_level,credits,crystals,last_tick_at) VALUES(${row.id},${hq},700,20,now()+interval '1 day')`;
    await sql`INSERT INTO player_stats(user_id) VALUES(${row.id})`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${row.id},'hq',${hq},2,2,'active')`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${row.id},'integration_test')`;
    return { userId: row.id, telegramId };
  }
  try {
  await t.test('referrals bind a new signed account once and reject self, old, malformed and younger inviters', async () => {
    const inviter = await player({ ageSeconds: 600 });
    const alternative = await player({ ageSeconds: 500 });
    const friend = await player({ ageSeconds: 0 });
    const linked = await session(friend.telegramId, `ref_${inviter.telegramId}`);
    assert.equal(linked.referralProgram.invitedBy.name, `Колония ${inviter.telegramId}`);
    await session(friend.telegramId, `ref_${alternative.telegramId}`);
    assert.equal((await sql`SELECT referred_by FROM users WHERE id=${friend.userId}`)[0].referred_by, inviter.userId);
    const old = await player({ ageSeconds: 3600 });
    await session(old.telegramId, `ref_${inviter.telegramId}`);
    assert.equal((await sql`SELECT referred_by FROM users WHERE id=${old.userId}`)[0].referred_by, null);
    const target = await player({ ageSeconds: 100 });
    const younger = await player({ ageSeconds: 0 });
    await session(target.telegramId, `ref_${younger.telegramId}`);
    await session(target.telegramId, `ref_${target.telegramId}`);
    await session(target.telegramId, `ref_0${inviter.telegramId}`);
    assert.equal((await sql`SELECT referred_by FROM users WHERE id=${target.userId}`)[0].referred_by, null);
  });

  await t.test('HQ2 gives no bonus; actual HQ3 qualifies once and lets each side claim only its own reward', async () => {
    const inviter = await player({ ageSeconds: 600 });
    const friend = await player({ hq: 2, inviter: inviter.userId });
    const stranger = await player();
    const initial = await session(friend.telegramId);
    assert.equal(initial.referralProgram.invitedBy.qualified, false);
    assert.equal(initial.referralProgram.pendingCount, 0);
    assert.equal((await claim(friend.telegramId)).data.result.count, 0);
    assert.deepEqual(await balance(friend.userId), { credits: 700, crystals: 20 });
    // Updating the cached hq_level alone must never qualify a player.
    await sql`UPDATE game_states SET hq_level=3 WHERE user_id=${friend.userId}`;
    assert.equal((await session(friend.telegramId)).referralProgram.invitedBy.qualified, false);
    await sql`UPDATE buildings SET level=3 WHERE user_id=${friend.userId} AND type='hq'`;
    const ready = await session(friend.telegramId);
    assert.equal(ready.referralProgram.invitedBy.qualified, true);
    assert.equal(ready.referralProgram.pendingCount, 1);
    assert.deepEqual(ready.referralProgram.pendingReward, { credits: 500, crystals: 10 });
    await Promise.all([session(friend.telegramId), session(friend.telegramId)]);
    assert.equal(Number((await sql`SELECT qualified_referrals FROM player_stats WHERE user_id=${inviter.userId}`)[0].qualified_referrals), 1);
    assert.deepEqual(await balance(inviter.userId), { credits: 700, crystals: 20 }, 'Qualification alone does not credit the per-friend bonus');
    const forged = await claim(stranger.telegramId, { userId: inviter.userId, invitedUserId: friend.userId });
    assert.equal(forged.status, 200, JSON.stringify(forged.data));
    assert.equal(forged.data.result.count, 0);
    const responses = await Promise.all([
      claim(inviter.telegramId), claim(inviter.telegramId), claim(friend.telegramId), claim(friend.telegramId),
    ]);
    assert.ok(responses.every((reply) => reply.status === 200), JSON.stringify(responses));
    assert.deepEqual(responses.slice(0, 2).map((reply) => reply.data.result.count).sort(), [0, 1]);
    assert.deepEqual(responses.slice(2).map((reply) => reply.data.result.count).sort(), [0, 1]);
    assert.deepEqual(await balance(inviter.userId), { credits: 1200, crystals: 30 });
    assert.deepEqual(await balance(friend.userId), { credits: 1200, crystals: 30 });
    assert.deepEqual(await balance(stranger.userId), { credits: 700, crystals: 20 });
    assert.equal(Number((await sql`SELECT count(*) AS count FROM referral_bonus_claims WHERE invited_user_id=${friend.userId}`)[0].count), 2);
    assert.equal((await claim(friend.telegramId)).data.result.count, 0);
    const inviterState = await session(inviter.telegramId);
    assert.equal(inviterState.referralProgram.friends[0].bonusClaimed, true);
    assert.equal(inviterState.referralProgram.roadmap.find((entry) => entry.target === 1).status, 'available');
    assert.equal((await session(friend.telegramId)).referralProgram.invitedBy.bonusClaimed, true);
  });

  await t.test('already qualified referrals receive the new bonus without replaying milestones, cosmetics or stats', async () => {
    const inviter = await player({ ageSeconds: 1000 });
    for (let index = 0; index < 3; index++) await player({ hq: 3, inviter: inviter.userId, qualified: true });
    await sql`UPDATE player_stats SET qualified_referrals=3 WHERE user_id=${inviter.userId}`;
    await sql`INSERT INTO referral_rewards(user_id,milestone) VALUES(${inviter.userId},3)`;
    await sql`INSERT INTO user_achievements(user_id,achievement_key,claimed_at) VALUES(${inviter.userId},'network_1',now())`;
    await sql`INSERT INTO user_cosmetics(user_id,cosmetic_id,source,expires_at) VALUES(${inviter.userId},'effect_signal','legacy_test',now()+interval '7 days')`;
    const before = await balance(inviter.userId);
    const response = await claim(inviter.telegramId);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.deepEqual(response.data.result, { count: 3, credits: 1500, crystals: 30 });
    assert.deepEqual(await balance(inviter.userId), { credits: before.credits + 1500, crystals: before.crystals + 30 });
    assert.equal(Number((await sql`SELECT qualified_referrals FROM player_stats WHERE user_id=${inviter.userId}`)[0].qualified_referrals), 3);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM referral_rewards WHERE user_id=${inviter.userId}`)[0].count), 1);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM user_cosmetics WHERE user_id=${inviter.userId} AND cosmetic_id='effect_signal'`)[0].count), 1);
    assert.equal(response.data.referralProgram.roadmap.find((entry) => entry.target === 1).status, 'received');
    assert.equal(response.data.referralProgram.roadmap.find((entry) => entry.target === 3).status, 'received');
    assert.equal((await claim(inviter.telegramId)).data.result.count, 0);
  });

  await t.test('referral counters and bulk claims include more than 100 friends with a bounded inbox receipt key', async () => {
    const inviter = await player({ ageSeconds: 1000 });
    const firstId = sequence;
    const extraIds = Array.from({ length: 101 }, (_, index) => firstId + index);
    sequence += extraIds.length;
    ids.push(...extraIds);
    await sql`
      INSERT INTO users(telegram_id,first_name,referred_by,referral_qualified_at)
      SELECT ${firstId}::bigint+i,'Large network test',${inviter.userId}::uuid,
        CASE WHEN i<51 THEN now() ELSE NULL END
      FROM generate_series(0,100) AS i
    `;
    const game = await session(inviter.telegramId);
    assert.equal(game.referralProgram.totalInvited, 101);
    assert.equal(game.referralProgram.qualifiedInvited, 51);
    assert.equal(game.referralProgram.friends.length, 100);
    assert.equal(game.referralProgram.pendingCount, 51);
    assert.deepEqual(game.referralProgram.pendingReward, { credits: 25500, crystals: 510 });
    await sql`UPDATE users SET referral_qualified_at=now() WHERE referred_by=${inviter.userId} AND referral_qualified_at IS NULL`;
    const before = await balance(inviter.userId);
    const paid = await claim(inviter.telegramId);
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.deepEqual(paid.data.result, { count: 101, credits: 50500, crystals: 1010 });
    assert.deepEqual(await balance(inviter.userId), { credits: before.credits+50500, crystals: before.crystals+1010 });
    assert.equal(Number((await sql`SELECT count(*) AS count FROM referral_bonus_claims WHERE user_id=${inviter.userId}`)[0].count), 101);
    const inbox = await sql`SELECT dedupe_key FROM game_inbox WHERE user_id=${inviter.userId} AND dedupe_key LIKE 'referral_bonus_%'`;
    assert.equal(inbox.length, 1);
    assert.match(inbox[0].dedupe_key, /^referral_bonus_[a-f0-9]{64}$/);
    assert.ok(inbox[0].dedupe_key.length < 100, 'Bulk awards must not overflow the unique inbox index entry');
    const settled = await balance(inviter.userId);
    const retries = await Promise.all([claim(inviter.telegramId), claim(inviter.telegramId)]);
    assert.ok(retries.every((reply) => reply.status === 200), JSON.stringify(retries));
    assert.deepEqual(retries.map((reply) => reply.data.result.count), [0, 0]);
    assert.deepEqual(await balance(inviter.userId), settled);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM game_inbox WHERE user_id=${inviter.userId} AND dedupe_key LIKE 'referral_bonus_%'`)[0].count), 1);
  });

  await t.test('historical mutual referrals qualify concurrently without reversing balance lock order', async () => {
    const first = await player({ hq: 3, ageSeconds: 600 });
    const second = await player({ hq: 3, ageSeconds: 500, inviter: first.userId });
    // Legacy records may predate the new rule requiring an older inviter.
    await sql`UPDATE users SET referred_by=${second.userId} WHERE id=${first.userId}`;
    await sql`UPDATE player_stats SET qualified_referrals=2 WHERE user_id IN (${first.userId},${second.userId})`;
    let guard;
    try {
      await Promise.race([
        Promise.all([session(first.telegramId), session(second.telegramId)]),
        new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('Concurrent referral qualification exceeded 10 seconds')), 10_000); }),
      ]);
    } finally { clearTimeout(guard); }
    for (const user of [first, second]) {
      assert.equal(Number((await sql`SELECT qualified_referrals FROM player_stats WHERE user_id=${user.userId}`)[0].qualified_referrals), 3);
      assert.deepEqual(await balance(user.userId), { credits: 700, crystals: 40 }, 'The old milestone still pays exactly once');
      assert.equal(Number((await sql`SELECT count(*) AS count FROM referral_rewards WHERE user_id=${user.userId} AND milestone=3`)[0].count), 1);
      await session(user.telegramId);
      assert.deepEqual(await balance(user.userId), { credits: 700, crystals: 40 });
    }
  });
  } finally {
    if (ids.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(ids)}::bigint[])`;
  }
}
