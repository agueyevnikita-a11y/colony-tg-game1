import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Load these small TS helpers without a production alias loader. Their only
// dependencies are the unchanged reward catalog and the cosmetic grant helper.
async function seasonHelpers() {
  const url = new URL('../lib/server/season.ts', import.meta.url);
  const source = (await readFile(url, 'utf8'))
    .replaceAll("'@/lib/game/season'", JSON.stringify(new URL('../lib/game/season.ts', import.meta.url).href))
    .replaceAll("'@/lib/server/cosmetics'", JSON.stringify(new URL('../lib/server/cosmetics.ts', import.meta.url).href));
  return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
}

export async function runSeasonRewardsIntegration({ t, sql, request, initData, playerId }) {
  const ids = [];
  let sequence = playerId + 9000;
  const post = (telegramId, body) => request('/api/season/claim', { method: 'POST', auth: initData(telegramId), body });
  const balances = async (userId) => {
    const [row] = await sql`SELECT credits,crystals FROM game_states WHERE user_id=${userId}`;
    return { credits: Number(row.credits), crystals: Number(row.crystals) };
  };
  const claims = (userId) => sql`SELECT level FROM season_claims WHERE user_id=${userId} AND season_id='s1_first_signal' ORDER BY level`;
  const cosmetics = (userId) => sql`SELECT cosmetic_id,acquired_at::text,expires_at::text FROM user_cosmetics WHERE user_id=${userId} AND source='season_s1_first_signal' ORDER BY cosmetic_id`;
  async function fixture(points = 2000) {
    const telegramId = sequence++;
    ids.push(telegramId);
    const [user] = await sql`INSERT INTO users(telegram_id,first_name,colony_name) VALUES(${telegramId},'Season test',${`Сезон ${telegramId}`}) RETURNING id`;
    await sql`INSERT INTO game_states(user_id,credits,crystals,last_tick_at) VALUES(${user.id},700,20,now()+interval '1 day')`;
    await sql`INSERT INTO player_stats(user_id) VALUES(${user.id})`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${user.id},'hq',1,2,2,'active')`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${user.id},'integration_test')`;
    const session = await request('/api/session', { method: 'POST', auth: initData(telegramId) });
    assert.equal(session.status, 200, JSON.stringify(session.data));
    assert.ok(session.data.season, 'The isolated test database requires its seeded active season');
    await sql`INSERT INTO season_progress(user_id,season_id,points) VALUES(${user.id},'s1_first_signal',${points}) ON CONFLICT(user_id,season_id) DO UPDATE SET points=EXCLUDED.points`;
    return { userId: user.id, telegramId };
  }
  try {
    await t.test('season claims validate exact integer levels and keep rewards with the signed owner', async () => {
      const owner = await fixture(150);
      const stranger = await fixture(0);
      const before = await balances(owner.userId);
      const strangerBefore = await balances(stranger.userId);
      for (const body of [null, [], {}, { level: '1' }, { level: 1.5 }, { level: 0 }, { level: -1 }, { level: 999 }, { level: null }, { all: false }, { all: 'true' }, { all: true, level: 1 }, { all: true, level: null }]) {
        const reply = await post(owner.telegramId, body);
        assert.equal(reply.status, 400, JSON.stringify({ body, reply }));
      }
      const foreign = await post(stranger.telegramId, { level: 1, userId: owner.userId });
      assert.equal(foreign.status, 400, JSON.stringify(foreign.data));
      const foreignBulk = await post(stranger.telegramId, { all: true, userId: owner.userId });
      assert.equal(foreignBulk.status, 200, JSON.stringify(foreignBulk.data));
      assert.equal(foreignBulk.data.result.count, 0);
      assert.equal((await claims(owner.userId)).length, 0);
      assert.deepEqual(await balances(owner.userId), before);
      assert.deepEqual(await balances(stranger.userId), strangerBefore);
      const single = await post(owner.telegramId, { level: 1 });
      assert.equal(single.status, 200, JSON.stringify(single.data));
      assert.equal(single.data.result.count, 1);
      assert.equal(single.data.result.credits, 500);
      assert.deepEqual(single.data.result.levels, [1]);
      assert.ok(single.data.state && single.data.season && single.data.cosmetics, 'Claims return the full reconciled DTO');
      assert.equal(single.data.season.claims.some(row => row.level === 1), true);
      assert.deepEqual(await balances(owner.userId), { credits: before.credits + 500, crystals: before.crystals });
      assert.equal((await post(owner.telegramId, { level: 1 })).status, 400, 'Single reward repeats preserve the previous API behavior');
      assert.equal((await post(owner.telegramId, { level: 4 })).status, 400, 'An unreached level cannot be claimed');
    });

    await t.test('parallel season bulk and single requests pay each receipt and cosmetic once', async () => {
      const player = await fixture();
      const before = await balances(player.userId);
      const replies = await Promise.all([post(player.telegramId, { all: true }), post(player.telegramId, { all: true }), post(player.telegramId, { level: 3 })]);
      assert.ok(replies.slice(0, 2).every(reply => reply.status === 200), JSON.stringify(replies));
      assert.ok([200, 400].includes(replies[2].status), JSON.stringify(replies[2]));
      const receipts = replies.filter(reply => reply.status === 200).map(reply => reply.data.result);
      assert.equal(receipts.reduce((sum, result) => sum + result.count, 0), 10);
      assert.equal(receipts.reduce((sum, result) => sum + result.credits, 0), 5000);
      assert.equal(receipts.reduce((sum, result) => sum + result.crystals, 0), 60);
      assert.deepEqual(receipts.flatMap(result => result.levels).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      assert.deepEqual(await balances(player.userId), { credits: before.credits + 5000, crystals: before.crystals + 60 });
      assert.deepEqual((await claims(player.userId)).map(row => row.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const cosmeticBefore = await cosmetics(player.userId);
      assert.deepEqual(cosmeticBefore.map(row => row.cosmetic_id), ['badge_pioneer_s1', 'frame_first_signal', 'theme_first_signal', 'weather_signal_storm']);
      assert.equal(cosmeticBefore.find(row => row.cosmetic_id === 'badge_pioneer_s1').expires_at, null);
      for (const row of cosmeticBefore.filter(row => row.cosmetic_id !== 'badge_pioneer_s1')) assert.ok(new Date(row.expires_at).getTime() > Date.now());
      const repeated = await post(player.telegramId, { all: true });
      assert.equal(repeated.status, 200, JSON.stringify(repeated.data));
      assert.deepEqual({ count: repeated.data.result.count, credits: repeated.data.result.credits, crystals: repeated.data.result.crystals, levels: repeated.data.result.levels, cosmeticIds: repeated.data.result.cosmeticIds }, { count: 0, credits: 0, crystals: 0, levels: [], cosmeticIds: [] });
      assert.deepEqual(await cosmetics(player.userId), cosmeticBefore, 'A repeat must not extend temporary cosmetics');
      assert.deepEqual(await balances(player.userId), { credits: before.credits + 5000, crystals: before.crystals + 60 });
    });

    await t.test('bulk season claims skip old receipts and leave unopened levels untouched', async () => {
      const player = await fixture(400);
      await sql`INSERT INTO season_claims(user_id,season_id,level) VALUES(${player.userId},'s1_first_signal',1)`;
      const before = await balances(player.userId);
      const reply = await post(player.telegramId, { all: true });
      assert.equal(reply.status, 200, JSON.stringify(reply.data));
      assert.deepEqual(reply.data.result.levels, [2, 3, 4, 5]);
      assert.equal(reply.data.result.count, 4);
      assert.equal(reply.data.result.credits, 1500);
      assert.equal(reply.data.result.crystals, 30);
      assert.deepEqual(reply.data.result.cosmeticIds, ['weather_signal_storm']);
      assert.deepEqual(await balances(player.userId), { credits: before.credits + 1500, crystals: before.crystals + 30 });
      assert.deepEqual((await claims(player.userId)).map(row => row.level), [1, 2, 3, 4, 5]);
      assert.equal(Number((await sql`SELECT points FROM season_progress WHERE user_id=${player.userId} AND season_id='s1_first_signal'`)[0].points), 400, 'Collecting never consumes SP');
    });

    await t.test('expired and future season windows reject claims without changing shared season dates', async () => {
      const { claimSeasonRewards } = await seasonHelpers();
      const player = await fixture();
      const before = await balances(player.userId);
      for (const future of [false, true]) {
        // Only this transaction sees the replacement. Public seasons and the
        // running application's connection retain their original dates.
        await assert.rejects(sql.begin(async tx => {
          await tx`CREATE TEMP TABLE seasons (LIKE public.seasons INCLUDING ALL) ON COMMIT DROP`;
          await tx`INSERT INTO seasons(id,title,starts_at,ends_at) VALUES('s1_first_signal','Isolated season',now()+make_interval(days=>${future ? 1 : -2}),now()+make_interval(days=>${future ? 2 : -1}))`;
          await claimSeasonRewards(tx, player.userId, { all: true });
        }), /нет активного сезона/);
      }
      assert.deepEqual(await balances(player.userId), before);
      assert.equal((await claims(player.userId)).length, 0);
    });

    await t.test('a failed cosmetic grant rolls back every bulk receipt and payout', async () => {
      const { claimSeasonRewards } = await seasonHelpers();
      const player = await fixture();
      const before = await balances(player.userId);
      await assert.rejects(sql.begin(async tx => {
        // A transaction-local rejection simulates a grant failure without
        // modifying the real cosmetic catalog or another player's inventory.
        await tx`CREATE TEMP TABLE user_cosmetics (LIKE public.user_cosmetics INCLUDING ALL, CHECK (source <> 'season_s1_first_signal')) ON COMMIT DROP`;
        await claimSeasonRewards(tx, player.userId, { all: true });
      }), /check constraint/i);
      assert.deepEqual(await balances(player.userId), before);
      assert.equal((await claims(player.userId)).length, 0);
      assert.equal((await cosmetics(player.userId)).length, 0);
    });
  } finally {
    if (ids.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(ids)}::bigint[])`;
  }
}
