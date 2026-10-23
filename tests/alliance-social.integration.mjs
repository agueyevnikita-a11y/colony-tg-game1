import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';

/** Runs only inside the launch suite's isolated PostgreSQL server and signed auth. */
export async function runAllianceSocialIntegration({ t, sql, request, initData, playerId }) {
  const database = new URL(process.env.DATABASE_URL || '');
  assert.equal(process.env.COLONY_TEST_DATABASE, '1');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.match(database.pathname, /^\/colony_(ci|test)$/);
  const telegramIds = [], userIds = [], allianceIds = [], periodIds = [];
  let sequence = playerId + 12000;
  const post = (player, body) => request('/api/alliance/cooperation', { method: 'POST', auth: initData(player.telegramId), body });
  const action = (player, type, body = {}) => post(player, { action: type, requestId: crypto.randomUUID(), ...body });
  const session = async player => {
    const reply = await request('/api/session', { method: 'POST', auth: initData(player.telegramId) });
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    return reply.data;
  };
  const balances = async player => Object.fromEntries(Object.entries((await sql`
    SELECT ore,energy,parts,credits,science,crystals FROM game_states WHERE user_id=${player.userId}
  `)[0]).map(([key, value]) => [key, Number(value)]));
  const contributions = operationId => sql`SELECT * FROM alliance_cooperation_contributions WHERE operation_id=${operationId} ORDER BY id`;
  async function player() {
    const telegramId = sequence++;
    telegramIds.push(telegramId);
    const [row] = await sql`INSERT INTO users(telegram_id,first_name,colony_name,profile_completed_at)
      VALUES(${telegramId},'Social CI',${`Социальный тест ${telegramId}`},now()) RETURNING id`;
    userIds.push(row.id);
    await sql`INSERT INTO game_states(user_id,hq_level,ore,energy,parts,credits,science,crystals,last_tick_at)
      VALUES(${row.id},3,0,10000,1000,20000,1000,100,now()+interval '1 day')`;
    await sql`INSERT INTO player_stats(user_id) VALUES(${row.id})`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${row.id},'hq',3,2,2,'active')`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${row.id},'integration_test')`;
    return { userId: row.id, telegramId };
  }
  async function group(memberCount = 2, name) {
    const owner = await player(), members = [];
    const reply = await request('/api/alliance/create', {
      method: 'POST', auth: initData(owner.telegramId), body: { name: name ?? `CI ${owner.telegramId}`, expectedCreateCost: 100, expectedCreateCurrency: 'crystals' },
    });
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    const [alliance] = await sql`SELECT id,code FROM alliances WHERE owner_user_id=${owner.userId}`;
    assert.ok(alliance);
    allianceIds.push(alliance.id);
    for (let i = 0; i < memberCount; i++) {
      const member = await player();
      const joined = await request('/api/alliance/join', { method: 'POST', auth: initData(member.telegramId), body: { code: alliance.code } });
      assert.equal(joined.status, 200, JSON.stringify(joined.data));
      members.push(member);
    }
    return { owner, members, ...alliance };
  }
  async function start(owner) {
    const reply = await action(owner, 'start');
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    assert.ok(reply.data.result.operationId);
    return reply.data.result.operationId;
  }
  async function finish(operationId) {
    await sql`UPDATE alliance_cooperation_operations SET started_at=now()-interval '7 hours',ends_at=now()-interval '1 hour' WHERE id=${operationId}`;
  }
  async function unit(player, operationId, role = 'power', requestId = crypto.randomUUID()) {
    const reply = await post(player, { action: 'contribute', requestId, operationId, role });
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    return reply;
  }
  async function directory(player, body = {}) {
    const reply = await request('/api/alliance/directory', { method: 'POST', auth: initData(player.telegramId), body });
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    assert.equal(reply.data.ok, true);
    return reply.data.directory;
  }

  async function queuedBoundary(kind) {
    const team = await group(0), operationId = await start(team.owner);
    const game = await session(team.owner), periodId = game.alliance.competition.period.id;
    const [originalPeriod] = await sql`SELECT starts_at,ends_at,finalized_at FROM alliance_competition_periods WHERE id=${periodId}`;
    assert.equal(originalPeriod.finalized_at, null);
    const before = await balances(team.owner), requestId = crypto.randomUUID();
    // Separate connections are essential: the launch helper deliberately has max:1.
    const probe = postgres(database.toString(), { max: 2, connect_timeout: 5, connection: {
      application_name: 'colony_social_boundary_test', statement_timeout: 20000, lock_timeout: 15000,
    } });
    let unblock, signalReady, rejectReady, expireWeek = false, apiPromise;
    const gate = new Promise(resolve => { unblock = resolve; });
    const ready = new Promise((resolve, reject) => { signalReady = resolve; rejectReady = reject; });
    const blocker = probe.begin(async tx => {
      await tx`SELECT id FROM alliance_competition_periods WHERE id=${periodId} FOR UPDATE`;
      signalReady();
      await gate;
      if (expireWeek) await tx`UPDATE alliance_competition_periods
        SET starts_at=clock_timestamp()-interval '8 days',ends_at=clock_timestamp()-interval '1 second' WHERE id=${periodId}`;
    });
    blocker.catch(rejectReady);
    try {
      await ready;
      let fixedOperationEnd;
      if (kind === 'operation') {
        const [shortened] = await sql`UPDATE alliance_cooperation_operations
          SET started_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()+interval '8 seconds'
          WHERE id=${operationId} RETURNING ends_at`;
        fixedOperationEnd = shortened.ends_at;
      }
      let replySettled = false;
      apiPromise = post(team.owner, { action: 'contribute', requestId, operationId, role: 'power' });
      apiPromise.then(() => { replySettled = true; }, () => { replySettled = true; });
      let queued = false;
      const queueDeadline = Date.now() + 11000;
      while (Date.now() < queueDeadline && !replySettled) {
        const [waiting] = await probe`SELECT EXISTS(
          SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
            AND application_name<>'colony_social_boundary_test'
            AND query ILIKE '%SELECT finalized_at%alliance_competition_periods%FOR UPDATE%'
        ) AS queued`;
        if (waiting.queued) { queued = true; break; }
        await delay(40);
      }
      assert.equal(queued, true, 'The real contribution must wait at the competition-record lock, after its initial checks');
      if (kind === 'week') expireWeek = true;
      else {
        const clockDeadline = Date.now() + 11000;
        let expired = false;
        while (Date.now() < clockDeadline) {
          const [clock] = await probe`SELECT clock_timestamp()>=${fixedOperationEnd} AS expired`;
          if (clock.expired) { expired = true; break; }
          await delay(40);
        }
        assert.equal(expired, true, 'The fixed operation deadline must pass while the real request is queued');
      }
      unblock();
      await blocker;
      const reply = await apiPromise;
      assert.equal(reply.status, 400, JSON.stringify(reply.data));
      assert.match(reply.data.error, kind === 'week' ? /Неделя лиги сменилась/ : /Операция добычи завершилась/);
      assert.deepEqual(await balances(team.owner), before, 'A request accepted too late must roll back every charged resource');
      assert.equal((await contributions(operationId)).length, 0);
      assert.equal(Number((await sql`SELECT count(*) AS count FROM alliance_competition_entries WHERE user_id=${team.owner.userId}`)[0].count), 0);
      assert.equal(Number((await sql`SELECT count(*) AS count FROM alliance_competition_bindings WHERE user_id=${team.owner.userId}`)[0].count), 0);
      assert.equal(Number((await sql`SELECT count(*) AS count FROM alliance_cooperation_requests WHERE user_id=${team.owner.userId} AND request_id=${requestId}`)[0].count), 0);
    } finally {
      unblock();
      await blocker.catch(() => {});
      if (apiPromise) await apiPromise.catch(() => {});
      // Restore the real current week before any further API/session can finalize it.
      await sql`UPDATE alliance_competition_periods SET starts_at=${originalPeriod.starts_at},ends_at=${originalPeriod.ends_at},finalized_at=${originalPeriod.finalized_at} WHERE id=${periodId}`;
      await probe.end({ timeout: 2 });
    }
  }

  try {
    await t.test('cooperative operations require membership and concurrent free starts create one six-hour operation', async () => {
      const outsider = await player(), team = await group(1);
      const outsideBefore = await balances(outsider);
      assert.equal((await action(outsider, 'start')).status, 400);
      assert.deepEqual(await balances(outsider), outsideBefore);
      const before = await balances(team.owner);
      const replies = await Promise.all([action(team.owner, 'start'), action(team.members[0], 'start')]);
      assert.ok(replies.every(reply => reply.status === 200), JSON.stringify(replies));
      const rows = await sql`SELECT * FROM alliance_cooperation_operations WHERE alliance_id=${team.id}`;
      assert.equal(rows.length, 1);
      assert.equal(new Date(rows[0].ends_at).getTime() - new Date(rows[0].started_at).getTime(), 6 * 3600_000);
      assert.deepEqual(await balances(team.owner), before);
      assert.deepEqual(replies.map(reply => reply.data.result.operationId), [rows[0].id, rows[0].id]);
    });

    await t.test('contribution receipts charge once, reject conflicting replay and cap concurrent units at three', async () => {
      const team = await group(0), operationId = await start(team.owner);
      const requestId = crypto.randomUUID(), before = await balances(team.owner);
      const body = { action: 'contribute', requestId, operationId, role: 'drilling' };
      const replies = await Promise.all([post(team.owner, body), post(team.owner, body)]);
      assert.ok(replies.every(reply => reply.status === 200), JSON.stringify(replies));
      assert.equal((await contributions(operationId)).length, 1);
      assert.deepEqual(await balances(team.owner), { ...before, energy: before.energy - 100, parts: before.parts - 10 });
      const conflicting = await post(team.owner, { ...body, role: 'power' });
      assert.equal(conflicting.status, 400, JSON.stringify(conflicting.data));
      const more = await Promise.all(Array.from({ length: 4 }, () => action(team.owner, 'contribute', { operationId, role: 'power' })));
      assert.equal(more.filter(reply => reply.status === 200).length, 2, JSON.stringify(more));
      assert.ok(more.every(reply => [200, 400].includes(reply.status)), JSON.stringify(more));
      assert.equal((await contributions(operationId)).length, 3);
      assert.deepEqual(await balances(team.owner), { ...before, energy: before.energy - 500, parts: before.parts - 10 });
      const retry = await post(team.owner, body);
      assert.equal(retry.status, 200, JSON.stringify(retry.data));
      assert.equal(retry.data.result.contributionId, replies[0].data.result.contributionId);
      assert.equal((await contributions(operationId)).length, 3);
    });

    await t.test('malformed, foreign and unaffordable cooperative requests preserve balances and ledgers', async () => {
      const team = await group(1), other = await group(0), operationId = await start(team.owner);
      const before = await balances(team.members[0]), otherBefore = await balances(other.owner);
      for (const body of [null, [], {}, { action: 'contribute' }, { action: 'contribute', requestId: crypto.randomUUID(), operationId, role: 'unknown' },
        { action: 'contribute', requestId: 'invalid', operationId, role: 'power' }, { action: 'claim', requestId: crypto.randomUUID(), operationId: 'invalid' }]) {
        assert.equal((await post(team.members[0], body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await action(other.owner, 'contribute', { operationId, role: 'power' })).status, 400);
      await sql`UPDATE game_states SET energy=199 WHERE user_id=${team.members[0].userId}`;
      const shortBefore = await balances(team.members[0]);
      assert.equal((await action(team.members[0], 'contribute', { operationId, role: 'power' })).status, 400);
      assert.deepEqual(await balances(team.members[0]), shortBefore);
      assert.equal((await contributions(operationId)).length, 0);
      assert.deepEqual(await balances(other.owner), otherBefore);
      assert.equal(before.parts, shortBefore.parts);
    });

    await t.test('three real participants and roles settle one team bonus and award shared science once', async () => {
      const team = await group(2), operationId = await start(team.owner);
      await unit(team.owner, operationId, 'drilling');
      await unit(team.members[0], operationId, 'power');
      await unit(team.members[1], operationId, 'analysis');
      assert.equal((await action(team.owner, 'claim', { operationId })).status, 400, 'The six-hour operation cannot be claimed early');
      await finish(operationId);
      await Promise.all([session(team.owner), session(team.members[0]), session(team.members[1])]);
      const [operation] = await sql`SELECT * FROM alliance_cooperation_operations WHERE id=${operationId}`;
      assert.equal(operation.status, 'settled');
      assert.equal(Number(operation.team_bonus_percent), 20);
      assert.equal(Number(operation.shared_science_awarded), 6);
      const [progress] = await sql`SELECT * FROM alliance_cooperation_progress WHERE alliance_id=${team.id}`;
      assert.equal(Number(progress.shared_science), 6);
      await session(team.owner);
      assert.equal(Number((await sql`SELECT shared_science FROM alliance_cooperation_progress WHERE alliance_id=${team.id}`)[0].shared_science), 6);
      const before = await balances(team.owner);
      const claimed = await action(team.owner, 'claim', { operationId });
      assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
      assert.deepEqual(claimed.data.result.reward, { ore: 420, credits: 50, science: 5 });
      assert.deepEqual(await balances(team.owner), { ...before, ore: before.ore + 420, credits: before.credits + 50, science: before.science + 5 });
    });

    await t.test('full storage keeps the whole mining reward pending and concurrent claims pay it once', async () => {
      const team = await group(0), operationId = await start(team.owner);
      await unit(team.owner, operationId, 'drilling');
      await finish(operationId);
      await sql`UPDATE game_states SET ore=2000 WHERE user_id=${team.owner.userId}`;
      await session(team.owner);
      const blockedBefore = await balances(team.owner);
      const blocked = await action(team.owner, 'claim', { operationId });
      assert.equal(blocked.status, 400, JSON.stringify(blocked.data));
      assert.deepEqual(await balances(team.owner), blockedBefore);
      assert.ok((await contributions(operationId)).every(row => row.claimed_at === null));
      await sql`UPDATE game_states SET ore=0 WHERE user_id=${team.owner.userId}`;
      const before = await balances(team.owner);
      const claimBody = { action: 'claim', requestId: crypto.randomUUID(), operationId };
      const replies = await Promise.all([post(team.owner, claimBody), post(team.owner, claimBody)]);
      assert.ok(replies.every(reply => reply.status === 200), JSON.stringify(replies));
      assert.deepEqual(await balances(team.owner), { ...before, ore: 350, credits: before.credits + 50, science: before.science + 5 });
      assert.ok((await contributions(operationId)).every(row => row.claimed_at));
    });

    await t.test('leaving and deletion of a small alliance cannot remove already funded mining rewards', async () => {
      const team = await group(1), member = team.members[0], operationId = await start(team.owner);
      const requestId = crypto.randomUUID();
      await unit(member, operationId, 'power', requestId);
      const leave = await request('/api/alliance/leave', { method: 'POST', auth: initData(member.telegramId), body: {} });
      assert.equal(leave.status, 200, JSON.stringify(leave.data));
      const ownerLeave = await request('/api/alliance/leave', { method: 'POST', auth: initData(team.owner.telegramId), body: {} });
      assert.equal(ownerLeave.status, 200, JSON.stringify(ownerLeave.data));
      assert.equal((await sql`SELECT id FROM alliances WHERE id=${team.id}`).length, 0);
      assert.equal((await contributions(operationId)).length, 1);
      const before = await balances(member);
      const replay = await post(member, { action: 'contribute', requestId, operationId, role: 'power' });
      assert.equal(replay.status, 200, JSON.stringify(replay.data));
      assert.deepEqual(await balances(member), before);
      await finish(operationId);
      await session(member);
      const claim = await action(member, 'claim', { operationId });
      assert.equal(claim.status, 200, JSON.stringify(claim.data));
      assert.deepEqual(await balances(member), { ...before, ore: before.ore + 240, credits: before.credits + 50, science: before.science + 5 });
    });

    await t.test('alliance research is role-gated, replay-safe and snapshots benefits only into new operations', async () => {
      const team = await group(1), operationId = await start(team.owner);
      await sql`UPDATE alliance_cooperation_progress SET shared_science=1000 WHERE alliance_id=${team.id}`;
      const denied = await action(team.members[0], 'research', { technologyId: 'drilling', expectedLevel: 0 });
      assert.equal(denied.status, 400, JSON.stringify(denied.data));
      assert.equal(Number((await sql`SELECT shared_science FROM alliance_cooperation_progress WHERE alliance_id=${team.id}`)[0].shared_science), 1000);
      const body = { action: 'research', requestId: crypto.randomUUID(), technologyId: 'drilling', expectedLevel: 0 };
      const replies = await Promise.all([post(team.owner, body), post(team.owner, body)]);
      assert.ok(replies.every(reply => reply.status === 200), JSON.stringify(replies));
      const [progress] = await sql`SELECT * FROM alliance_cooperation_progress WHERE alliance_id=${team.id}`;
      assert.equal(Number(progress.drilling_level), 1);
      assert.equal(Number(progress.shared_science), 900);
      const stale = await action(team.owner, 'research', { technologyId: 'drilling', expectedLevel: 0 });
      assert.equal(stale.status, 400, 'A fresh UUID cannot spend twice from a stale displayed level');
      assert.equal(Number((await sql`SELECT shared_science FROM alliance_cooperation_progress WHERE alliance_id=${team.id}`)[0].shared_science), 900);
      assert.equal(Number((await sql`SELECT drilling_level FROM alliance_cooperation_operations WHERE id=${operationId}`)[0].drilling_level), 0);
      const during = (await session(team.owner)).alliance.cooperation;
      assert.equal(during.progress.technologies.find(technology => technology.id === 'drilling').level, 1);
      assert.equal(during.current.technologySnapshot.drilling, 0);
      assert.equal(during.roleOptions.find(role => role.id === 'drilling').reward.ore, 350);
      const accepted = await unit(team.owner, operationId, 'drilling');
      assert.equal(accepted.data.result.reward.ore, 350, 'The displayed quote and paid unit both use the operation snapshot');
      await finish(operationId);
      await session(team.owner);
      const nextId = await start(team.owner);
      assert.notEqual(nextId, operationId);
      assert.equal(Number((await sql`SELECT drilling_level FROM alliance_cooperation_operations WHERE id=${nextId}`)[0].drilling_level), 1);
      assert.equal((await session(team.owner)).alliance.cooperation.roleOptions.find(role => role.id === 'drilling').reward.ore, 367);
    });

    await t.test('weekly credit stays with the first alliance instead of moving legacy SP or following a new membership', async () => {
      const first = await group(1), second = await group(0), member = first.members[0];
      await sql`INSERT INTO season_progress(user_id,season_id,points) VALUES(${member.userId},'s1_first_signal',999999)
        ON CONFLICT(user_id,season_id) DO UPDATE SET points=EXCLUDED.points`;
      await sql`INSERT INTO alliance_season_points(alliance_id,season_id,points) VALUES(${first.id},'s1_first_signal',999999)
        ON CONFLICT(alliance_id,season_id) DO UPDATE SET points=EXCLUDED.points`;
      const initial = await session(member);
      assert.equal(initial.alliance.competition.me.points, 0);
      const firstOperation = await start(first.owner);
      const accepted = await unit(member, firstOperation);
      assert.deepEqual(accepted.data.result.competition, { points: 10, eligible: true });
      let competition = (await session(member)).alliance.competition;
      assert.equal(competition.me.points, 10);
      assert.equal(competition.binding.allianceId, first.id);
      const left = await request('/api/alliance/leave', { method: 'POST', auth: initData(member.telegramId), body: {} });
      assert.equal(left.status, 200, JSON.stringify(left.data));
      // Only this isolated test identity passes the already-tested rejoin timer.
      await sql`UPDATE users SET alliance_left_at=now()-interval '25 hours' WHERE id=${member.userId}`;
      const joined = await request('/api/alliance/join', { method: 'POST', auth: initData(member.telegramId), body: { code: second.code } });
      assert.equal(joined.status, 200, JSON.stringify(joined.data));
      const secondOperation = await start(second.owner), before = await balances(member);
      const helped = await unit(member, secondOperation);
      assert.deepEqual(helped.data.result.competition, { points: 0, eligible: false });
      assert.equal((await contributions(secondOperation)).length, 1, 'Mining help remains useful after changing alliances');
      assert.equal((await balances(member)).energy, before.energy - 200);
      competition = (await session(member)).alliance.competition;
      assert.equal(competition.me.points, 10);
      assert.equal(competition.binding.allianceId, first.id);
      assert.equal(competition.alliances.find(row => row.allianceId === first.id).points, 10);
      assert.equal(competition.alliances.some(row => row.allianceId === second.id), false);
      const current = competition.period.id;
      assert.equal(Number((await sql`SELECT count(*) AS count FROM alliance_competition_entries WHERE period_id=${current} AND user_id=${member.userId}`)[0].count), 1);
    });

    await t.test('ended weekly ranks and the finite team pool freeze once, surviving membership changes and concurrent claims', async () => {
      const team = await group(2), solo = await group(0), [early, late] = team.members;
      const periodId = `test-social-${crypto.randomUUID()}`;
      periodIds.push(periodId);
      const startsAt = new Date(Date.now() - 15 * 86_400_000), endsAt = new Date(Date.now() - 8 * 86_400_000);
      await sql`INSERT INTO alliance_competition_periods(id,starts_at,ends_at) VALUES(${periodId},${startsAt},${endsAt})`;
      async function entry(player, index, minute, alliance = team) {
        const createdAt = new Date(startsAt.getTime() + minute * 60_000 + index);
        await sql`INSERT INTO alliance_competition_entries(source_id,period_id,user_id,alliance_id,alliance_name,points,created_at)
          VALUES(${crypto.randomUUID()},${periodId},${player.userId},${alliance.id},'Snapshot CI',10,${createdAt})`;
      }
      for (let i = 0; i < 4; i++) await entry(team.owner, i, 10);
      for (let i = 0; i < 2; i++) await entry(early, i, 20);
      for (let i = 0; i < 2; i++) await entry(late, i, 30);
      for (let i = 0; i < 2; i++) await entry(solo.owner, i, 40, solo);
      await Promise.all([session(team.owner), session(early)]);
      const frozen = await sql`SELECT * FROM alliance_competition_standings WHERE period_id=${periodId} ORDER BY kind,rank`;
      assert.deepEqual(frozen.filter(row => row.kind === 'personal').map(row => [row.entity_id, Number(row.points), Number(row.rank)]),
        [[team.owner.userId, 40, 1], [early.userId, 20, 2], [late.userId, 20, 3], [solo.owner.userId, 20, 4]]);
      assert.deepEqual(frozen.filter(row => row.kind === 'alliance').map(row => [row.entity_id, Number(row.points), row.rank === null ? null : Number(row.rank)]), [[team.id, 80, 1], [solo.id, 20, null]]);
      const awards = await sql`SELECT * FROM alliance_competition_awards WHERE period_id=${periodId} ORDER BY user_id,kind`;
      assert.equal(awards.length, 7);
      assert.equal(awards.some(row => row.user_id === solo.owner.userId && row.kind === 'alliance'), false, 'A one-person alliance cannot take a team prize pool');
      assert.equal(Number(awards.find(row => row.user_id === solo.owner.userId && row.kind === 'personal').crystals), 50);
      assert.equal(awards.filter(row => row.kind === 'alliance').reduce((sum, row) => sum + Number(row.crystals), 0), 600);
      assert.deepEqual(awards.filter(row => row.kind === 'alliance').map(row => Number(row.crystals)).sort((a, b) => a - b), [170, 170, 260]);
      assert.ok((await sql`SELECT finalized_at FROM alliance_competition_periods WHERE id=${periodId}`)[0].finalized_at);

      const claim = player => request('/api/alliance/competition/claim', { method: 'POST', auth: initData(player.telegramId), body: { periodId } });
      const before = await balances(team.owner);
      const replies = await Promise.all([claim(team.owner), claim(team.owner)]);
      assert.ok(replies.every(reply => reply.status === 200), JSON.stringify(replies));
      assert.equal(replies.reduce((sum, reply) => sum + reply.data.result.count, 0), 2);
      assert.equal(replies.reduce((sum, reply) => sum + reply.data.result.crystals, 0), 360);
      assert.deepEqual(await balances(team.owner), { ...before, crystals: before.crystals + 360 });
      const ownerCosmetics = await sql`SELECT cosmetic_id FROM user_cosmetics WHERE user_id=${team.owner.userId} AND source LIKE ${`competition_${periodId}%`} ORDER BY cosmetic_id`;
      assert.deepEqual(ownerCosmetics.map(row => row.cosmetic_id), ['badge_coop_champion', 'frame_coop_team', 'title_coop_vanguard']);

      // The source history can no longer be used to recalculate awarded places.
      await entry(late, 0, 40);
      await sql`DELETE FROM alliances WHERE id=${team.id}`;
      await session(early);
      assert.deepEqual(await sql`SELECT * FROM alliance_competition_standings WHERE period_id=${periodId} ORDER BY kind,rank`, frozen);
      const earlyBefore = await balances(early), ownBeforeRetry = await balances(team.owner);
      const earned = await claim(early);
      assert.equal(earned.status, 200, JSON.stringify(earned.data));
      assert.equal(earned.data.result.crystals, 245);
      assert.deepEqual(await balances(early), { ...earlyBefore, crystals: earlyBefore.crystals + 245 });
      const retry = await claim(team.owner);
      assert.equal(retry.status, 200, JSON.stringify(retry.data));
      assert.equal(retry.data.result.count, 0);
      assert.deepEqual(await balances(team.owner), ownBeforeRetry);
      assert.deepEqual(await sql`SELECT cosmetic_id FROM user_cosmetics WHERE user_id=${team.owner.userId} AND source LIKE ${`competition_${periodId}%`} ORDER BY cosmetic_id`, ownerCosmetics);
    });

    await t.test('alliance discovery validates requests, excludes full groups and exposes the real rejoin deadline', async () => {
      const visitor = await player(), full = await group(1), team = await group(1);
      const before = await balances(visitor);
      for (const body of [null, [], 'bad', { query: 1 }, { query: 'x'.repeat(65) },
        { page: -1 }, { page: 100 }, { page: 0.5 }, { page: '1' }, { page: null }]) {
        const reply = await request('/api/alliance/directory', { method: 'POST', auth: initData(visitor.telegramId), body });
        assert.equal(reply.status, 400, JSON.stringify({ body, reply }));
      }
      assert.equal((await request('/api/alliance/directory', { method: 'POST', body: {} })).status, 400);
      await sql`UPDATE alliances SET member_limit=2 WHERE id=${full.id}`;
      assert.equal((await directory(visitor, { query: full.code })).items.length, 0);
      const initial = await session(visitor);
      assert.equal(initial.alliance.entry.availableAt, null);
      assert.equal(initial.alliance.directory.query, '');
      assert.equal(initial.alliance.directory.page, 0);
      assert.ok(initial.alliance.directory.items.length <= 5);
      assert.deepEqual(await balances(visitor), before);

      const member = team.members[0];
      assert.equal((await session(member)).alliance.entry.availableAt, null);
      const left = await request('/api/alliance/leave', { method: 'POST', auth: initData(member.telegramId), body: {} });
      assert.equal(left.status, 200, JSON.stringify(left.data));
      const [leftAt] = await sql`SELECT alliance_left_at FROM users WHERE id=${member.userId}`;
      const entry = (await session(member)).alliance.entry;
      assert.equal(Date.parse(entry.availableAt), new Date(leftAt.alliance_left_at).getTime() + 24 * 3_600_000);
      assert.equal((await request('/api/alliance/join', { method: 'POST', auth: initData(member.telegramId), body: { code: team.code } })).status, 400);
    });

    await t.test('alliance discovery searches names and codes literally and pages matching Unicode names without overlap', async () => {
      const visitor = await player(), prefix = `ЛуНа ${crypto.randomBytes(4).toString('hex')}`;
      const teams = [];
      for (let index = 0; index < 7; index++) teams.push(await group(0, `${prefix}${index === 0 ? '_' : 'Х'}${index}`));
      const first = await directory(visitor, { query: `  ${prefix.toLocaleLowerCase('ru-RU')}  `, page: 0 });
      const second = await directory(visitor, { query: prefix.toLocaleUpperCase('ru-RU'), page: 1 });
      assert.equal(first.query, prefix.toLocaleLowerCase('ru-RU'));
      assert.equal(first.page, 0);
      assert.equal(first.items.length, 5);
      assert.equal(first.hasMore, true);
      assert.equal(second.page, 1);
      assert.equal(second.items.length, 2);
      assert.equal(second.hasMore, false);
      const ids = [...first.items, ...second.items].map(item => item.id);
      assert.equal(new Set(ids).size, 7);
      assert.deepEqual([...ids].sort(), teams.map(team => team.id).sort());
      assert.deepEqual((await directory(visitor, { query: `${prefix}_` })).items.map(item => item.id), [teams[0].id]);
      assert.deepEqual((await directory(visitor, { query: '%' })).items, []);
      assert.deepEqual((await directory(visitor, { query: `${prefix}\\` })).items, []);
      assert.deepEqual((await directory(visitor, { query: teams[0].code.toLowerCase() })).items.map(item => item.id), [teams[0].id]);
      const last = await directory(visitor, { query: prefix, page: 99 });
      assert.equal(last.page, 99);
      assert.deepEqual(last.items, []);
      assert.equal(last.hasMore, false);
    });

    await t.test('alliance discovery counts real seven-day modules independently and ranks distinct contributors before member count', async () => {
      const visitor = await player(), prefix = `Руда ${crypto.randomBytes(4).toString('hex')}`;
      const single = await group(2, `${prefix} А`), shared = await group(2, `${prefix} Б`), idle = await group(3, `${prefix} В`);
      const singleOperation = await start(single.owner), sharedOperation = await start(shared.owner);
      const idleOperation = await start(idle.owner), receipt = crypto.randomUUID();
      await unit(single.owner, singleOperation, 'power', receipt);
      await unit(single.owner, singleOperation, 'power', receipt);
      await unit(single.owner, singleOperation, 'drilling');
      await unit(single.owner, singleOperation, 'analysis');
      await unit(shared.owner, sharedOperation, 'power');
      await unit(shared.members[0], sharedOperation, 'drilling');
      await unit(shared.members[1], sharedOperation, 'analysis');
      await sql`UPDATE alliance_season_points SET points=999999 WHERE alliance_id=${single.id}`;
      const [old] = await sql`INSERT INTO alliance_cooperation_operations(alliance_id,alliance_name,status,started_at,ends_at,settled_at)
        VALUES(${single.id},'Old CI','settled',now()-interval '10 days',now()-interval '9 days',now()-interval '9 days') RETURNING id`;
      await sql`INSERT INTO alliance_cooperation_contributions(operation_id,user_id,role,cost_json,reward_json,created_at)
        VALUES(${old.id},${single.members[0].userId},'power','{"energy":200}'::jsonb,'{"ore":240,"credits":50,"science":5}'::jsonb,now()-interval '8 days'),
          (${old.id},${single.members[1].userId},'power','{"energy":200}'::jsonb,'{"ore":240,"credits":50,"science":5}'::jsonb,now()+interval '1 day')`;
      await sql`UPDATE alliance_cooperation_contributions SET claimed_at=now() WHERE operation_id=${singleOperation} AND role='analysis'`;
      const found = await directory(visitor, { query: prefix });
      assert.deepEqual(found.items.map(item => [item.id, item.modules7d, item.contributors7d, item.members]),
        [[shared.id, 3, 3, 3], [single.id, 3, 1, 3], [idle.id, 0, 0, 4]]);
      for (const item of found.items) {
        assert.deepEqual(Object.keys(item).sort(), ['code', 'contributors7d', 'id', 'memberLimit', 'members', 'modules7d', 'name', 'operation'].sort());
        assert.deepEqual(Object.keys(item.operation).sort(), ['endsAt', 'participants', 'roles']);
      }
      assert.equal(found.items[0].operation.participants, 3);
      assert.deepEqual([...found.items[0].operation.roles].sort(), ['analysis', 'drilling', 'power']);
      assert.equal(found.items[1].operation.participants, 1);
      assert.equal(found.items[2].operation.participants, 0);
      assert.deepEqual(found.items[2].operation.roles, []);
      assert.ok(idleOperation);
    });

    await t.test('mining team breakdown retains paid leavers without leaking old teammates into personal cargo or another guild', async () => {
      const team = await group(2), member = team.members[0], outsider = await player(), operationId = await start(team.owner);
      await unit(team.owner, operationId, 'drilling');
      await unit(team.owner, operationId, 'power');
      await unit(member, operationId, 'analysis');
      const own = (await session(team.owner)).alliance.cooperation.current;
      assert.equal(own.team.length, 2, 'Idle members must not appear as funded participants');
      assert.equal(own.team.reduce((sum, row) => sum + row.units, 0), 3);
      const self = own.team.find(row => row.isMe), teammate = own.team.find(row => !row.isMe);
      assert.equal(self.units, 2);
      assert.deepEqual(self.roles.map(role => [role.id, role.units]).sort(), [['drilling', 1], ['power', 1]]);
      assert.equal(teammate.name, `Социальный тест ${member.telegramId}`);
      assert.equal(teammate.units, 1);
      assert.deepEqual(teammate.roles, [{ id: 'analysis', units: 1 }]);
      for (const row of own.team) {
        assert.equal(row.isCurrentMember, true);
        assert.equal(row.roles.reduce((sum, role) => sum + role.units, 0), row.units);
        assert.deepEqual(Object.keys(row).sort(), ['isCurrentMember', 'isMe', 'name', 'roles', 'units']);
      }
      const publicState = (await session(outsider)).alliance.cooperation;
      assert.equal(publicState.current, null);
      assert.deepEqual(publicState.pending, []);
      const left = await request('/api/alliance/leave', { method: 'POST', auth: initData(member.telegramId), body: {} });
      assert.equal(left.status, 200, JSON.stringify(left.data));
      const afterLeave = (await session(team.owner)).alliance.cooperation.current;
      assert.equal(afterLeave.team.length, 2);
      assert.equal(afterLeave.team.find(row => row.name === teammate.name).isCurrentMember, false);
      assert.equal(afterLeave.team.reduce((sum, row) => sum + row.units, 0), 3);
      const cargo = (await session(member)).alliance.cooperation;
      assert.equal(cargo.current, null);
      assert.equal(cargo.pending.length, 1);
      assert.equal(cargo.pending[0].units, 1);
      assert.ok(cargo.pending.every(row => !Object.hasOwn(row, 'team')));
      assert.equal(JSON.stringify(cargo.pending).includes(self.name), false);
      const next = await group(0);
      await start(next.owner);
      await sql`UPDATE users SET alliance_left_at=now()-interval '25 hours' WHERE id=${member.userId}`;
      const joined = await request('/api/alliance/join', { method: 'POST', auth: initData(member.telegramId), body: { code: next.code } });
      assert.equal(joined.status, 200, JSON.stringify(joined.data));
      const moved = (await session(member)).alliance.cooperation;
      assert.equal(moved.current.allianceId, next.id);
      assert.deepEqual(moved.current.team, []);
      assert.equal(moved.pending.length, 1);
      assert.equal(moved.pending[0].id, operationId);
      assert.ok(moved.pending.every(row => !Object.hasOwn(row, 'team')));
      assert.equal(JSON.stringify(moved).includes(self.name), false);
    });

    await t.test('a contribution queued across the weekly cutoff rolls back resources, mining and competition receipts', async () => {
      await queuedBoundary('week');
    });

    await t.test('a contribution queued until its fixed operation deadline rolls back the whole transaction', async () => {
      await queuedBoundary('operation');
    });
  } finally {
    // New reward histories deliberately survive alliance deletion, so remove only
    // this helper's own operations and request receipts before its random users.
    if (allianceIds.length) await sql`DELETE FROM alliance_cooperation_operations WHERE alliance_id=ANY(${sql.array(allianceIds)}::uuid[])`;
    if (telegramIds.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(telegramIds)}::bigint[])`;
    for (const periodId of periodIds) {
      await sql`DELETE FROM alliance_competition_awards WHERE period_id=${periodId}`;
      await sql`DELETE FROM alliance_competition_standings WHERE period_id=${periodId}`;
      await sql`DELETE FROM alliance_competition_entries WHERE period_id=${periodId}`;
      await sql`DELETE FROM alliance_competition_bindings WHERE period_id=${periodId}`;
      await sql`DELETE FROM alliance_competition_periods WHERE id=${periodId}`;
    }
  }
}
