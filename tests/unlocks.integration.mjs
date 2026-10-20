import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function runUnlocksIntegration({ t, sql, request, initData, playerId }) {
  const ids = [];
  let sequence = playerId + 4000;
  const post = (player, path, body) => request(path, { method: 'POST', auth: initData(player.telegramId), body });
  const session = async (player) => {
    const response = await post(player, '/api/session');
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  const resources = async (player) => Object.fromEntries(Object.entries((await sql`
    SELECT ore,energy,parts,credits,science,crystals FROM game_states WHERE user_id=${player.userId}
  `)[0]).map(([key, value]) => [key, Number(value)]));
  async function player({ hq = 3, hub = false, center = false } = {}) {
    const telegramId = sequence++;
    ids.push(telegramId);
    const [user] = await sql`INSERT INTO users(telegram_id,first_name) VALUES(${telegramId},'Feature access test') RETURNING id`;
    await sql`
      INSERT INTO game_states(user_id,hq_level,ore,energy,parts,credits,science,crystals,last_tick_at)
      VALUES(${user.id},${hq},1000,1000,100,10000,0,0,now()+interval '1 day')
    `;
    await sql`INSERT INTO player_stats(user_id) VALUES(${user.id})`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${user.id},'integration_test')`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${user.id},'hq',${hq},2,2,'active')`;
    if (hub) await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${user.id},'trade_hub',1,0,0,'active')`;
    if (center) await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${user.id},'expedition_center',1,1,0,'active')`;
    return { userId: user.id, telegramId };
  }
  async function research(player, key, status = 'completed') {
    await sql`
      INSERT INTO user_research(user_id,research_key,status,completes_at,completed_at)
      VALUES(${player.userId},${key},${status},${status === 'completed' ? new Date(Date.now()-1000) : new Date(Date.now()+86_400_000)},${status === 'completed' ? new Date(Date.now()-1000) : null})
      ON CONFLICT(user_id,research_key) DO UPDATE SET status=EXCLUDED.status,completes_at=EXCLUDED.completes_at,completed_at=EXCLUDED.completed_at
    `;
  }

  try {
    await t.test('an active trading hub alone cannot create or buy orders; completed trade research unlocks both', async () => {
      const seller = await player({ hq: 2, hub: true });
      const buyer = await player({ hq: 2, hub: true });
      const before = await resources(seller);
      const locked = await session(seller);
      assert.equal(locked.unlocks.market.unlocked, false);
      assert.equal(locked.unlocks.market.legacy, false);
      const blocked = await post(seller, '/api/market/order/create', { resource: 'ore', amount: 100, unitPrice: 2 });
      assert.equal(blocked.status, 400, JSON.stringify(blocked.data));
      assert.match(blocked.data.error, /Межколониальная торговля/);
      assert.deepEqual(await resources(seller), before);
      assert.equal(Number((await sql`SELECT count(*) AS count FROM market_orders WHERE user_id=${seller.userId}`)[0].count), 0);
      await research(seller, 'trade_network', 'researching');
      assert.equal((await post(seller, '/api/market/order/create', { resource: 'ore', amount: 100, unitPrice: 2 })).status, 400);
      await sql`UPDATE user_research SET completes_at=now()-interval '1 second' WHERE user_id=${seller.userId} AND research_key='trade_network'`;
      const opened = await session(seller);
      assert.equal(opened.unlocks.market.unlocked, true);
      const created = await post(seller, '/api/market/order/create', { resource: 'ore', amount: 100, unitPrice: 2 });
      assert.equal(created.status, 200, JSON.stringify(created.data));
      const [order] = await sql`SELECT id,amount_remaining FROM market_orders WHERE user_id=${seller.userId} AND status='open'`;
      assert.ok(order);
      const buyerBefore = await resources(buyer);
      const sellerBeforeTrade = await resources(seller);
      const rejectedBuy = await post(buyer, '/api/market/order/buy', { orderId: order.id, amount: 25 });
      assert.equal(rejectedBuy.status, 400, JSON.stringify(rejectedBuy.data));
      assert.match(rejectedBuy.data.error, /Межколониальная торговля/);
      assert.deepEqual(await resources(buyer), buyerBefore);
      assert.deepEqual(await resources(seller), sellerBeforeTrade);
      assert.equal(Number((await sql`SELECT amount_remaining FROM market_orders WHERE id=${order.id}`)[0].amount_remaining), 100);
      await research(buyer, 'trade_network');
      const bought = await post(buyer, '/api/market/order/buy', { orderId: order.id, amount: 25 });
      assert.equal(bought.status, 200, JSON.stringify(bought.data));
      assert.deepEqual(await resources(buyer), { ...buyerBefore, ore: buyerBefore.ore+25, credits: buyerBefore.credits-50 });
      assert.deepEqual(await resources(seller), { ...sellerBeforeTrade, credits: sellerBeforeTrade.credits+48 });
    });

    await t.test('an existing market order can still be cancelled after the technology gate closes', async () => {
      const owner = await player({ hq: 2, hub: true });
      await research(owner, 'trade_network');
      const before = await resources(owner);
      assert.equal((await post(owner, '/api/market/order/create', { resource: 'ore', amount: 100, unitPrice: 2 })).status, 200);
      const [order] = await sql`SELECT id FROM market_orders WHERE user_id=${owner.userId} AND status='open'`;
      await sql`DELETE FROM user_research WHERE user_id=${owner.userId} AND research_key='trade_network'`;
      assert.equal((await session(owner)).unlocks.market.unlocked, false);
      const cancelled = await post(owner, '/api/market/order/cancel', { orderId: order.id });
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
      assert.deepEqual(await resources(owner), before);
      assert.equal((await sql`SELECT status FROM market_orders WHERE id=${order.id}`)[0].status, 'cancelled');
    });

    await t.test('HQ3 and an active expedition center still require completed expedition protocols before charging a launch', async () => {
      const explorer = await player({ center: true });
      const before = await resources(explorer);
      const blocked = await post(explorer, '/api/game/expedition/start', { expeditionKey: 'local_survey' });
      assert.equal(blocked.status, 400, JSON.stringify(blocked.data));
      assert.match(blocked.data.error, /Экспедиционные протоколы/);
      assert.deepEqual(await resources(explorer), before);
      assert.equal(Number((await sql`SELECT count(*) AS count FROM expeditions WHERE user_id=${explorer.userId}`)[0].count), 0);
      await research(explorer, 'expedition_protocols', 'researching');
      assert.equal((await post(explorer, '/api/game/expedition/start', { expeditionKey: 'local_survey' })).status, 400);
      await research(explorer, 'expedition_protocols');
      const launched = await post(explorer, '/api/game/expedition/start', { expeditionKey: 'local_survey' });
      assert.equal(launched.status, 200, JSON.stringify(launched.data));
      assert.equal(launched.data.unlocks.expeditions.unlocked, true);
      assert.deepEqual(await resources(explorer), { ...before, energy: before.energy-150 });
    });

    await t.test('paid expeditions and their events can be collected and retried even when further launches are locked', async () => {
      for (const eventKey of [null, 'distress_beacon']) {
        const explorer = await player({ center: true });
        await research(explorer, 'expedition_protocols');
        const launched = await post(explorer, '/api/game/expedition/start', { expeditionKey: 'local_survey' });
        assert.equal(launched.status, 200, JSON.stringify(launched.data));
        const runId = launched.data.result.id;
        await sql`DELETE FROM user_research WHERE user_id=${explorer.userId} AND research_key='expedition_protocols'`;
        await sql`
          UPDATE expeditions SET completes_at=now()-interval '1 second',event_key=${eventKey},artifact_id=NULL,
            reward_json='{"ore":80,"credits":120,"science":5,"crystals":2}'::jsonb
          WHERE id=${runId}
        `;
        const before = await resources(explorer);
        const body = { expeditionId: runId, ...(eventKey ? { choiceId: 'salvage' } : {}) };
        const collected = await post(explorer, '/api/game/expedition/resolve', body);
        assert.equal(collected.status, 200, JSON.stringify(collected.data));
        assert.equal(collected.data.unlocks.expeditions.unlocked, false);
        const expected = { ...before, ore: before.ore+80, credits: before.credits+120+(eventKey ? 450 : 0), science: before.science+5, crystals: before.crystals+2 };
        assert.deepEqual(await resources(explorer), expected);
        const retry = await post(explorer, '/api/game/expedition/resolve', body);
        assert.equal(retry.status, 200, JSON.stringify(retry.data));
        assert.deepEqual(retry.data.result, collected.data.result);
        assert.deepEqual(await resources(explorer), expected);
        assert.equal((await sql`SELECT status FROM expeditions WHERE id=${runId}`)[0].status, 'claimed');
      }
    });

    await t.test('legacy grants preserve established features without bypassing the active building requirement', async () => {
      const retained = await player();
      await sql`INSERT INTO colony_feature_access(user_id,feature_key) VALUES(${retained.userId},'market'),(${retained.userId},'expeditions')`;
      const game = await session(retained);
      assert.equal(game.unlocks.market.unlocked, true);
      assert.equal(game.unlocks.market.legacy, true);
      assert.equal(game.unlocks.expeditions.unlocked, true);
      assert.equal(game.unlocks.expeditions.legacy, true);
      assert.deepEqual(game.research.completed, []);
      const before = await resources(retained);
      assert.equal((await post(retained, '/api/market/order/create', { resource: 'ore', amount: 100, unitPrice: 2 })).status, 400);
      assert.equal((await post(retained, '/api/game/expedition/start', { expeditionKey: 'local_survey' })).status, 400);
      assert.deepEqual(await resources(retained), before);
      await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${retained.userId},'trade_hub',1,0,0,'active'),(${retained.userId},'expedition_center',1,1,0,'active')`;
      assert.equal((await post(retained, '/api/market/order/create', { resource: 'ore', amount: 100, unitPrice: 2 })).status, 200);
      assert.equal((await post(retained, '/api/game/expedition/start', { expeditionKey: 'local_survey' })).status, 200);
      assert.deepEqual(await resources(retained), { ...before, ore: before.ore-100, energy: before.energy-150 });
    });

    await t.test('the one-time migration retains historical hubs and paid activity but never grants a later colony on rerun', async () => {
      const migration = await readFile(new URL('../db/migrations/014_v1_10_colony_identity.sql', import.meta.url), 'utf8');
      const oldHub = crypto.randomUUID(), oldActivity = crypto.randomUUID(), laterHub = crypto.randomUUID();
      await sql.begin(async (tx) => {
        // All unqualified relation names in the complete migration resolve to
        // transaction-local shadows, including its one-time backfill marker.
        await tx`CREATE TEMP TABLE users(id UUID PRIMARY KEY) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE player_stats(user_id UUID PRIMARY KEY) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE city_decor(user_id UUID,type TEXT) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE referral_bonus_claims(user_id UUID,invited_user_id UUID,credit_reward INT,crystal_reward INT,created_at TIMESTAMPTZ,PRIMARY KEY(user_id,invited_user_id)) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE colony_feature_access(user_id UUID,feature_key TEXT,source TEXT DEFAULT 'legacy_v1_10',created_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(user_id,feature_key)) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE colony_migrations(migration_key TEXT PRIMARY KEY,applied_at TIMESTAMPTZ DEFAULT now()) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE buildings(user_id UUID,type TEXT) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE market_orders(user_id UUID) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE expeditions(user_id UUID) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE cosmetics(id TEXT PRIMARY KEY,name TEXT,category TEXT,achievement_key TEXT,metadata JSONB) ON COMMIT DROP`;
        await tx`INSERT INTO buildings(user_id,type) VALUES(${oldHub},'trade_hub'),(${oldHub},'expedition_center')`;
        await tx`INSERT INTO market_orders(user_id) VALUES(${oldActivity})`;
        await tx`INSERT INTO expeditions(user_id) VALUES(${oldActivity})`;
        await tx.unsafe(migration);
        const granted = await tx`SELECT user_id,feature_key FROM colony_feature_access ORDER BY user_id,feature_key`;
        assert.deepEqual(granted.map((row) => `${row.user_id}:${row.feature_key}`).sort(), [
          `${oldHub}:market`, `${oldHub}:expeditions`, `${oldActivity}:market`, `${oldActivity}:expeditions`,
        ].sort());
        await tx`INSERT INTO buildings(user_id,type) VALUES(${laterHub},'trade_hub'),(${laterHub},'expedition_center')`;
        await tx.unsafe(migration);
        assert.equal(Number((await tx`SELECT count(*) AS count FROM colony_feature_access WHERE user_id=${laterHub}`)[0].count), 0);
        assert.equal(Number((await tx`SELECT count(*) AS count FROM colony_feature_access`)[0].count), 4);
        assert.equal(Number((await tx`SELECT count(*) AS count FROM colony_migrations WHERE migration_key='v1_10_feature_access'`)[0].count), 1);
      });
    });
  } finally {
    if (ids.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(ids)}::bigint[])`;
  }
}
