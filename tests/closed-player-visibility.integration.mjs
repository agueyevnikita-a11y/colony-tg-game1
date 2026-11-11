import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ACTIVE_SEASON_ID } from '../lib/game/season.ts';

/** Actual signed API visibility checks, only inside the isolated launch harness. */
export async function runClosedPlayerVisibilityIntegration({ t, sql, request, initData, playerId, privacy }) {
  const database = new URL(process.env.DATABASE_URL || '');
  assert.equal(process.env.COLONY_TEST_DATABASE, '1');
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(database.hostname));
  assert.match(database.pathname, /^\/colony_(ci|test)$/);
  assert.equal(process.env.ACCOUNT_CLOSURE_DIR, privacy.directory);
  assert.equal(process.env.ACCOUNT_ERASURE_SECRET === privacy.secret, true);
  const ids = [], userIds = [], allianceIds = [], operationIds = [];
  let sequence = playerId + 62_000;
  const settings = await sql`SELECT setting_key,value FROM system_settings WHERE setting_key IN ('maintenance','beta_required')`;
  const post = (player, endpoint, body = {}) => request(endpoint,{method:'POST',auth:initData(player.telegramId),body});
  const session = async player => {
    const reply = await post(player,'/api/session');
    assert.equal(reply.status,200,JSON.stringify(reply.data));
    assert.equal(reply.data.limited,undefined);
    return reply.data;
  };
  const balance = async player => JSON.parse(JSON.stringify((await sql`SELECT ore,energy,parts,credits,crystals,science FROM game_states WHERE user_id=${player.userId}`)[0]));
  async function player(name, telegramId = sequence++) {
    if(!ids.includes(telegramId))ids.push(telegramId);
    const [row]=await sql`INSERT INTO users(telegram_id,first_name,colony_name,profile_bio,profile_completed_at)
      VALUES(${telegramId},'Synthetic visibility',${name},'PRIVATE_CLOSURE_PROFILE',now()) RETURNING id`;
    userIds.push(row.id);
    await sql`INSERT INTO game_states(user_id,hq_level,ore,energy,parts,credits,science,crystals,last_tick_at)
      VALUES(${row.id},4,100,10000,1000,20000,1000,100,now()+interval '1 day')`;
    await sql`INSERT INTO player_stats(user_id) VALUES(${row.id})`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status)
      VALUES(${row.id},'hq',4,2,2,'active'),(${row.id},'trade_hub',1,3,3,'active'),(${row.id},'warehouse',1,4,4,'active')`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${row.id},'integration_test')`;
    return {userId:row.id,telegramId,name};
  }
  async function close(player) {
    const reply=await post(player,'/api/account/closure/request',{confirmation:'ЗАКРЫТЬ АККАУНТ'});
    assert.equal(reply.status,200,JSON.stringify(reply.data));
    assert.equal(reply.data.request.status,'requested');
    return reply.data.request;
  }
  function noIdentity(value, players) {
    const text=JSON.stringify(value);
    for(const player of players)for(const secret of [player.userId,player.name,String(player.telegramId)])assert.equal(text.includes(secret),false,`Hidden identity leaked in public DTO`);
  }
  let viewer, friend, inviter, order, alliance, operation, ownerRequest, inviterRequest, baseline;
  try {
    for(const setting of settings)await sql`UPDATE system_settings SET value=${sql.json({...setting.value,enabled:false})} WHERE setting_key=${setting.setting_key}`;
    viewer=await player('VISIBLE_OBSERVER');
    friend=await player('CLOSED_GUILD_OWNER');
    inviter=await player('CLOSED_INVITER');
    await sql`UPDATE users SET referred_by=${viewer.userId},referral_qualified_at=now() WHERE id=${friend.userId}`;
    await sql`UPDATE users SET referred_by=${inviter.userId},referral_qualified_at=now() WHERE id=${viewer.userId}`;
    await sql`INSERT INTO referral_bonus_claims(user_id,invited_user_id,credit_reward,crystal_reward)
      VALUES(${viewer.userId},${friend.userId},250,2)`;
    [order]=await sql`INSERT INTO market_orders(user_id,resource,amount_total,amount_remaining,unit_price,expires_at)
      VALUES(${friend.userId},'ore',100,100,2,now()+interval '1 day') RETURNING id`;
    [alliance]=await sql`INSERT INTO alliances(code,name,owner_user_id) VALUES(${`VC${friend.telegramId}`},'Visibility test guild',${friend.userId}) RETURNING id`;
    allianceIds.push(alliance.id);
    await sql`INSERT INTO alliance_members(user_id,alliance_id,role) VALUES(${friend.userId},${alliance.id},'owner'),(${viewer.userId},${alliance.id},'member')`;
    await sql`INSERT INTO season_progress(user_id,season_id,points) VALUES(${friend.userId},${ACTIVE_SEASON_ID},100000),(${viewer.userId},${ACTIVE_SEASON_ID},90000)`;
    [operation]=await sql`INSERT INTO alliance_cooperation_operations(alliance_id,alliance_name,started_at,ends_at)
      VALUES(${alliance.id},'Visibility test guild',now()-interval '1 minute',now()+interval '1 hour') RETURNING id`;
    operationIds.push(operation.id);
    await sql`INSERT INTO alliance_cooperation_contributions(operation_id,user_id,role,cost_json,reward_json)
      VALUES(${operation.id},${friend.userId},'power','{"energy":100}'::jsonb,'{"ore":10,"credits":10,"science":1}'::jsonb),
      (${operation.id},${viewer.userId},'analysis','{"science":1}'::jsonb,'{"ore":10,"credits":10,"science":1}'::jsonb)`;
    const initial=await session(viewer);
    const periodId=initial.alliance.competition.period.id;
    await sql`INSERT INTO alliance_competition_entries(source_id,period_id,user_id,alliance_id,alliance_name,points)
      VALUES(${crypto.randomUUID()},${periodId},${friend.userId},${alliance.id},'Visibility test guild',10),
      (${crypto.randomUUID()},${periodId},${viewer.userId},${alliance.id},'Visibility test guild',10)`;
    baseline=await session(viewer);

    await t.test('open profiles and contractual game history are visible before closure',async()=>{
      for(const body of [{userId:friend.userId},{telegramId:friend.telegramId}]){
        const reply=await post(viewer,'/api/social/city',body);
        assert.equal(reply.status,200,JSON.stringify(reply.data));assert.equal(reply.data.city.id,friend.userId);
      }
      assert.ok(baseline.market.orders.some(item=>item.id===order.id));
      assert.ok(baseline.alliance.alliance.members.some(item=>item.user_id===friend.userId));
      assert.ok(baseline.alliance.cooperation.current.team.some(item=>item.name===friend.name));
      assert.ok(baseline.alliance.competition.players.some(item=>item.userId===friend.userId));
      assert.ok(baseline.referralProgram.friends.some(item=>item.userId===friend.userId));
      assert.equal(baseline.referralProgram.invitedBy.name,inviter.name);
      ownerRequest=await close(friend);inviterRequest=await close(inviter);
    });

    await t.test('closed city UUID and legacy Telegram links do not publish profile or city data',async()=>{
      for(const body of [{userId:friend.userId},{telegramId:friend.telegramId}]){
        const reply=await post(viewer,'/api/social/city',body);
        assert.equal(reply.data.ok,false);assert.equal(reply.status,400);
        assert.equal(reply.data.city,undefined);assert.equal(JSON.stringify(reply.data).includes('PRIVATE_CLOSURE_PROFILE'),false);
      }
    });

    await t.test('closed market orders are hidden and a saved order ID cannot charge the other player',async()=>{
      const game=await session(viewer);assert.equal(game.market.orders.some(item=>item.id===order.id),false);
      const beforeBuyer=await balance(viewer),beforeSeller=await balance(friend);
      const beforeOrder=JSON.parse(JSON.stringify((await sql`SELECT * FROM market_orders WHERE id=${order.id}`)[0]));
      const beforeTrades=Number((await sql`SELECT count(*) AS n FROM market_trades WHERE order_id=${order.id}`)[0].n);
      const reply=await post(viewer,'/api/market/order/buy',{orderId:order.id,amount:1});
      assert.equal(reply.status,400);assert.equal(reply.data.ok,false);
      assert.deepEqual(await balance(viewer),beforeBuyer);assert.deepEqual(await balance(friend),beforeSeller);
      assert.deepEqual(JSON.parse(JSON.stringify((await sql`SELECT * FROM market_orders WHERE id=${order.id}`)[0])),beforeOrder);
      assert.equal(Number((await sql`SELECT count(*) AS n FROM market_trades WHERE order_id=${order.id}`)[0].n),beforeTrades);
    });

    await t.test('closed guild and league identities disappear while common bonuses, ranks and receipts stay intact',async()=>{
      const game=await session(viewer);
      const guild=game.alliance.alliance;
      noIdentity({members:guild.members,season:game.alliance.playerLeaderboard,weekly:game.alliance.competition.players,team:game.alliance.cooperation.current.team},[friend,inviter]);
      assert.equal(game.alliance.membership.owner_user_id,null);
      assert.equal(guild.memberCount,2);assert.equal(guild.hiddenMemberCount,1);
      assert.equal(guild.seasonPoints,baseline.alliance.alliance.seasonPoints);
      assert.equal(game.alliance.cooperation.current.participants,baseline.alliance.cooperation.current.participants);
      assert.equal(game.alliance.cooperation.current.teamBonusPercent,baseline.alliance.cooperation.current.teamBonusPercent);
      assert.deepEqual(game.alliance.cooperation.current.roles,baseline.alliance.cooperation.current.roles);
      assert.deepEqual(game.alliance.cooperation.current.myReward,baseline.alliance.cooperation.current.myReward);
      assert.deepEqual(game.alliance.competition.me,baseline.alliance.competition.me);
      const myPrior=baseline.alliance.competition.players.find(item=>item.userId===viewer.userId);
      assert.deepEqual(game.alliance.competition.players.find(item=>item.userId===viewer.userId),myPrior);
      assert.equal(Number((await sql`SELECT count(*) AS n FROM alliance_cooperation_contributions WHERE operation_id=${operation.id}`)[0].n),2);
    });

    await t.test('referral cards redact closed people without cancelling totals, pending rights or paid receipts',async()=>{
      const game=await session(viewer);
      noIdentity({friends:game.referralProgram.friends,referrals:game.referrals,invitedBy:game.referralProgram.invitedBy},[friend,inviter]);
      assert.equal(game.referralProgram.invitedBy.name,'Закрытая колония');
      for(const key of ['totalInvited','qualifiedInvited','pendingCount','pendingReward','receivedCount','receivedReward'])assert.deepEqual(game.referralProgram[key],baseline.referralProgram[key],key);
      const receipt=await sql`SELECT credit_reward,crystal_reward FROM referral_bonus_claims WHERE user_id=${viewer.userId} AND invited_user_id=${friend.userId}`;
      assert.deepEqual(receipt.map(item=>({credits:Number(item.credit_reward),crystals:Number(item.crystal_reward)})),[{credits:250,crystals:2}]);
    });

    await t.test('an explicit cancellation restores profile, order and guild-card visibility',async()=>{
      const reply=await post(friend,'/api/account/closure/cancel',{requestId:ownerRequest.id,confirmation:'ОТОЗВАТЬ ЗАПРОС'});
      assert.equal(reply.status,200,JSON.stringify(reply.data));assert.equal(reply.data.request.status,'cancelled');
      assert.equal((await post(viewer,'/api/social/city',{userId:friend.userId})).data.city.id,friend.userId);
      const game=await session(viewer);
      assert.ok(game.market.orders.some(item=>item.id===order.id));
      assert.ok(game.alliance.alliance.members.some(item=>item.user_id===friend.userId));
      assert.ok(game.alliance.cooperation.current.team.some(item=>item.name===friend.name));
      assert.ok(game.referralProgram.friends.some(item=>item.userId===friend.userId));
      assert.equal(game.alliance.membership.owner_user_id,friend.userId);
      assert.equal(game.referralProgram.invitedBy.name,'Закрытая колония');
    });

    await t.test('a restored database UUID for the same closed Telegram identity stays private',async()=>{
      const restored=await player('RESTORED_PRIVATE_CITY');const oldId=restored.userId;
      await close(restored);await sql`DELETE FROM users WHERE id=${oldId}`;
      const replacement=await player('RESTORED_REPLACEMENT_CITY',restored.telegramId);
      assert.notEqual(replacement.userId,oldId);
      for(const body of [{userId:replacement.userId},{telegramId:replacement.telegramId}]){
        const reply=await post(viewer,'/api/social/city',body);assert.equal(reply.status,400);assert.equal(reply.data.ok,false);assert.equal(reply.data.city,undefined);
      }
      const [restoredOrder]=await sql`INSERT INTO market_orders(user_id,resource,amount_total,amount_remaining,unit_price,expires_at)
        VALUES(${replacement.userId},'ore',10,10,2,now()+interval '1 day') RETURNING id`;
      assert.equal((await session(viewer)).market.orders.some(item=>item.id===restoredOrder.id),false);
      const closedReply=await post(replacement,'/api/session');assert.equal(closedReply.data.closed,true);assert.equal(closedReply.data.userId,null);
    });

    await t.test('an unavailable privacy index fails closed without publishing cached identities',async()=>{
      const filename=path.join(privacy.directory,'meta.json');const previous=await fs.readFile(filename);
      try{
        await fs.writeFile(filename,'{"invalid":"synthetic"}\n');
        const reply=await post(viewer,'/api/social/city',{userId:friend.userId});
        assert.equal(reply.data.ok,false);assert.equal(reply.data.city,undefined);
        assert.equal(JSON.stringify(reply.data).includes(friend.name),false);
        assert.equal(JSON.stringify(reply.data).includes(privacy.secret),false);
        const ready=await request('/api/ready');assert.equal(ready.status,503);
      } finally {await fs.writeFile(filename,previous);}
    });
  } finally {
    for(const setting of settings)await sql`UPDATE system_settings SET value=${sql.json(setting.value)} WHERE setting_key=${setting.setting_key}`;
    if(userIds.length){
      await sql`UPDATE users SET referred_by=NULL WHERE id=ANY(${sql.array(userIds)}::uuid[]) OR referred_by=ANY(${sql.array(userIds)}::uuid[])`;
      await sql`DELETE FROM alliance_competition_standings WHERE kind='personal' AND entity_id=ANY(${sql.array(userIds)}::uuid[])`;
      await sql`DELETE FROM analytics_events WHERE user_id=ANY(${sql.array(userIds)}::uuid[])`;
      await sql`DELETE FROM error_events WHERE user_id=ANY(${sql.array(userIds)}::uuid[])`;
    }
    if(allianceIds.length)await sql`DELETE FROM alliances WHERE id=ANY(${sql.array(allianceIds)}::uuid[])`;
    if(operationIds.length)await sql`DELETE FROM alliance_cooperation_operations WHERE id=ANY(${sql.array(operationIds)}::uuid[])`;
    if(ids.length)await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(ids)}::bigint[])`;
    // Case/index/journal files intentionally remain consistent until parent teardown.
    void inviterRequest;
  }
}
