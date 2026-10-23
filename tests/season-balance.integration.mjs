import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export async function runSeasonBalanceIntegration({ t, sql, request, initData, playerId }) {
  const players = [];
  let sequence = playerId + 30000;
  const post = (player, path, body) => request(path, { method: 'POST', auth: initData(player.telegramId), body });
  const points = async (player) => Number((await sql`SELECT points FROM season_progress WHERE user_id=${player.userId} AND season_id='s1_first_signal'`)[0].points);
  const wallet = async (player) => Object.fromEntries(Object.entries((await sql`SELECT ore,energy,parts,credits,crystals FROM game_states WHERE user_id=${player.userId}`)[0]).map(([key, value]) => [key, Number(value)]));
  const history = async (player) => ({
    claims: await sql`SELECT level,claimed_at::text FROM season_claims WHERE user_id=${player.userId} ORDER BY level`,
    cosmetics: await sql`SELECT cosmetic_id,source,acquired_at::text,expires_at::text FROM user_cosmetics WHERE user_id=${player.userId} ORDER BY cosmetic_id,acquired_at`,
  });
  async function fixture(startingPoints = 777) {
    const telegramId = sequence++;
    const [user] = await sql`INSERT INTO users(telegram_id,first_name) VALUES(${telegramId},'Season balance test') RETURNING id`;
    const player = { userId: user.id, telegramId };
    players.push(player);
    await sql`INSERT INTO game_states(user_id,hq_level,ore,energy,parts,credits,crystals,last_tick_at) VALUES(${user.id},2,1000,1000,100,10000,20,now()+interval '1 day')`;
    await sql`INSERT INTO player_stats(user_id) VALUES(${user.id})`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${user.id},'integration_test')`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${user.id},'hq',2,2,2,'active'),(${user.id},'trade_hub',1,0,0,'active'),(${user.id},'foundry',1,1,0,'active')`;
    await sql`INSERT INTO user_research(user_id,research_key,status,completes_at,completed_at) VALUES(${user.id},'trade_network','completed',now()-interval '1 minute',now()-interval '1 minute')`;
    const session = await post(player, '/api/session');
    assert.equal(session.status, 200, JSON.stringify(session.data));
    assert.ok(session.data.season, 'Only run in the isolated CI database with its active seeded season');
    await sql`UPDATE season_progress SET points=${startingPoints} WHERE user_id=${user.id} AND season_id='s1_first_signal'`;
    await sql`INSERT INTO season_claims(user_id,season_id,level) VALUES(${user.id},'s1_first_signal',1)`;
    await sql`INSERT INTO user_cosmetics(user_id,cosmetic_id,source,expires_at) VALUES(${user.id},'theme_neon','balance_existing_ownership',NULL)`;
    return player;
  }
  async function order(player) {
    const created = await post(player, '/api/market/order/create', { resource: 'ore', amount: 50, unitPrice: 1 });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    return (await sql`SELECT id FROM market_orders WHERE user_id=${player.userId} AND status='open' ORDER BY created_at DESC LIMIT 1`)[0].id;
  }
  try {
    await t.test('market listing cancellation and one-credit trades retain history and trade milestones without minting SP', async () => {
      const seller = await fixture(777), buyer = await fixture(1200);
      await sql`UPDATE player_stats SET market_trades_bought=24 WHERE user_id IN (${seller.userId},${buyer.userId})`;
      const oldSeller = await history(seller), oldBuyer = await history(buyer);
      const beforeSeller = await wallet(seller), beforeBuyer = await wallet(buyer);
      for (let cycle = 0; cycle < 3; cycle++) {
        const id = await order(seller);
        assert.equal(await points(seller), 777);
        const cancelled = await post(seller, '/api/market/order/cancel', { orderId: id });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
        assert.equal(await points(seller), 777);
      }
      assert.deepEqual(await wallet(seller), beforeSeller, 'Listing and cancellation still return the original stock without a new fee');
      for (const [source, target] of [[seller, buyer], [buyer, seller]]) {
        const id = await order(source);
        const bought = await post(target, '/api/market/order/buy', { orderId: id, amount: 1 });
        assert.equal(bought.status, 200, JSON.stringify(bought.data));
        const [trade] = await sql`SELECT amount,unit_price,fee_credits FROM market_trades WHERE order_id=${id}`;
        assert.deepEqual(Object.fromEntries(Object.entries(trade).map(([key, value]) => [key, Number(value)])), { amount: 1, unit_price: 1, fee_credits: 1 });
        assert.equal((await post(source, '/api/market/order/cancel', { orderId: id })).status, 200);
        assert.equal(await points(seller), 777);
        assert.equal(await points(buyer), 1200);
      }
      assert.deepEqual(await wallet(seller), { ...beforeSeller, credits: beforeSeller.credits - 1 });
      assert.deepEqual(await wallet(buyer), { ...beforeBuyer, credits: beforeBuyer.credits - 1 });
      for (const player of [seller, buyer]) {
        const [stats] = await sql`SELECT market_orders_created,market_trades_bought,market_trades_sold FROM player_stats WHERE user_id=${player.userId}`;
        assert.equal(Number(stats.market_orders_created), player === seller ? 4 : 1);
        assert.equal(Number(stats.market_trades_bought), 25);
        assert.equal(Number(stats.market_trades_sold), 1);
        assert.equal((await sql`SELECT achievement_key FROM user_achievements WHERE user_id=${player.userId} AND achievement_key='market_25'`).length, 1);
      }
      assert.deepEqual(await history(seller), oldSeller);
      assert.deepEqual(await history(buyer), oldBuyer);
    });

    await t.test('paid foundry cycles and completed contracts still add exact SP once alongside their resource and quest progress', async () => {
      const player = await fixture(321);
      const before = await wallet(player), oldHistory = await history(player);
      const [foundry] = await sql`SELECT id FROM buildings WHERE user_id=${player.userId} AND type='foundry'`;
      const body = { buildingId: foundry.id, requestId: crypto.randomUUID(), cycles: 2 };
      const started = await post(player, '/api/game/foundry/start', body);
      assert.equal(started.status, 200, JSON.stringify(started.data));
      assert.equal(await points(player), 327);
      assert.deepEqual(await wallet(player), { ...before, ore: before.ore - 200, energy: before.energy - 80 });
      assert.equal((await post(player, '/api/game/foundry/start', body)).status, 200);
      assert.equal(await points(player), 327, 'The same foundry receipt cannot mint repeat SP');
      const [contract] = await sql`SELECT id,resource,amount,credit_reward FROM npc_contracts WHERE user_id=${player.userId} AND resource='ore' AND completed_at IS NULL ORDER BY created_at,id LIMIT 1`;
      assert.ok(contract);
      const completed = await post(player, '/api/game/contracts/complete', { contractId: contract.id });
      assert.equal(completed.status, 200, JSON.stringify(completed.data));
      assert.equal(await points(player), 337);
      const settled = await wallet(player);
      assert.equal(settled.ore, before.ore - 200 - Number(contract.amount));
      assert.equal(settled.credits, before.credits + Number(contract.credit_reward));
      assert.equal((await post(player, '/api/game/contracts/complete', { contractId: contract.id })).status, 200);
      assert.equal(await points(player), 337);
      assert.deepEqual(await wallet(player), settled);
      const [stats] = await sql`SELECT foundry_jobs_started,contracts_completed FROM player_stats WHERE user_id=${player.userId}`;
      assert.equal(Number(stats.foundry_jobs_started), 2);
      assert.equal(Number(stats.contracts_completed), 1);
      assert.equal(Number((await sql`SELECT progress FROM daily_quests WHERE user_id=${player.userId} AND quest_key='daily_smelt' AND quest_date=CURRENT_DATE`)[0].progress), 2);
      assert.deepEqual(await history(player), oldHistory);
    });

    await t.test('the retained builder achievement unlocks at 500 paid building actions without resetting old claims or permanent ownership', async () => {
      const player = await fixture(137);
      await sql`UPDATE player_stats SET buildings_started=499 WHERE user_id=${player.userId}`;
      await sql`INSERT INTO user_achievements(user_id,achievement_key,claimed_at) VALUES(${player.userId},'builder_10',now()),(${player.userId},'builder_100',now())`;
      const oldHistory = await history(player);
      const oldClaims = await sql`SELECT achievement_key,claimed_at::text FROM user_achievements WHERE user_id=${player.userId} AND achievement_key IN ('builder_10','builder_100') ORDER BY achievement_key`;
      const before = await post(player, '/api/session');
      assert.equal(before.status, 200, JSON.stringify(before.data));
      assert.equal(before.data.achievements.some(row => row.achievement_key === 'builder_10000'), false);
      const [foundry] = await sql`SELECT id FROM buildings WHERE user_id=${player.userId} AND type='foundry'`;
      const upgraded = await post(player, '/api/game/building/upgrade', { buildingId: foundry.id });
      assert.equal(upgraded.status, 200, JSON.stringify(upgraded.data));
      assert.equal(await points(player), 142);
      assert.equal(Number((await sql`SELECT buildings_started FROM player_stats WHERE user_id=${player.userId}`)[0].buildings_started), 500);
      assert.equal(upgraded.data.achievements.some(row => row.achievement_key === 'builder_10000' && !row.claimed_at), true);
      assert.equal(Number((await sql`SELECT progress FROM daily_quests WHERE user_id=${player.userId} AND quest_key='daily_build' AND quest_date=CURRENT_DATE`)[0].progress), 1);
      const claim = await post(player, '/api/game/achievements/claim', { achievementKey: 'builder_10000' });
      assert.equal(claim.status, 200, JSON.stringify(claim.data));
      assert.ok((await sql`SELECT claimed_at FROM user_achievements WHERE user_id=${player.userId} AND achievement_key='builder_10000'`)[0].claimed_at);
      assert.deepEqual(await sql`SELECT achievement_key,claimed_at::text FROM user_achievements WHERE user_id=${player.userId} AND achievement_key IN ('builder_10','builder_100') ORDER BY achievement_key`, oldClaims);
      assert.deepEqual(await history(player), oldHistory, 'Existing permanent cosmetics retain their receipt and are not shortened or duplicated');
    });
  } finally {
    if (players.length) {
      const userIds = players.map(player => player.userId);
      await sql`DELETE FROM market_trades WHERE buyer_user_id=ANY(${sql.array(userIds)}::uuid[]) OR seller_user_id=ANY(${sql.array(userIds)}::uuid[])`;
      await sql`DELETE FROM users WHERE id=ANY(${sql.array(userIds)}::uuid[])`;
    }
  }
}
