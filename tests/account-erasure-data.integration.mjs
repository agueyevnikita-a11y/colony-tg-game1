import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { inspectAccountErasure, eraseAccountData, AccountErasureBlockedError } from '../scripts/privacy/lib/account-erasure-data.mjs';

const plain = value => JSON.parse(JSON.stringify(value));

/** The whole suite is restricted to the launch harness's isolated databases. */
export async function runAccountErasureDataIntegration({ t, sql }) {
  assert.equal(process.env.COLONY_TEST_DATABASE, '1');
  const database = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(database.hostname));
  assert.match(database.pathname,/^\/colony_(ci|test)$/);
  const rollback = new Error('Discard synthetic erasure fixtures');
  async function scenario(name, run) {
    await t.test(name,async () => {
      try {
        await sql.begin(async tx => { await run(tx); throw rollback; });
        assert.fail('Synthetic fixture transaction unexpectedly committed');
      } catch (error) { if (error !== rollback) throw error; }
    });
  }
  async function player(tx) {
    const suffix=crypto.randomBytes(10).toString('hex');
    const telegramId=crypto.randomInt(700_000_000_000,799_999_999_999);
    const [user]=await tx`INSERT INTO public.users(telegram_id,first_name,username,colony_name,profile_bio)
      VALUES(${telegramId},'Synthetic erasure fixture',${`erasure_${suffix}`},${`Colony_${suffix}`},${`Profile_${suffix}`}) RETURNING *`;
    await tx`INSERT INTO public.game_states(user_id,credits,crystals) VALUES(${user.id},12345,321)`;
    return { ...user, telegramId };
  }
  async function guild(tx,owner) {
    const [alliance]=await tx`INSERT INTO public.alliances(code,name,owner_user_id)
      VALUES(${crypto.randomBytes(8).toString('hex')},'Synthetic erasure guild',${owner.id}) RETURNING *`;
    await tx`INSERT INTO public.alliance_members(user_id,alliance_id,role) VALUES(${owner.id},${alliance.id},'owner')`;
    return alliance;
  }
  function hasBlock(plan,code) { assert.ok(plan.blockers.some(blocker=>blocker.code===code && blocker.count>0),code); }
  async function blocked(tx, user, code, admins=[]) {
    const before=plain((await tx`SELECT * FROM public.users WHERE id=${user.id}`)[0]);
    const plan=await inspectAccountErasure(tx,user.id,admins);
    hasBlock(plan,code);
    await assert.rejects(eraseAccountData(tx,user.id,admins),error=>error instanceof AccountErasureBlockedError && error.blockers.some(blocker=>blocker.code===code));
    assert.deepEqual(plain((await tx`SELECT * FROM public.users WHERE id=${user.id}`)[0]),before);
  }

  await scenario('erasure preview is read-only and purge clears own rows, detached references and exact rate keys without changing another balance',async tx=>{
    const target=await player(tx),other=await player(tx);
    await tx`UPDATE public.users SET referred_by=${target.id} WHERE id=${other.id}`;
    await tx`INSERT INTO public.player_feedback(user_id,message,context) VALUES(${target.id},'Own synthetic support message',${tx.json({user:target.id})})`;
    await tx`INSERT INTO public.analytics_events(user_id,event_name,payload) VALUES
      (${target.id},'own_erasure_fixture',${tx.json({telegram_id:target.telegramId})}),
      (${other.id},'qualified_referral',${tx.json({referral_user_id:target.id.toUpperCase()})}),
      (${other.id},'alliance_role_changed',${tx.json({target_user_id:String(target.telegramId)})}),
      (${other.id},'unrelated_fixture',${tx.json({amount:7})})`;
    await tx`INSERT INTO public.error_events(user_id,source,message,stack,context)
      VALUES(${target.id},'fixture',${target.username},${target.id},${tx.json({telegram_id:target.telegramId})})`;
    await tx`INSERT INTO public.notification_preferences(user_id) VALUES(${target.id})`;
    await tx`INSERT INTO public.notification_jobs(user_id,kind,dedupe_key,scheduled_at,payload)
      VALUES(${target.id},'building_ready','synthetic-erasure',now(),${tx.json({name:target.colony_name})})`;
    await tx`INSERT INTO public.account_ownership_proofs(user_id,token_hash,expires_at)
      VALUES(${target.id},${crypto.randomBytes(32).toString('hex')},now()+interval '1 day')`;
    await tx`INSERT INTO public.referral_bonus_claims(user_id,invited_user_id,credit_reward,crystal_reward) VALUES(${other.id},${target.id},10,1)`;
    const period=`erasure-${crypto.randomUUID()}`;
    await tx`INSERT INTO public.alliance_competition_periods(id,starts_at,ends_at,finalized_at) VALUES(${period},now()-interval '2 days',now()-interval '1 day',now())`;
    await tx`INSERT INTO public.alliance_competition_standings(period_id,kind,entity_id,name,points,rank)
      VALUES(${period},'personal',${target.id},${target.colony_name},10,1)`;
    const exactKeys=[`global:${target.id}`,`feedback:${target.id}`,`beta_redeem:${target.id}`,`payment_recovery:${target.id}`,
      `support-proof:issue:${target.id}:hour`,`support-proof:issue:${target.id}:day`,`support-proof:verify:${target.telegramId}`];
    const untouchedKey=`global:${target.id}_different`;
    for(const key of [...exactKeys,untouchedKey]) await tx`INSERT INTO public.api_rate_limits(bucket_key,window_started_at,request_count) VALUES(${key},now(),1)`;
    const before=plain({user:target,state:(await tx`SELECT * FROM public.game_states WHERE user_id=${other.id}`)[0]});
    const plan=await inspectAccountErasure(tx,target.id);
    assert.deepEqual(plan.blockers,[]);
    assert.equal(plan.counts.analytics_references,2);
    assert.equal(plan.counts.api_rate_limits,exactKeys.length);
    assert.equal(plan.counts.personal_competition_standings,1);
    assert.ok(plan.categories.includes('verification'));
    assert.equal((await tx`SELECT id FROM public.users WHERE id=${target.id}`).length,1);
    assert.deepEqual(plain((await tx`SELECT * FROM public.game_states WHERE user_id=${other.id}`)[0]),before.state);
    const erased=await eraseAccountData(tx,target.id);
    assert.deepEqual(erased,{counts:plan.counts,categories:plan.categories});
    for(const table of ['users','game_states','player_feedback','notification_jobs','notification_preferences','account_ownership_proofs']) {
      const column=table==='users'?'id':'user_id';
      assert.equal((await tx`SELECT 1 FROM ${tx(`public.${table}`)} WHERE ${tx(column)}=${target.id}`).length,0,table);
    }
    assert.equal((await tx`SELECT 1 FROM public.analytics_events WHERE user_id=${target.id} OR payload->>'referral_user_id'=${target.id.toUpperCase()} OR payload->>'target_user_id'=${String(target.telegramId)}`).length,0);
    assert.equal((await tx`SELECT 1 FROM public.error_events WHERE message=${target.username}`).length,0,'own error must be deleted rather than detached');
    assert.equal((await tx`SELECT 1 FROM public.analytics_events WHERE user_id=${other.id} AND event_name='unrelated_fixture'`).length,1);
    assert.equal((await tx`SELECT 1 FROM public.alliance_competition_standings WHERE entity_id=${target.id}`).length,0);
    assert.equal((await tx`SELECT 1 FROM public.api_rate_limits WHERE bucket_key=ANY(${tx.array(exactKeys)}::text[])`).length,0);
    assert.equal((await tx`SELECT 1 FROM public.api_rate_limits WHERE bucket_key=${untouchedKey}`).length,1);
    assert.equal((await tx`SELECT referred_by FROM public.users WHERE id=${other.id}`)[0].referred_by,null);
    assert.deepEqual(plain((await tx`SELECT * FROM public.game_states WHERE user_id=${other.id}`)[0]),before.state);
    assert.equal((await tx`SELECT 1 FROM public.referral_bonus_claims WHERE user_id=${other.id} AND invited_user_id=${target.id}`).length,0);
    assert.deepEqual(await eraseAccountData(tx,target.id),{counts:{users:0},categories:[]});
  });

  await scenario('administrator and any purchase record require manual review',async tx=>{
    const target=await player(tx);
    await blocked(tx,target,'ADMIN_ACCOUNT',[target.telegramId]);
    await tx`INSERT INTO public.purchases(user_id,product_id,stars_paid,invoice_payload,status)
      VALUES(${target.id},'synthetic-fixture',1,${crypto.randomUUID()},'created')`;
    await blocked(tx,target,'PURCHASE_RECORDS');
    assert.equal((await tx`SELECT 1 FROM public.purchases WHERE user_id=${target.id}`).length,1);
  });

  await scenario('market history blocks purge and preserves the counterparty balance, order and receipt',async tx=>{
    const target=await player(tx),other=await player(tx);
    const [order]=await tx`INSERT INTO public.market_orders(user_id,resource,amount_total,amount_remaining,unit_price,status)
      VALUES(${target.id},'ore',10,0,3,'filled') RETURNING id`;
    const [trade]=await tx`INSERT INTO public.market_trades(order_id,seller_user_id,buyer_user_id,resource,amount,unit_price)
      VALUES(${order.id},${target.id},${other.id},'ore',10,3) RETURNING id`;
    const state=plain((await tx`SELECT * FROM public.game_states WHERE user_id=${other.id}`)[0]);
    await blocked(tx,target,'MARKET_HISTORY');
    assert.equal((await tx`SELECT 1 FROM public.market_orders WHERE id=${order.id}`).length,1);
    assert.equal((await tx`SELECT 1 FROM public.market_trades WHERE id=${trade.id}`).length,1);
    assert.deepEqual(plain((await tx`SELECT * FROM public.game_states WHERE user_id=${other.id}`)[0]),state);
  });

  await scenario('owned guild with other members cannot be erased through an owner cascade',async tx=>{
    const target=await player(tx),other=await player(tx),alliance=await guild(tx,target);
    await tx`INSERT INTO public.alliance_members(user_id,alliance_id,role) VALUES(${other.id},${alliance.id},'member')`;
    await blocked(tx,target,'OWNED_ALLIANCE_MEMBERS');
    assert.equal((await tx`SELECT 1 FROM public.alliance_members WHERE alliance_id=${alliance.id}`).length,2);
  });

  await scenario('truly empty owned guild can close, while membership removal preserves another owner and guild',async tx=>{
    const target=await player(tx),alliance=await guild(tx,target);
    await tx`INSERT INTO public.alliance_projects(alliance_id,project_key) VALUES(${alliance.id},'synthetic-erasure')`;
    await eraseAccountData(tx,target.id);
    assert.equal((await tx`SELECT 1 FROM public.alliances WHERE id=${alliance.id}`).length,0);
    assert.equal((await tx`SELECT 1 FROM public.alliance_projects WHERE alliance_id=${alliance.id}`).length,0);
    const owner=await player(tx),member=await player(tx),shared=await guild(tx,owner);
    await tx`INSERT INTO public.alliance_members(user_id,alliance_id,role) VALUES(${member.id},${shared.id},'member')`;
    const state=plain((await tx`SELECT * FROM public.game_states WHERE user_id=${owner.id}`)[0]);
    await eraseAccountData(tx,member.id);
    assert.equal((await tx`SELECT 1 FROM public.alliances WHERE id=${shared.id} AND owner_user_id=${owner.id}`).length,1);
    assert.deepEqual(plain((await tx`SELECT * FROM public.game_states WHERE user_id=${owner.id}`)[0]),state);
  });

  await scenario('active shared cooperation and in-flight notification deliveries require review',async tx=>{
    const owner=await player(tx),target=await player(tx),alliance=await guild(tx,owner);
    await tx`INSERT INTO public.alliance_members(user_id,alliance_id,role) VALUES(${target.id},${alliance.id},'member')`;
    const [operation]=await tx`INSERT INTO public.alliance_cooperation_operations(alliance_id,alliance_name,ends_at)
      VALUES(${alliance.id},${alliance.name},now()+interval '1 hour') RETURNING id`;
    await tx`INSERT INTO public.alliance_cooperation_contributions(operation_id,user_id,role,cost_json,reward_json)
      VALUES(${operation.id},${target.id},'power','{}'::jsonb,'{}'::jsonb)`;
    await blocked(tx,target,'ACTIVE_COOPERATION');
    await tx`INSERT INTO public.notification_jobs(user_id,kind,dedupe_key,scheduled_at,processing_at)
      VALUES(${target.id},'building_ready','synthetic-processing',now(),now())`;
    await blocked(tx,target,'ACTIVE_NOTIFICATION_DELIVERY');
  });

  await scenario('former-member contributions and inconsistent owner roles are preserved for manual review',async tx=>{
    const target=await player(tx),former=await player(tx),alliance=await guild(tx,target);
    const [project]=await tx`INSERT INTO public.alliance_projects(alliance_id,project_key) VALUES(${alliance.id},'synthetic-history') RETURNING id`;
    await tx`INSERT INTO public.alliance_contributions(project_id,user_id,stage,resource,amount,points)
      VALUES(${project.id},${former.id},1,'ore',10,10)`;
    await blocked(tx,target,'OWNED_ALLIANCE_SHARED_HISTORY');
    assert.equal((await tx`SELECT 1 FROM public.alliance_contributions WHERE project_id=${project.id} AND user_id=${former.id}`).length,1);
    const owner=await player(tx),inconsistent=await player(tx),otherGuild=await guild(tx,owner);
    await tx`INSERT INTO public.alliance_members(user_id,alliance_id,role) VALUES(${inconsistent.id},${otherGuild.id},'owner')`;
    await blocked(tx,inconsistent,'ALLIANCE_ROLE_ANOMALY');
  });

  await scenario('third-party free text, orphan errors and unknown JSON references are not automatically deleted',async tx=>{
    const target=await player(tx),other=await player(tx);
    await tx`INSERT INTO public.player_feedback(user_id,message) VALUES(${other.id},${`Reference to ${target.username}`})`;
    await tx`INSERT INTO public.error_events(user_id,source,message,context) VALUES(NULL,'fixture','orphan',${tx.json({nested:{id:target.id}})})`;
    await tx`INSERT INTO public.analytics_events(user_id,event_name,payload) VALUES(${other.id},'other-fixture',${tx.json({unreviewedKey:target.id})})`;
    const plan=await inspectAccountErasure(tx,target.id);
    for(const code of ['THIRD_PARTY_FEEDBACK','THIRD_PARTY_ERRORS','THIRD_PARTY_ANALYTICS']) hasBlock(plan,code);
    await assert.rejects(eraseAccountData(tx,target.id),AccountErasureBlockedError);
    assert.equal((await tx`SELECT 1 FROM public.player_feedback WHERE user_id=${other.id}`).length,1);
    assert.equal((await tx`SELECT 1 FROM public.analytics_events WHERE user_id=${other.id}`).length,1);
  });

  await scenario('unexpected foreign-key descendants fail closed before account data is deleted',async tx=>{
    const target=await player(tx);
    await tx`CREATE TABLE public.account_erasure_unknown_fixture(user_id UUID REFERENCES public.users(id) ON DELETE CASCADE)`;
    await tx`INSERT INTO public.account_erasure_unknown_fixture(user_id) VALUES(${target.id})`;
    await blocked(tx,target,'SCHEMA_REVIEW_REQUIRED');
    assert.equal((await tx`SELECT 1 FROM public.account_erasure_unknown_fixture WHERE user_id=${target.id}`).length,1);
  });

  await scenario('row-security drift fails closed even for a database owner who could otherwise bypass it',async tx=>{
    const target=await player(tx);
    await tx`ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY`;
    await blocked(tx,target,'SCHEMA_REVIEW_REQUIRED');
  });

  await t.test('a database failure after pre-cleanup rolls the entire purge back',async()=>{
    let target,other;
    try {
      await sql.begin(async tx=>{
        target=await player(tx);other=await player(tx);
        await tx`UPDATE public.users SET referred_by=${target.id} WHERE id=${other.id}`;
        await tx`INSERT INTO public.analytics_events(user_id,event_name) VALUES(${target.id},'rollback-erasure-fixture')`;
      });
      await assert.rejects(sql.begin(async tx=>{
        await tx`ALTER TABLE public.users ADD CONSTRAINT account_erasure_test_referral_clear CHECK(referred_by IS NOT NULL) NOT VALID`;
        await eraseAccountData(tx,target.id);
      }),error=>error.code==='23514');
      assert.equal((await sql`SELECT 1 FROM public.users WHERE id=${target.id}`).length,1);
      assert.equal((await sql`SELECT 1 FROM public.analytics_events WHERE user_id=${target.id}`).length,1);
      assert.equal((await sql`SELECT referred_by FROM public.users WHERE id=${other.id}`)[0].referred_by,target.id);
      assert.equal((await sql`SELECT 1 FROM pg_constraint WHERE conname='account_erasure_test_referral_clear'`).length,0);
    } finally {
      if(other) await sql`UPDATE public.users SET referred_by=NULL WHERE id=${other.id}`;
      if(target) await sql`DELETE FROM public.analytics_events WHERE user_id=${target.id}`;
      const ids=[target?.id,other?.id].filter(Boolean);
      if(ids.length) await sql`DELETE FROM public.users WHERE id=ANY(${sql.array(ids)}::uuid[])`;
    }
  });

  await t.test('erasure refuses a non-transaction client and invalid account identifiers',async()=>{
    await assert.rejects(eraseAccountData(sql,crypto.randomUUID()),/requires a transaction/);
    await assert.rejects(inspectAccountErasure(sql,'not-a-user'),/Invalid account identifier/);
  });
}
