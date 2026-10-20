import assert from 'node:assert/strict';

export async function runContractsIntegration({ t, sql, request, initData, playerId, adminId }) {
  const post = (path, body) => request(path, { method: 'POST', auth: initData(playerId), body });
  const session = async () => {
    const response = await post('/api/session');
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  const complete = (contractId) => post('/api/game/contracts/complete', { contractId });
  const balances = async (userId) => Object.fromEntries(Object.entries((await sql`
    SELECT ore,energy,parts,credits,crystals FROM game_states WHERE user_id=${userId}
  `)[0]).map(([key,value]) => [key,Number(value)]));
  async function fixture(tradeStatus = 'active') {
    const userId = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0].id;
    await sql`DELETE FROM npc_contracts WHERE user_id=${userId}`;
    await sql`DELETE FROM market_orders WHERE user_id=${userId}`;
    await sql`DELETE FROM user_research WHERE user_id=${userId}`;
    await sql`DELETE FROM buildings WHERE user_id=${userId}`;
    await sql`DELETE FROM city_decor WHERE user_id=${userId}`;
    await sql`DELETE FROM api_rate_limits WHERE bucket_key=${`global:${userId}`}`;
    await sql`UPDATE player_stats SET contracts_completed=0 WHERE user_id=${userId}`;
    await sql`INSERT INTO buildings (user_id,type,level,x,y,status) VALUES (${userId},'hq',3,2,2,'active')`;
    if (tradeStatus) await sql`
      INSERT INTO buildings (user_id,type,level,x,y,status,target_level,completes_at)
      VALUES (${userId},'trade_hub',${tradeStatus === 'active' ? 1 : 0},0,0,${tradeStatus},
        ${tradeStatus === 'active' ? null : 1},${tradeStatus === 'active' ? null : new Date(Date.now()+86_400_000)})
    `;
    await sql`
      UPDATE game_states SET hq_level=3,ore=2000,energy=1200,parts=700,credits=10000,crystals=0,premium_until=NULL,
        passive_carry='{}'::jsonb,last_tick_at=now()+interval '1 day' WHERE user_id=${userId}
    `;
    return userId;
  }

  await t.test('contracts distinguish a missing or pending hub from an active hub with a timed batch', async () => {
    for (const status of [null, 'building']) {
      const userId = await fixture(status);
      const game = await session();
      assert.equal(game.contractsInfo.enabled, false);
      assert.equal(game.contractsInfo.nextAt, null);
      assert.deepEqual(game.contracts, []);
      assert.equal(Number((await sql`SELECT count(*) AS count FROM npc_contracts WHERE user_id=${userId}`)[0].count), 0);
    }
    const userId = await fixture();
    const game = await session();
    assert.equal(game.contractsInfo.enabled, true);
    assert.equal(game.contracts.length, 3);
    for (const contract of game.contracts) assert.ok(new Date(contract.expires_at).getTime() > Date.now());
    assert.equal((await session()).contracts.length, 3);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM npc_contracts WHERE user_id=${userId}`)[0].count), 3);
  });

  await t.test('completing the batch shows the next refresh and an old batch refills only three contracts', async () => {
    const userId = await fixture();
    const game = await session();
    for (const contract of game.contracts) {
      const completed = await complete(contract.id);
      assert.equal(completed.status, 200, JSON.stringify(completed.data));
    }
    const empty = await session();
    assert.equal(empty.contractsInfo.enabled, true);
    assert.deepEqual(empty.contracts, []);
    assert.ok(new Date(empty.contractsInfo.nextAt).getTime() > Date.now());
    const expected = (await sql`SELECT min(created_at)+interval '6 hours' AS next_at FROM npc_contracts WHERE user_id=${userId}`)[0].next_at;
    assert.equal(new Date(empty.contractsInfo.nextAt).getTime(), new Date(expected).getTime());
    await sql`UPDATE npc_contracts SET created_at=now()-interval '7 hours' WHERE user_id=${userId}`;
    const next = await session();
    assert.equal(next.contracts.length, 3);
    assert.equal((await session()).contracts.length, 3);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM npc_contracts WHERE user_id=${userId}`)[0].count), 6);
  });

  await t.test('contract ownership, expiry, shortages and malformed requests never charge resources', async () => {
    const userId = await fixture();
    const contract = (await session()).contracts[0];
    const other = await request('/api/game/contracts/complete', { method: 'POST', auth: initData(adminId), body: { contractId: contract.id } });
    assert.equal(other.status, 400, JSON.stringify(other.data));
    for (const body of [null, [], {}, { contractId: null }, { contractId: {} }, { contractId: 'invalid' }]) {
      assert.equal((await post('/api/game/contracts/complete', body)).status, 400);
    }
    if (contract.resource === 'ore') await sql`UPDATE game_states SET ore=${Number(contract.amount)-1} WHERE user_id=${userId}`;
    else await sql`UPDATE game_states SET parts=${Number(contract.amount)-1} WHERE user_id=${userId}`;
    const before = await balances(userId);
    const shortage = await complete(contract.id);
    assert.equal(shortage.status, 400, JSON.stringify(shortage.data));
    assert.match(shortage.data.error, /Не хватает/);
    assert.deepEqual(await balances(userId), before);
    await sql`UPDATE npc_contracts SET expires_at=now()-interval '1 second' WHERE id=${contract.id}`;
    const expired = await complete(contract.id);
    assert.equal(expired.status, 400, JSON.stringify(expired.data));
    assert.match(expired.data.error, /истёк/);
    assert.deepEqual(await balances(userId), before);
    assert.equal((await sql`SELECT completed_at FROM npc_contracts WHERE id=${contract.id}`)[0].completed_at, null);
    assert.equal(Number((await sql`SELECT contracts_completed FROM player_stats WHERE user_id=${userId}`)[0].contracts_completed), 0);
  });

  await t.test('parallel contract completion and retry return one exact receipt and one progress event', async () => {
    const userId = await fixture();
    const contract = (await session()).contracts[0];
    const before = await balances(userId);
    const result = { contractId: contract.id, resource: contract.resource, amount: Number(contract.amount), credits: Number(contract.credit_reward) };
    const replies = await Promise.all([complete(contract.id), complete(contract.id)]);
    assert.ok(replies.every((reply) => reply.status === 200), JSON.stringify(replies));
    assert.deepEqual(replies[0].data.result, result);
    assert.deepEqual(replies[1].data.result, result);
    const expected = { ...before, [contract.resource]: before[contract.resource]-result.amount, credits: before.credits+result.credits };
    assert.deepEqual(await balances(userId), expected);
    await sql`UPDATE npc_contracts SET expires_at=now()-interval '1 second' WHERE id=${contract.id}`;
    const retry = await complete(contract.id);
    assert.equal(retry.status, 200, JSON.stringify(retry.data));
    assert.deepEqual(retry.data.result, result);
    assert.deepEqual(await balances(userId), expected);
    assert.equal(Number((await sql`SELECT contracts_completed FROM player_stats WHERE user_id=${userId}`)[0].contracts_completed), 1);
  });

  await t.test('quest and season claims can run alongside construction and foundry without a lock inversion', async () => {
    const userId = await fixture();
    await session();
    await sql`INSERT INTO buildings (user_id,type,level,x,y,status) VALUES (${userId},'foundry',1,1,0,'active')`;
    const foundry = (await sql`SELECT id FROM buildings WHERE user_id=${userId} AND type='foundry'`)[0];
    await sql`UPDATE daily_quests SET progress=target,claimed_at=NULL WHERE user_id=${userId} AND quest_key='daily_build' AND quest_date=CURRENT_DATE`;
    const season = (await sql`SELECT id FROM seasons WHERE id='s1_first_signal' AND starts_at<=now() AND ends_at>now()`)[0];
    assert.ok(season, 'The isolated integration database must have its seeded active season');
    await sql`DELETE FROM season_claims WHERE user_id=${userId} AND season_id=${season.id}`;
    await sql`
      INSERT INTO season_progress (user_id,season_id,points) VALUES (${userId},${season.id},1000)
      ON CONFLICT(user_id,season_id) DO UPDATE SET points=1000
    `;
    const before = await balances(userId);
    let guard;
    let replies;
    try {
      replies = await Promise.race([
        Promise.all([
          post('/api/game/quests/claim', { period: 'daily', questKey: 'daily_build' }),
          post('/api/season/claim', { level: 1 }),
          post('/api/game/build', { type: 'mine', x: 3, y: 1 }),
          post('/api/game/foundry/start', { buildingId: foundry.id }),
        ]),
        new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('Parallel reward/production requests did not finish within 10 seconds')), 10_000); }),
      ]);
    } finally { clearTimeout(guard); }
    assert.ok(replies.every((reply) => reply.status === 200), JSON.stringify(replies));
    assert.deepEqual(await balances(userId), { ...before, ore: before.ore-220, energy: before.energy-40, credits: before.credits+650, crystals: before.crystals+6 });
    assert.ok((await sql`SELECT claimed_at FROM daily_quests WHERE user_id=${userId} AND quest_key='daily_build' AND quest_date=CURRENT_DATE`)[0].claimed_at);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM season_claims WHERE user_id=${userId} AND season_id=${season.id} AND level=1`)[0].count), 1);
    const settled = await balances(userId);
    assert.equal((await post('/api/game/quests/claim', { period: 'daily', questKey: 'daily_build' })).status, 400);
    assert.equal((await post('/api/season/claim', { level: 1 })).status, 400);
    assert.deepEqual(await balances(userId), settled);
  });
}
