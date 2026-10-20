import assert from 'node:assert/strict';

export async function runInboxIntegration({ t, sql, request, initData, playerId }) {
  const createdIds = [];
  let sequence = playerId + 6000;
  const post = (player, path, body) => request(path, { method: 'POST', auth: initData(player.telegramId), body });
  const list = async (player, body = {}) => {
    const response = await post(player, '/api/inbox/list', body);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.state, undefined, 'Listing mail returns no duplicate colony state');
    return response.data.inboxPage;
  };
  async function fixture(count = 35) {
    const telegramId = sequence++;
    createdIds.push(telegramId);
    const [user] = await sql`INSERT INTO users(telegram_id,first_name) VALUES(${telegramId},'Inbox paging test') RETURNING id`;
    await sql`INSERT INTO game_states(user_id,last_tick_at) VALUES(${user.id},now()+interval '1 day')`;
    await sql`INSERT INTO player_stats(user_id) VALUES(${user.id})`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${user.id},'integration_test')`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${user.id},'hq',1,2,2,'active')`;
    const player = { userId: user.id, telegramId };
    const session = await post(player, '/api/session');
    assert.equal(session.status, 200, JSON.stringify(session.data));
    // Retain the welcome receipt so future reconciliation cannot recreate it.
    await sql`UPDATE game_inbox SET read_at=now() WHERE user_id=${user.id}`;
    const [baseline] = await sql`SELECT count(*)::integer AS total FROM game_inbox WHERE user_id=${user.id}`;
    await sql`
      INSERT INTO game_inbox(user_id,dedupe_key,title,body,created_at)
      SELECT ${user.id},'paging_'||i,'Письмо '||i,'Тестовое сообщение '||i,
        date_trunc('milliseconds',now())-interval '1 day'+(i%3)*interval '1 microsecond'
      FROM generate_series(1,${count}) i
    `;
    await sql`
      INSERT INTO game_inbox(user_id,dedupe_key,title,body,expires_at)
      VALUES(${user.id},'expired','Истекло','Истекшее сообщение',now()-interval '1 minute')
    `;
    return { ...player, total: Number(baseline.total) + count, unread: count };
  }
  async function expectedIds(player, unreadOnly = false) {
    const rows = await sql`
      SELECT id FROM game_inbox WHERE user_id=${player.userId}
        AND (expires_at IS NULL OR expires_at>now()) AND (${!unreadOnly} OR read_at IS NULL)
      ORDER BY created_at DESC,id DESC
    `;
    return rows.map(row => row.id);
  }

  try {
    await t.test('inbox pages reach every active message beyond 30 with exact counts and microsecond-safe keysets', async () => {
      const player = await fixture(42);
      const expected = await expectedIds(player);
      const seen = [];
      let cursor = null;
      do {
        const page = await list(player, { filter: 'all', limit: 5, cursor });
        assert.equal(page.total, player.total);
        assert.equal(page.unread, 42);
        assert.equal(page.matchingTotal, player.total);
        assert.ok(page.items.length <= 5);
        seen.push(...page.items.map(item => item.id));
        assert.equal(page.hasMore, page.nextCursor !== null);
        cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(seen, expected, 'Same-time UUID ties and sub-millisecond timestamps cannot skip or duplicate mail');
      assert.equal(new Set(seen).size, player.total);
      const session = await post(player, '/api/session');
      assert.equal(session.data.inbox.unread, 42, 'The badge includes unread mail beyond the first five or thirty rows');
      assert.equal(session.data.inbox.total, player.total);
      assert.equal(session.data.inbox.items.length, 5);
      assert.equal(Number((await sql`SELECT count(*) AS total FROM game_inbox WHERE user_id=${player.userId} AND read_at IS NULL`)[0].total), 43, 'Viewing and listing mail does not mark it read, including the expired row');
    });

    await t.test('reading a visible page is owned, active-only and idempotent; unread cursors do not shift after reading', async () => {
      const player = await fixture(37);
      const stranger = await fixture(2);
      const expected = await expectedIds(player, true);
      const first = await list(player, { filter: 'unread', limit: 5 });
      assert.deepEqual(first.items.map(item => item.id), expected.slice(0, 5));
      const [foreign] = await sql`SELECT id FROM game_inbox WHERE user_id=${stranger.userId} AND read_at IS NULL AND expires_at IS NULL LIMIT 1`;
      const [expired] = await sql`SELECT id FROM game_inbox WHERE user_id=${player.userId} AND dedupe_key='expired'`;
      const visible = first.items.map(item => item.id);
      const read = await post(player, '/api/inbox/read', { ids: [...visible, foreign.id, expired.id] });
      assert.equal(read.status, 200, JSON.stringify(read.data));
      assert.equal(read.data.readCount, 5);
      assert.equal(read.data.inbox.unread, 32);
      assert.equal(read.data.inboxCounts.unread, 32);
      assert.equal((await sql`SELECT read_at FROM game_inbox WHERE id=${foreign.id}`)[0].read_at, null);
      assert.equal((await sql`SELECT read_at FROM game_inbox WHERE id=${expired.id}`)[0].read_at, null);
      const retry = await post(player, '/api/inbox/read', { ids: visible });
      assert.equal(retry.status, 200, JSON.stringify(retry.data));
      assert.equal(retry.data.readCount, 0);
      assert.equal(retry.data.inbox.unread, 32);
      const next = await list(player, { filter: 'unread', limit: 5, cursor: first.nextCursor });
      assert.deepEqual(next.items.map(item => item.id), expected.slice(5, 10));
      assert.equal(next.total, player.total);
      assert.equal(next.matchingTotal, 32);
      const seen = [...visible, ...next.items.map(item => item.id)];
      let cursor = next.nextCursor;
      while (cursor) {
        const page = await list(player, { filter: 'unread', limit: 5, cursor });
        seen.push(...page.items.map(item => item.id));
        cursor = page.nextCursor;
      }
      assert.deepEqual(seen, expected, 'Reading earlier rows never shifts the keyset boundary');
      const singleId = expected[5];
      const single = await post(player, '/api/inbox/read', { id: singleId });
      assert.equal(single.status, 200, JSON.stringify(single.data));
      assert.equal(single.data.readCount, 1, 'Older single-message clients remain compatible');
      const all = await post(player, '/api/inbox/read', { all: true });
      assert.equal(all.status, 200, JSON.stringify(all.data));
      assert.equal(all.data.readCount, 31, 'Older explicit all-message clients remain compatible');
      assert.equal(all.data.inbox.unread, 0);
      assert.equal((await sql`SELECT read_at FROM game_inbox WHERE id=${expired.id}`)[0].read_at, null, 'Legacy read-all leaves expired letters untouched');
      assert.deepEqual(await expectedIds(player, true), []);
      assert.equal((await sql`SELECT read_at FROM game_inbox WHERE id=${foreign.id}`)[0].read_at, null, 'Legacy read-all remains scoped to the current player');
    });

    await t.test('inbox rejects malformed limits, filters, cursors and selections without changing hidden mail', async () => {
      const player = await fixture(34);
      const before = await expectedIds(player, true);
      for (const body of [null, [], { limit: 0 }, { limit: 31 }, { limit: 1.5 }, { limit: '5' }, { filter: 'read' }, { cursor: 'broken' }, { cursor: 3 }]) {
        const response = await post(player, '/api/inbox/list', body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.data.ok, false);
      }
      for (const body of [{}, null, [], { ids: [] }, { ids: [123] }, { ids: ['not-a-uuid'] }, { ids: Array.from({ length: 31 }, () => before[0]) }, { all: 'true' }]) {
        const response = await post(player, '/api/inbox/read', body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.data.ok, false);
      }
      assert.deepEqual(await expectedIds(player, true), before);
      const unsigned = await request('/api/inbox/list', { method: 'POST', body: {} });
      assert.notEqual(unsigned.status, 200);
      const first = await list(player, { limit: 5 });
      const other = await fixture(0);
      const otherPage = await list(other, { cursor: first.nextCursor });
      assert.ok(otherPage.items.every(item => !before.includes(item.id)), 'A foreign cursor never grants access to foreign messages');
      const readForeign = await post(other, '/api/inbox/read', { ids: before.slice(0, 5) });
      assert.equal(readForeign.status, 200, JSON.stringify(readForeign.data));
      assert.equal(readForeign.data.readCount, 0);
      assert.deepEqual(await expectedIds(player, true), before);
    });
  } finally {
    if (createdIds.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(createdIds)}::bigint[])`;
  }
}
