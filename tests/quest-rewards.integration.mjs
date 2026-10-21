import assert from 'node:assert/strict';

export async function runQuestRewardsIntegration({ t, sql, request, initData, playerId }) {
  const createdIds = [];
  let sequence = playerId + 8000;
  const post = (player, body) => request('/api/game/quests/claim', { method: 'POST', auth: initData(player.telegramId), body });
  const balances = async (player) => {
    const [state] = await sql`SELECT credits,crystals FROM game_states WHERE user_id=${player.userId}`;
    return { credits: Number(state.credits), crystals: Number(state.crystals) };
  };
  const rows = (player, period) => period === 'weekly'
    ? sql`SELECT * FROM weekly_quests WHERE user_id=${player.userId} AND week_start=date_trunc('week',CURRENT_DATE)::date ORDER BY quest_key`
    : sql`SELECT * FROM daily_quests WHERE user_id=${player.userId} AND quest_date=CURRENT_DATE ORDER BY quest_key`;
  const receipt = (period, quests) => ({
    period, count: quests.length,
    credits: quests.reduce((sum, quest) => sum + Number(quest.credit_reward), 0),
    crystals: quests.reduce((sum, quest) => sum + Number(quest.crystal_reward), 0),
    questKeys: quests.map(quest => quest.quest_key).sort(),
  });
  async function fixture() {
    const telegramId = sequence++;
    createdIds.push(telegramId);
    const [user] = await sql`INSERT INTO users(telegram_id,first_name) VALUES(${telegramId},'Quest rewards test') RETURNING id`;
    await sql`INSERT INTO game_states(user_id,last_tick_at) VALUES(${user.id},now()+interval '1 day')`;
    await sql`INSERT INTO player_stats(user_id) VALUES(${user.id})`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${user.id},'integration_test')`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${user.id},'hq',1,2,2,'active')`;
    const player = { userId: user.id, telegramId };
    const session = await request('/api/session', { method: 'POST', auth: initData(telegramId) });
    assert.equal(session.status, 200, JSON.stringify(session.data));
    await sql`UPDATE daily_quests SET progress=0,claimed_at=NULL WHERE user_id=${user.id}`;
    await sql`UPDATE weekly_quests SET progress=0,claimed_at=NULL WHERE user_id=${user.id}`;
    await sql`UPDATE game_states SET credits=10000,crystals=0,last_tick_at=now()+interval '1 day' WHERE user_id=${user.id}`;
    return player;
  }
  async function complete(player, period) {
    if (period === 'weekly') await sql`UPDATE weekly_quests SET progress=target,claimed_at=NULL WHERE user_id=${player.userId} AND week_start=date_trunc('week',CURRENT_DATE)::date`;
    else await sql`UPDATE daily_quests SET progress=target,claimed_at=NULL WHERE user_id=${player.userId} AND quest_date=CURRENT_DATE`;
    return rows(player, period);
  }
  async function parallel(operations) {
    let timer;
    try {
      return await Promise.race([
        Promise.all(operations),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Parallel quest claims did not finish within 10 seconds')), 10_000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function assertPaid(player, before, expected) {
    assert.deepEqual(await balances(player), { credits: before.credits + expected.credits, crystals: before.crystals + expected.crystals });
    const [events] = await sql`SELECT count(*)::integer AS count FROM analytics_events WHERE user_id=${player.userId} AND event_name='quest_claimed'`;
    assert.equal(events.count, expected.count, 'Every newly claimed quest has exactly one event');
  }

  try {
    await t.test('quest bulk rewards include only completed, unclaimed current-period quests and return the refreshed colony', async () => {
      for (const period of ['daily', 'weekly']) {
        const player = await fixture();
        const all = await complete(player, period);
        if (period === 'weekly') {
          await sql`UPDATE weekly_quests SET progress=0 WHERE id=${all[0].id}`;
          await sql`UPDATE weekly_quests SET claimed_at=now() WHERE id=${all[1].id}`;
        } else {
          await sql`UPDATE daily_quests SET progress=0 WHERE id=${all[0].id}`;
          await sql`UPDATE daily_quests SET claimed_at=now() WHERE id=${all[1].id}`;
        }
        const before = await balances(player);
        const expected = receipt(period, all.slice(2));
        const response = await post(player, { period, all: true });
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.deepEqual(response.data.result, expected);
        assert.ok(response.data.state, 'The receipt accompanies the full colony DTO');
        assert.ok(Array.isArray(response.data.dailyQuests));
        assert.ok(Array.isArray(response.data.weeklyQuests));
        const settled = await rows(player, period);
        assert.equal(settled[0].claimed_at, null, 'An unfinished quest is left untouched');
        assert.ok(settled.slice(1).every(quest => quest.claimed_at));
        const otherPeriod = period === 'daily' ? 'weekly' : 'daily';
        assert.ok((await rows(player, otherPeriod)).every(quest => quest.claimed_at === null));
        await assertPaid(player, before, expected);
        const repeated = await post(player, { period, all: true });
        assert.equal(repeated.status, 200, JSON.stringify(repeated.data));
        assert.deepEqual(repeated.data.result, receipt(period, []));
        await assertPaid(player, before, expected);
      }
    });

    await t.test('parallel quest bulk requests pay each daily and weekly reward once', async () => {
      for (const period of ['daily', 'weekly']) {
        const player = await fixture();
        const quests = await complete(player, period);
        const before = await balances(player);
        const expected = receipt(period, quests);
        const replies = await parallel([post(player, { period, all: true }), post(player, { period, all: true })]);
        assert.ok(replies.every(reply => reply.status === 200), JSON.stringify(replies));
        assert.deepEqual(replies.map(reply => reply.data.result.count).sort((a, b) => a - b), [0, quests.length]);
        const receipts = replies.map(reply => reply.data.result);
        assert.equal(receipts.reduce((sum, result) => sum + result.credits, 0), expected.credits);
        assert.equal(receipts.reduce((sum, result) => sum + result.crystals, 0), expected.crystals);
        assert.deepEqual(receipts.flatMap(result => result.questKeys).sort(), expected.questKeys);
        assert.ok((await rows(player, period)).every(quest => quest.claimed_at));
        await assertPaid(player, before, expected);
      }
    });

    await t.test('a parallel legacy single claim and bulk claim cannot duplicate a reward', async () => {
      for (const period of ['daily', 'weekly']) {
        const player = await fixture();
        const quests = await complete(player, period);
        const questKey = quests[0].quest_key;
        const before = await balances(player);
        const expected = receipt(period, quests);
        const replies = await parallel([post(player, { period, questKey }), post(player, { period, all: true })]);
        assert.equal(replies[1].status, 200, JSON.stringify(replies));
        assert.ok([200, 400].includes(replies[0].status), JSON.stringify(replies));
        const paid = replies.filter(reply => reply.status === 200).map(reply => reply.data.result);
        assert.equal(paid.reduce((sum, result) => sum + result.count, 0), expected.count);
        assert.equal(paid.reduce((sum, result) => sum + result.credits, 0), expected.credits);
        assert.equal(paid.reduce((sum, result) => sum + result.crystals, 0), expected.crystals);
        assert.deepEqual(paid.flatMap(result => result.questKeys).sort(), expected.questKeys);
        if (replies[0].status === 200) assert.deepEqual(replies[0].data.result, receipt(period, [quests[0]]));
        assert.equal((await post(player, { period, questKey })).status, 400, 'A repeated legacy single claim retains its existing error');
        assert.deepEqual((await post(player, { period, all: true })).data.result, receipt(period, []));
        await assertPaid(player, before, expected);
      }
    });

    await t.test('malformed selections, old periods and another player never grant quest rewards', async () => {
      const player = await fixture();
      const stranger = await fixture();
      await complete(stranger, 'daily');
      await complete(stranger, 'weekly');
      const before = await balances(player);
      const strangerBefore = await balances(stranger);
      await sql`
        INSERT INTO daily_quests(user_id,quest_key,progress,target,crystal_reward,credit_reward,quest_date)
        SELECT user_id,quest_key,target,target,crystal_reward,credit_reward,CURRENT_DATE-1
        FROM daily_quests WHERE user_id=${player.userId} AND quest_date=CURRENT_DATE
      `;
      await sql`
        INSERT INTO weekly_quests(user_id,quest_key,progress,target,crystal_reward,credit_reward,week_start)
        SELECT user_id,quest_key,target,target,crystal_reward,credit_reward,week_start-7
        FROM weekly_quests WHERE user_id=${player.userId} AND week_start=date_trunc('week',CURRENT_DATE)::date
      `;
      for (const body of [
        null, [], {}, { all: true }, { period: 'month', all: true }, { period: null, all: true },
        { period: 'Daily', questKey: 'daily_build' }, { period: 'weekly', questKey: 'daily_build' },
        { period: 'daily', questKey: 'weekly_build' }, { period: 'daily', questKey: '' },
        { period: 'daily', questKey: ' daily_build ' }, { period: 'daily', questKey: 'unknown' },
        { period: 'daily', questKey: null }, { period: 'daily', questKey: ['daily_build'] },
        { period: 'daily', all: false }, { period: 'daily', all: 'true' }, { period: 'daily', all: 1 },
        { period: 'daily', all: true, questKey: 'daily_build' }, { period: 'daily', all: false, questKey: 'daily_build' },
        { period: 'daily', all: true, questKey: null }, { period: 'daily', all: true, userId: stranger.userId },
      ]) {
        const response = await post(player, body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.data.ok, false);
      }
      for (const period of ['daily', 'weekly']) {
        const questKey = period === 'daily' ? 'daily_build' : 'weekly_build';
        const single = await post(player, { period, questKey });
        assert.equal(single.status, 400, JSON.stringify(single.data));
        assert.match(single.data.error, /не выполнено/);
        const bulk = await post(player, { period, all: true });
        assert.equal(bulk.status, 200, JSON.stringify(bulk.data));
        assert.deepEqual(bulk.data.result, receipt(period, []));
        assert.ok((await rows(stranger, period)).every(quest => quest.claimed_at === null), 'Foreign quests are never selected');
      }
      assert.ok((await sql`SELECT claimed_at FROM daily_quests WHERE user_id=${player.userId} AND quest_date<CURRENT_DATE`).every(quest => quest.claimed_at === null));
      assert.ok((await sql`SELECT claimed_at FROM weekly_quests WHERE user_id=${player.userId} AND week_start<date_trunc('week',CURRENT_DATE)::date`).every(quest => quest.claimed_at === null));
      await assertPaid(player, before, receipt('daily', []));
      assert.deepEqual(await balances(stranger), strangerBefore);
      assert.notEqual((await request('/api/game/quests/claim', { method: 'POST', body: { period: 'daily', all: true } })).status, 200);
    });
  } finally {
    if (createdIds.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(createdIds)}::bigint[])`;
  }
}
