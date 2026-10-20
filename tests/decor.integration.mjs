import assert from 'node:assert/strict';

export async function runDecorIntegration({ t, sql, request, initData, playerId, adminId }) {
  const post = (path, body, actor = playerId) => request(path, { method: 'POST', auth: initData(actor), body });
  const session = () => post('/api/session');
  async function fixture(hqLevel = 3) {
    const userId = (await sql`SELECT id FROM users WHERE telegram_id=${playerId}`)[0].id;
    await sql`DELETE FROM foundry_jobs WHERE user_id=${userId}`;
    await sql`DELETE FROM buildings WHERE user_id=${userId}`;
    await sql`DELETE FROM city_decor WHERE user_id=${userId}`;
    await sql`DELETE FROM user_research WHERE user_id=${userId}`;
    await sql`DELETE FROM api_rate_limits WHERE bucket_key=${`global:${userId}`}`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${userId},'hq',${hqLevel},2,2,'active')`;
    await sql`UPDATE game_states SET hq_level=${hqLevel},credits=10000,last_tick_at=now()+interval '1 day',passive_carry='{}'::jsonb WHERE user_id=${userId}`;
    return userId;
  }
  async function credits(userId) { return Number((await sql`SELECT credits FROM game_states WHERE user_id=${userId}`)[0].credits); }
  async function place(type, x, y) { return post('/api/game/decor/place', { type, x, y }); }

  await t.test('decor rejects malformed coordinates and unavailable research without charging credits', async () => {
    const userId = await fixture(2);
    for (const body of [{ type: 'road', x: null, y: 0 }, { type: 'road', x: '0', y: 0 }, { type: 'road', x: 0.5, y: 0 }, { type: 'road', x: 0, y: 6 }, { type: '__proto__', x: 0, y: 0 }]) {
      assert.equal((await post('/api/game/decor/place', body)).status, 400);
    }
    const unavailable = await place('flowerbed', 0, 0);
    assert.equal(unavailable.status, 400, JSON.stringify(unavailable.data));
    assert.match(unavailable.data.error, /исследование/);
    assert.equal((await place('park', 0, 0)).status, 400);
    assert.equal(await credits(userId), 10000);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM city_decor WHERE user_id=${userId}`)[0].count), 0);
    await sql`INSERT INTO user_research(user_id,research_key,status,completes_at,completed_at) VALUES(${userId},'urban_ecology','completed',now(),now())`;
    const flowerbed = await place('flowerbed', 0, 0);
    assert.equal(flowerbed.status, 200, JSON.stringify(flowerbed.data));
    assert.equal(await credits(userId), 9780);
  });

  await t.test('free decor moves preserve credits, survive research removal, and reject occupied or foreign cells', async () => {
    const userId = await fixture();
    await sql`INSERT INTO user_research(user_id,research_key,status,completes_at,completed_at) VALUES(${userId},'public_spaces','completed',now(),now())`;
    const response = await place('fountain', 0, 0);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const decorId = response.data.result.id;
    const before = await credits(userId);
    await sql`DELETE FROM user_research WHERE user_id=${userId}`;
    const moved = await post('/api/game/decor/move', { decorId, x: 1, y: 0 });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    assert.equal(moved.data.result.x, 1);
    assert.equal(moved.data.result.y, 0);
    assert.equal(await credits(userId), before);
    assert.equal((await post('/api/game/decor/move', { decorId, x: 2, y: 2 })).status, 400);
    assert.equal((await post('/api/game/decor/move', { decorId, x: 1, y: 0 })).status, 200);
    assert.equal((await post('/api/game/decor/move', { decorId, x: 1, y: 1 }, adminId)).status, 400);
    assert.equal((await post('/api/game/decor/remove', { decorId }, adminId)).status, 400);
    assert.equal(await credits(userId), before);
    const removed = await post('/api/game/decor/remove', { decorId });
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    assert.equal(removed.data.result.refund, 325);
    assert.equal(await credits(userId), before + 325);
    assert.equal((await post('/api/game/decor/remove', { decorId })).status, 400);
    assert.equal(await credits(userId), before + 325);
  });

  await t.test('simultaneous decoration on one tile charges only the successful placement', async () => {
    const userId = await fixture();
    const replies = await Promise.all([place('road', 0, 0), place('road', 0, 0)]);
    assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 400]);
    assert.equal(Number((await sql`SELECT count(*) AS count FROM city_decor WHERE user_id=${userId} AND x=0 AND y=0`)[0].count), 1);
    assert.equal(await credits(userId), 9950);
  });

  await t.test('new decoration types fit the schema and comfort best survives city redesign', async () => {
    const userId = await fixture(4);
    await sql`UPDATE player_stats SET max_comfort=0 WHERE user_id=${userId}`;
    await sql`DELETE FROM user_achievements WHERE user_id=${userId} AND achievement_key IN ('comfort_25','comfort_50','comfort_80')`;
    await sql`DELETE FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id='frame_garden'`;
    const types = ['road', 'tree', 'lamp', 'park', 'statue', 'bench', 'flowerbed', 'fountain', 'plaza'];
    for (let index = 0; index < types.length; index++) {
      await sql`INSERT INTO city_decor(user_id,type,x,y) VALUES(${userId},${types[index]},${index % 7},${Math.floor(index / 7)})`;
    }
    const decorated = await session();
    assert.equal(decorated.status, 200, JSON.stringify(decorated.data));
    assert.equal(decorated.data.comfort.score, 82);
    assert.equal(Number((await sql`SELECT max_comfort FROM player_stats WHERE user_id=${userId}`)[0].max_comfort), 82);
    await sql`DELETE FROM city_decor WHERE user_id=${userId}`;
    const empty = await session();
    assert.equal(empty.status, 200, JSON.stringify(empty.data));
    assert.equal(empty.data.comfort.score, 0);
    assert.equal(Number((await sql`SELECT max_comfort FROM player_stats WHERE user_id=${userId}`)[0].max_comfort), 82);
    const before = Number((await sql`SELECT crystals FROM game_states WHERE user_id=${userId}`)[0].crystals);
    for (const achievementKey of ['comfort_25', 'comfort_50', 'comfort_80']) {
      const claimed = await post('/api/game/achievements/claim', { achievementKey });
      assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
      assert.equal((await post('/api/game/achievements/claim', { achievementKey })).status, 400);
    }
    assert.equal(Number((await sql`SELECT crystals FROM game_states WHERE user_id=${userId}`)[0].crystals), before + 35);
    const frame = (await sql`SELECT expires_at FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id='frame_garden'`)[0];
    assert.ok(frame);
    assert.equal(frame.expires_at, null);
  });

  await t.test('removing existing decor before the first session retains its comfort peak and achievement', async () => {
    const userId = await fixture(2);
    await sql`UPDATE player_stats SET max_comfort=0 WHERE user_id=${userId}`;
    await sql`DELETE FROM user_achievements WHERE user_id=${userId} AND achievement_key IN ('comfort_25','comfort_50','comfort_80')`;
    // A migrated city, or a placement whose response was interrupted, has not
    // yet reconciled its new peak. Do not open a session before removing decor.
    const decor = await sql`
      INSERT INTO city_decor(user_id,type,x,y) VALUES
        (${userId},'road',0,0),(${userId},'tree',1,0),(${userId},'lamp',2,0),
        (${userId},'bench',3,0),(${userId},'road',4,0)
      RETURNING id,type
    `;
    const bench = decor.find(item => item.type === 'bench');
    const response = await post('/api/game/decor/remove', { decorId: bench.id });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.comfort.score, 18);
    assert.equal(Number(response.data.stats.max_comfort), 26);
    assert.equal(Number((await sql`SELECT max_comfort FROM player_stats WHERE user_id=${userId}`)[0].max_comfort), 26);
    assert.ok(response.data.achievements.some(item => item.achievement_key === 'comfort_25'));
    assert.equal(await credits(userId), 10090, 'Removal only refunds half the bench price');
  });
}
