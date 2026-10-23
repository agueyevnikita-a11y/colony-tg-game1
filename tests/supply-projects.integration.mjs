import assert from 'node:assert/strict';
import crypto from 'node:crypto';

/** New isolated identities only; never execute against a local playing database. */
export async function runSupplyProjectsIntegration({ t, sql, request, initData, playerId }) {
  const database = new URL(process.env.DATABASE_URL || '');
  assert.equal(process.env.COLONY_TEST_DATABASE, '1');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.match(database.pathname, /^\/colony_(ci|test)$/);
  const telegramIds = [];
  let sequence = playerId + 22000;
  const post = (player, body) => request('/api/game/supply-projects', { method: 'POST', auth: initData(player.telegramId), body });
  const balances = async player => Object.fromEntries(Object.entries((await sql`
    SELECT ore,energy,parts,credits,science,crystals FROM game_states WHERE user_id=${player.userId}
  `)[0]).map(([key, value]) => [key, Number(value)]));
  const progress = player => sql`SELECT * FROM supply_project_progress WHERE user_id=${player.userId} ORDER BY project_key`;
  const receipts = player => sql`SELECT * FROM supply_project_requests WHERE user_id=${player.userId} ORDER BY request_id`;
  async function session(player) {
    const reply = await request('/api/session', { method: 'POST', auth: initData(player.telegramId) });
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    assert.equal(reply.data.supplyProjects.available, true);
    return reply.data.supplyProjects;
  }
  const goal = (state, key = 'cargo_route') => state.projects.find(project => project.id === key);
  function body(project, action, extra = {}) {
    return { action, requestId: crypto.randomUUID(), projectKey: project.id, definitionVersion: project.version, expectedStage: project.stageIndex, ...extra };
  }
  async function player({ hq = 3, logistics = 'active' } = {}) {
    const telegramId = sequence++;
    telegramIds.push(telegramId);
    const [user] = await sql`INSERT INTO users(telegram_id,first_name,colony_name,profile_completed_at)
      VALUES(${telegramId},'Supply CI',${`Снабжение ${telegramId}`},now()) RETURNING id`;
    await sql`INSERT INTO game_states(user_id,hq_level,ore,energy,parts,credits,science,crystals,last_tick_at)
      VALUES(${user.id},${hq},50000,50000,50000,10000,1000,0,now()+interval '1 day')`;
    await sql`INSERT INTO player_stats(user_id) VALUES(${user.id})`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${user.id},'hq',${hq},2,2,'active')`;
    if (logistics) await sql`INSERT INTO buildings(user_id,type,level,x,y,status,target_level,completes_at)
      VALUES(${user.id},'logistics',1,0,0,${logistics},${logistics === 'active' ? null : 2},
        ${logistics === 'active' ? null : new Date(Date.now() + 86_400_000)})`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${user.id},'integration_test')`;
    return { userId: user.id, telegramId };
  }
  async function send(player, project, resource, amount, extra = {}) {
    const input = body(project, 'deliver', { resource, amount, ...extra }), reply = await post(player, input);
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    return { reply, input };
  }
  async function fillStage(player, key) {
    let project = goal(await session(player), key);
    for (const resource of ['ore', 'energy', 'parts']) {
      if (project.remaining[resource] > 0) await send(player, project, resource, project.remaining[resource]);
      project = goal(await session(player), key);
    }
    assert.equal(project.ready, true);
    return project;
  }
  const withReward = (before, reward) => ({ ...before,
    credits: before.credits + reward.credits, science: before.science + reward.science, crystals: before.crystals + reward.crystals });

  try {
    await t.test('supply project reads are free and only a level-three colony with active logistics can deliver', async () => {
      for (const options of [{ hq: 2 }, { logistics: null }, { logistics: 'building' }, { logistics: 'upgrading' }]) {
        const pilot = await player(options), before = await balances(pilot), initial = await session(pilot);
        assert.equal(initial.unlocked, false);
        assert.equal(initial.requiredHq, 3);
        assert.equal(initial.projects.length, 3);
        assert.ok(initial.projects.every(project => !project.started && !project.ready && !project.completed && project.stageIndex === 0));
        assert.deepEqual(await progress(pilot), []);
        const denied = await post(pilot, body(goal(initial), 'deliver', { resource: 'ore', amount: 1 }));
        assert.equal(denied.status, 400, JSON.stringify(denied.data));
        await session(pilot);
        assert.deepEqual(await balances(pilot), before);
        assert.deepEqual(await progress(pilot), []);
        assert.deepEqual(await receipts(pilot), []);
      }
      const pilot = await player(), before = await balances(pilot), unlocked = await session(pilot);
      assert.equal(unlocked.unlocked, true);
      assert.equal(unlocked.lockReason, null);
      await session(pilot);
      assert.deepEqual(await balances(pilot), before);
      assert.deepEqual(await progress(pilot), []);
      assert.deepEqual(await receipts(pilot), []);
    });

    await t.test('supply project validation, stale conditions and shortages cannot debit another colony or create paid progress', async () => {
      const pilot = await player(), stranger = await player(), project = goal(await session(pilot));
      const before = await balances(pilot);
      const valid = body(project, 'deliver', { resource: 'parts', amount: 1 });
      const malformed = [null, [], {}, { ...valid, requestId: 'invalid' }, { ...valid, action: 'start' },
        { ...valid, resource: 'credits' }, { ...valid, amount: 0 }, { ...valid, amount: -1 }, { ...valid, amount: 1.5 },
        { ...valid, amount: '1' }, { ...valid, amount: 1_000_001 }, { ...valid, projectKey: 'foreign' },
        { ...valid, definitionVersion: project.version + 1 }, { ...valid, expectedStage: 1 }];
      for (const input of malformed) assert.equal((await post(pilot, input)).status, 400, JSON.stringify(input));
      assert.equal((await post(pilot, body(project, 'claim'))).status, 400, 'Unfunded projects cannot pay an early reward');
      assert.equal((await request('/api/game/supply-projects', { method: 'POST', body: valid })).status, 400);
      assert.deepEqual(await balances(pilot), before);
      assert.deepEqual(await progress(pilot), []);
      assert.deepEqual(await receipts(pilot), []);
      await sql`UPDATE game_states SET parts=0 WHERE user_id=${pilot.userId}`;
      const shortBefore = await balances(pilot);
      assert.equal((await post(pilot, valid)).status, 400);
      assert.deepEqual(await balances(pilot), shortBefore);
      assert.deepEqual(await progress(pilot), []);
      const otherBefore = await balances(stranger);
      const own = await post(stranger, { ...body(project, 'deliver', { resource: 'ore', amount: 3 }), userId: pilot.userId });
      assert.equal(own.status, 200, JSON.stringify(own.data));
      assert.deepEqual(await balances(pilot), shortBefore);
      assert.deepEqual(await progress(pilot), []);
      assert.deepEqual(await balances(stranger), { ...otherBefore, ore: otherBefore.ore - 3 });
      assert.equal((await progress(stranger)).length, 1);
    });

    await t.test('concurrent shipment receipts charge once and different shipments stop exactly at the remaining quota', async () => {
      const pilot = await player(), project = goal(await session(pilot)), before = await balances(pilot);
      const first = body(project, 'deliver', { resource: 'ore', amount: 50 });
      const repeated = await Promise.all([post(pilot, first), post(pilot, first)]);
      assert.ok(repeated.every(reply => reply.status === 200), JSON.stringify(repeated));
      assert.deepEqual(await balances(pilot), { ...before, ore: before.ore - 50 });
      assert.equal((await receipts(pilot)).length, 1);
      assert.equal((await post(pilot, { ...first, amount: 51 })).status, 400);
      const remaining = project.stages[0].requirements.ore - 50;
      const a = Math.max(1, remaining - 10);
      const final = await Promise.all([post(pilot, body(project, 'deliver', { resource: 'ore', amount: a })),
        post(pilot, body(project, 'deliver', { resource: 'ore', amount: a }))]);
      assert.ok(final.every(reply => reply.status === 200), JSON.stringify(final));
      assert.deepEqual(await balances(pilot), { ...before, ore: before.ore - project.stages[0].requirements.ore });
      let current = goal(await session(pilot));
      assert.equal(current.delivered.ore, project.stages[0].requirements.ore);
      assert.equal(current.remaining.ore, 0);
      assert.equal((await post(pilot, body(current, 'deliver', { resource: 'ore', amount: 1 }))).status, 400);
      const energyBefore = await balances(pilot);
      await send(pilot, current, 'energy', 1_000_000);
      assert.equal((await balances(pilot)).energy, energyBefore.energy - project.stages[0].requirements.energy,
        'Only the accepted remainder needs funding, even when the requested amount exceeds the balance');
      current = await fillStage(pilot, project.id);
      const funded = await balances(pilot), preserved = await progress(pilot);
      assert.equal(current.stageIndex, 0, 'Supplying a stage must not automatically advance it or pay its reward');
      await session(pilot);
      assert.deepEqual(await balances(pilot), funded);
      assert.deepEqual(await progress(pilot), preserved);
      assert.equal((await post(pilot, first)).status, 200, 'A paid receipt still replays after its resource quota is full');
      assert.deepEqual(await balances(pilot), funded);
    });

    await t.test('earned stage claims survive logistics downtime, serialize payment and reject stale-stage follow-up spending', async () => {
      const pilot = await player();
      const project = await fillStage(pilot, 'cargo_route'), before = await balances(pilot), reward = project.stages[0].reward;
      await sql`UPDATE buildings SET status='upgrading',target_level=2,completes_at=now()+interval '1 day'
        WHERE user_id=${pilot.userId} AND type='logistics'`;
      const inputs = [body(project, 'claim'), body(project, 'claim')];
      const replies = await Promise.all(inputs.map(input => post(pilot, input)));
      assert.equal(replies.filter(reply => reply.status === 200).length, 1, JSON.stringify(replies));
      assert.equal(replies.filter(reply => reply.status === 400).length, 1, JSON.stringify(replies));
      assert.deepEqual(await balances(pilot), withReward(before, reward));
      const current = goal(await session(pilot));
      assert.equal(current.stageIndex, 1);
      assert.deepEqual(current.delivered, { ore: 0, energy: 0, parts: 0 });
      assert.equal(current.ready, false);
      assert.equal((await post(pilot, body(current, 'deliver', { resource: 'ore', amount: 1 }))).status, 400);
      const winner = inputs[replies.findIndex(reply => reply.status === 200)];
      await sql`UPDATE buildings SET status='active',target_level=NULL,completes_at=NULL WHERE user_id=${pilot.userId} AND type='logistics'`;
      assert.equal((await post(pilot, body(project, 'deliver', { resource: 'parts', amount: 1 }))).status, 400,
        'A stale stage cannot debit the new stage even when delivery is otherwise available');
      await sql`DELETE FROM buildings WHERE user_id=${pilot.userId} AND type='logistics'`;
      assert.equal((await post(pilot, winner)).status, 200, 'Original paid claim is replayable even after logistics removal');
      assert.deepEqual(await balances(pilot), withReward(before, reward));
      assert.equal((await post(pilot, body(project, 'deliver', { resource: 'parts', amount: 1 }))).status, 400);
      assert.deepEqual(await balances(pilot), withReward(before, reward));
    });

    await t.test('partially supplied goals coexist and their saved future-stage terms survive later configuration differences', async () => {
      const pilot = await player(), first = goal(await session(pilot)), second = goal(await session(pilot), 'polar_lab');
      await send(pilot, first, 'ore', 17);
      await send(pilot, second, 'parts', 7);
      const [row] = await sql`SELECT definition_json FROM supply_project_progress WHERE user_id=${pilot.userId} AND project_key=${first.id}`;
      const snapshot = structuredClone(row.definition_json);
      snapshot.stages[1].requirements = { ore: 11, energy: 5, parts: 7 };
      snapshot.stages[1].reward = { credits: 17, science: 13, crystals: 2, cosmeticIds: [] };
      await sql`UPDATE supply_project_progress SET definition_json=${sql.json(snapshot)} WHERE user_id=${pilot.userId} AND project_key=${first.id}`;
      const beforeReads = await balances(pilot), saved = await progress(pilot);
      const read = await session(pilot);
      await session(pilot);
      assert.deepEqual(await balances(pilot), beforeReads);
      assert.deepEqual(await progress(pilot), saved);
      assert.equal(goal(read).delivered.ore, 17);
      assert.equal(goal(read, second.id).delivered.parts, 7);
      assert.deepEqual(goal(read).stages[1], snapshot.stages[1]);
      const ready = await fillStage(pilot, first.id);
      assert.equal((await post(pilot, body(ready, 'claim'))).status, 200);
      const next = goal(await session(pilot));
      assert.equal(next.stageIndex, 1);
      assert.deepEqual(next.remaining, snapshot.stages[1].requirements);
      const nextReady = await fillStage(pilot, first.id), beforeClaim = await balances(pilot);
      assert.equal((await post(pilot, body(nextReady, 'claim'))).status, 200);
      assert.deepEqual(await balances(pilot), withReward(beforeClaim, snapshot.stages[1].reward));
      assert.equal(goal(await session(pilot), second.id).delivered.parts, 7);
      const newcomer = await player(), original = goal(await session(newcomer));
      assert.notDeepEqual(original.stages[1].requirements, snapshot.stages[1].requirements, 'The saved goal must not be silently rebuilt from current defaults');
      assert.notDeepEqual(original.stages[1].reward, snapshot.stages[1].reward);
    });

    await t.test('all nine finite supply stages grant their exact rewards and permanent titles only once', async () => {
      const pilot = await player(), initial = await session(pilot), before = await balances(pilot);
      const spend = { ore: 0, energy: 0, parts: 0 }, rewards = { credits: 0, science: 0, crystals: 0 }, titles = new Set();
      const claimInputs = [];
      for (const definition of initial.projects) for (const [index, stage] of definition.stages.entries()) {
        for (const resource of Object.keys(spend)) spend[resource] += stage.requirements[resource];
        for (const resource of Object.keys(rewards)) rewards[resource] += stage.reward[resource];
        for (const title of stage.reward.cosmeticIds) titles.add(title);
        const ready = await fillStage(pilot, definition.id);
        assert.equal(ready.stageIndex, index);
        const input = body(ready, 'claim'), claimed = await post(pilot, input);
        assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
        claimInputs.push(input);
      }
      const expected = { ...before };
      for (const resource of Object.keys(spend)) expected[resource] -= spend[resource];
      for (const resource of Object.keys(rewards)) expected[resource] += rewards[resource];
      assert.deepEqual(await balances(pilot), expected);
      assert.equal(rewards.crystals, 55);
      const finished = await session(pilot);
      assert.ok(finished.projects.every(project => project.completed && project.stageIndex === 3 && project.completedAt && !project.ready));
      assert.equal((await progress(pilot)).length, 3);
      const owned = await sql`SELECT cosmetic_id,expires_at FROM user_cosmetics WHERE user_id=${pilot.userId} AND cosmetic_id=ANY(${sql.array([...titles])}::text[]) ORDER BY cosmetic_id`;
      assert.deepEqual(owned.map(row => row.cosmetic_id), [...titles].sort());
      assert.ok(owned.every(row => row.expires_at === null));
      for (const project of finished.projects) {
        const oldStage = { ...project, stageIndex: 2 };
        assert.equal((await post(pilot, body(oldStage, 'claim'))).status, 400);
        assert.equal((await post(pilot, body(oldStage, 'deliver', { resource: 'ore', amount: 1 }))).status, 400);
      }
      for (const input of [claimInputs[0], claimInputs.at(-1)]) assert.equal((await post(pilot, input)).status, 200);
      await session(pilot);
      assert.deepEqual(await balances(pilot), expected);
      assert.equal((await receipts(pilot)).length, 36, 'Exactly three shipments and one claim per stage have durable receipts');
      assert.deepEqual(await sql`SELECT cosmetic_id,expires_at FROM user_cosmetics WHERE user_id=${pilot.userId} AND cosmetic_id=ANY(${sql.array([...titles])}::text[]) ORDER BY cosmetic_id`, owned);
    });
  } finally {
    if (telegramIds.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(telegramIds)}::bigint[])`;
  }
}
