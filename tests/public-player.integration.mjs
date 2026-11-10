import assert from 'node:assert/strict';

// Called by the launch suite only against its guarded local colony_ci/colony_test database.
export async function runPublicPlayerIntegration({ t, sql, request, initData, playerId }) {
  const telegramIds = [];
  let sequence = playerId + 11_000;
  const [maintenance] = await sql`SELECT value FROM system_settings WHERE setting_key='maintenance'`;
  const privateName = 'PRIVATE_CITY_OWNER_NAME';
  const privateUsername = 'PRIVATE_CITY_OWNER_USERNAME';
  const post = (telegramId, path, body) => request(path, { method: 'POST', auth: initData(telegramId), body });
  async function player(colonyName, privateProfile = false) {
    const telegramId = sequence++;
    telegramIds.push(telegramId);
    const [row] = await sql`
      INSERT INTO users(telegram_id,first_name,username,colony_name,profile_bio,profile_completed_at)
      VALUES(${telegramId},${privateProfile ? privateName : 'Viewer'},${privateProfile ? privateUsername : null},${colonyName},'Лунная экспедиция',now())
      RETURNING id
    `;
    await sql`INSERT INTO game_states(user_id,hq_level,credits,last_tick_at) VALUES(${row.id},4,10000,now()+interval '1 day')`;
    await sql`INSERT INTO player_stats(user_id) VALUES(${row.id})`;
    await sql`INSERT INTO buildings(user_id,type,level,x,y,status) VALUES(${row.id},'hq',4,2,2,'active'),(${row.id},'trade_hub',1,3,3,'active')`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${row.id},'integration_test')`;
    return { userId: row.id, telegramId };
  }
  function privateFieldsAbsent(value) {
    for (const key of ['telegram_id', 'telegramId', 'first_name', 'username']) assert.equal(Object.hasOwn(value, key), false, key);
    const serialized = JSON.stringify(value);
    assert.equal(serialized.includes(privateName), false);
    assert.equal(serialized.includes(privateUsername), false);
  }
  try {
    await sql`UPDATE system_settings SET value=jsonb_set(value,'{enabled}','false'::jsonb) WHERE setting_key='maintenance'`;
    const viewer = await player('Публичный наблюдатель');
    const target = await player('Лунная гавань', true);
    const [order] = await sql`
      INSERT INTO market_orders(user_id,resource,amount_total,amount_remaining,unit_price,expires_at)
      VALUES(${target.userId},'ore',100,100,2,now()+interval '1 day') RETURNING id
    `;

    await t.test('public city UUID and legacy links preserve game data without Telegram profile', async () => {
      for (const body of [{ userId: target.userId.toUpperCase() }, { telegramId: target.telegramId }]) {
        const response = await post(viewer.telegramId, '/api/social/city', body);
        assert.equal(response.status, 200, JSON.stringify(response.data));
        const city = response.data.city;
        privateFieldsAbsent(city);
        assert.equal(city.id, target.userId);
        assert.equal(city.colony_name, 'Лунная гавань');
        assert.equal(city.profile_bio, 'Лунная экспедиция');
        assert.equal(Number(city.hq_level), 4);
        assert.equal(city.buildings.some(building => building.type === 'hq'), true);
      }
    });

    await t.test('public city rejects unauthenticated and invalid UUID requests without legacy fallback', async () => {
      const unauthenticated = await request('/api/social/city', { method: 'POST', body: { userId: target.userId } });
      assert.equal(unauthenticated.status, 400);
      assert.equal(unauthenticated.data.ok, false);
      for (const body of [{ userId: '', telegramId: target.telegramId }, { userId: `${target.userId}\n`, telegramId: target.telegramId }, { telegramId: String(target.telegramId) }]) {
        const response = await post(viewer.telegramId, '/api/social/city', body);
        assert.equal(response.status, 400, JSON.stringify(response.data));
        assert.equal(response.data.ok, false);
      }
    });

    await t.test('real market book retains seller UUID, order amount and price without Telegram profile', async () => {
      const response = await post(viewer.telegramId, '/api/session');
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.equal(response.data.limited, undefined);
      const publicOrder = response.data.market.orders.find(item => item.id === order.id);
      assert.ok(publicOrder, 'Target order must be visible to the other player');
      privateFieldsAbsent(publicOrder);
      assert.equal(publicOrder.user_id, target.userId);
      assert.equal(publicOrder.colony_name, 'Лунная гавань');
      assert.equal(Number(publicOrder.amount_remaining), 100);
      assert.equal(Number(publicOrder.unit_price), 2);
    });
  } finally {
    if (maintenance) await sql`UPDATE system_settings SET value=${sql.json(maintenance.value)} WHERE setting_key='maintenance'`;
    if (telegramIds.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(telegramIds)}::bigint[])`;
  }
}
