import assert from 'node:assert/strict';

/** Dedicated random users only; never point this helper at a playing database. */
export async function runAllianceCreationIntegration({ t, sql, request, initData, playerId }) {
  const database = new URL(process.env.DATABASE_URL || '');
  assert.equal(process.env.COLONY_TEST_DATABASE, '1');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.match(database.pathname, /^\/colony_(ci|test)$/);
  const telegramIds = [];
  let sequence = playerId + 26000;
  const terms = { expectedCreateCost: 100, expectedCreateCurrency: 'crystals' };
  const create = (player, extra = {}) => request('/api/alliance/create', {
    method: 'POST', auth: initData(player.telegramId), body: { name: `Команда ${player.telegramId}`, ...terms, ...extra },
  });
  const balances = async player => Object.fromEntries(Object.entries((await sql`
    SELECT ore,energy,parts,credits,science,crystals FROM game_states WHERE user_id=${player.userId}
  `)[0]).map(([key, value]) => [key, Number(value)]));
  const membership = async player => [...await sql`SELECT * FROM alliance_members WHERE user_id=${player.userId}`];
  async function player({ hq = 3, crystals = 100, credits = 0, leftAt = null } = {}) {
    const telegramId = sequence++;
    telegramIds.push(telegramId);
    const [user] = await sql`INSERT INTO users(telegram_id,first_name,colony_name,profile_completed_at,alliance_left_at)
      VALUES(${telegramId},'Creation CI',${`Основание ${telegramId}`},now(),${leftAt}) RETURNING id`;
    await sql`INSERT INTO game_states(user_id,hq_level,ore,energy,parts,credits,science,crystals,last_tick_at)
      VALUES(${user.id},${hq},0,0,0,${credits},0,${crystals},now()+interval '1 day')`;
    await sql`INSERT INTO player_stats(user_id) VALUES(${user.id})`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${user.id},'hq',${hq},2,2,'active')`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${user.id},'integration_test')`;
    return { userId: user.id, telegramId };
  }

  try {
    await t.test('alliance creation rejects missing or stale price confirmation without charging either currency', async () => {
      const pilot = await player({ credits: 20000, crystals: 1000 }), before = await balances(pilot);
      for (const confirmation of [
        { expectedCreateCost: undefined, expectedCreateCurrency: undefined },
        { expectedCreateCost: 5000, expectedCreateCurrency: 'credits' },
        { expectedCreateCost: 100, expectedCreateCurrency: 'credits' },
        { expectedCreateCost: 99, expectedCreateCurrency: 'crystals' },
        { expectedCreateCost: '100', expectedCreateCurrency: 'crystals' },
        { expectedCreateCost: 100, expectedCreateCurrency: 'stars' },
      ]) {
        const reply = await create(pilot, confirmation);
        assert.equal(reply.status, 400, JSON.stringify(reply.data));
        assert.match(reply.data.error, /Условия создания альянса изменились/);
        assert.deepEqual(await balances(pilot), before);
        assert.deepEqual(await membership(pilot), []);
      }
    });

    await t.test('creation needs crystals even with abundant credits and keeps rejected names, HQ and cooldown free', async () => {
      const poor = await player({ credits: 100000, crystals: 99 }), before = await balances(poor);
      const shortage = await create(poor);
      assert.equal(shortage.status, 400, JSON.stringify(shortage.data));
      assert.match(shortage.data.error, /Нужно 100 кристаллов.*Не хватает 1/);
      assert.deepEqual(await balances(poor), before);
      assert.deepEqual(await membership(poor), []);
      for (const options of [{ hq: 2 }, { leftAt: new Date() }]) {
        const pilot = await player(options), balance = await balances(pilot), reply = await create(pilot);
        assert.equal(reply.status, 400, JSON.stringify(reply.data));
        assert.deepEqual(await balances(pilot), balance);
        assert.deepEqual(await membership(pilot), []);
      }
      const invalid = await player(), invalidBefore = await balances(invalid);
      assert.equal((await create(invalid, { name: '!' })).status, 400);
      assert.deepEqual(await balances(invalid), invalidBefore);
      assert.deepEqual(await membership(invalid), []);
    });

    await t.test('exactly one hundred crystals found a team with zero credits; existing membership reads are free', async () => {
      const pilot = await player(), before = await balances(pilot), reply = await create(pilot);
      assert.equal(reply.status, 200, JSON.stringify(reply.data));
      assert.deepEqual(await balances(pilot), { ...before, crystals: 0 });
      assert.equal(reply.data.alliance.rules.createCost, 100);
      assert.equal(reply.data.alliance.rules.createCurrency, 'crystals');
      assert.equal((await membership(pilot))[0].role, 'owner');
      const existing = await request('/api/session', { method: 'POST', auth: initData(pilot.telegramId) });
      assert.equal(existing.status, 200, JSON.stringify(existing.data));
      assert.equal(existing.data.alliance.rules.createCurrency, 'crystals');
      assert.deepEqual(await balances(pilot), { ...before, crystals: 0 });
      const duplicate = await create(pilot);
      assert.equal(duplicate.status, 400);
      assert.match(duplicate.data.error, /уже состоите/);
      assert.deepEqual(await balances(pilot), { ...before, crystals: 0 });
    });

    await t.test('concurrent creations pay once and joining the founded team charges no resources', async () => {
      const owner = await player({ crystals: 200, credits: 123 }), before = await balances(owner);
      const replies = await Promise.all([create(owner), create(owner, { name: `Второй ${owner.telegramId}` })]);
      assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 400]);
      assert.deepEqual(await balances(owner), { ...before, crystals: 100 });
      assert.equal((await membership(owner)).length, 1);
      assert.equal(Number((await sql`SELECT count(*) AS count FROM alliances WHERE owner_user_id=${owner.userId}`)[0].count), 1);
      const [team] = await sql`SELECT code FROM alliances WHERE owner_user_id=${owner.userId}`;
      const member = await player({ hq: 2, crystals: 0, credits: 0 }), memberBefore = await balances(member);
      const joined = await request('/api/alliance/join', { method: 'POST', auth: initData(member.telegramId), body: { code: team.code } });
      assert.equal(joined.status, 200, JSON.stringify(joined.data));
      assert.deepEqual(await balances(member), memberBefore);
      assert.equal((await membership(member))[0].role, 'member');
      assert.deepEqual(await balances(owner), { ...before, crystals: 100 });
    });
  } finally {
    if (telegramIds.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(telegramIds)}::bigint[])`;
  }
}
