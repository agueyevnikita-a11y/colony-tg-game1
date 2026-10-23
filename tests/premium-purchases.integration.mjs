import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { premiumHoldConfirmed } from '../lib/client/purchase-holds.ts';

/** New random identities only; never execute against a database used for playing. */
export async function runPremiumPurchasesIntegration({ t, sql, request, initData }) {
  const database = new URL(process.env.DATABASE_URL || '');
  assert.equal(process.env.COLONY_TEST_DATABASE, '1');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.match(database.pathname, /^\/colony_(ci|test)$/);
  const createdUserIds = [];

  async function player() {
    const telegramId = crypto.randomInt(4_000_000_000_000, 8_000_000_000_000);
    const [user] = await sql`INSERT INTO users(telegram_id,first_name,colony_name,profile_completed_at)
      VALUES(${telegramId},'Premium CI',${`Покупки ${telegramId}`},now()) RETURNING id`;
    createdUserIds.push(user.id);
    await sql`INSERT INTO game_states(user_id,last_tick_at,premium_until) VALUES(${user.id},now()+interval '1 day',now()+interval '90 days')`;
    await sql`INSERT INTO beta_access(user_id,source) VALUES(${user.id},'integration_test')`;
    return { userId: user.id, telegramId };
  }
  async function session(player) {
    const reply = await request('/api/session', { method: 'POST', auth: initData(player.telegramId) });
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    assert.ok(Array.isArray(reply.data.paidPremiumPurchaseIds));
    return reply.data;
  }
  async function receipt(player, { productId = 'premium_30d', status = 'created', createdAt = new Date() } = {}) {
    const invoicePayload = `premium-test:${crypto.randomUUID()}`, charge = `premium-charge:${crypto.randomUUID()}`;
    const [row] = await sql`INSERT INTO purchases(user_id,product_id,stars_paid,invoice_payload,status,created_at,telegram_payment_charge_id)
      VALUES(${player.userId},${productId},100,${invoicePayload},${status},${createdAt},${charge}) RETURNING id`;
    return { id: row.id, invoicePayload, charge };
  }

  try {
    await t.test('Premium confirmation includes only this player\'s paid renewal, independent of an active period', async () => {
      const own = await player(), stranger = await player();
      const pending = await receipt(own), refunded = await receipt(own, { status: 'refunded' });
      const failed = await receipt(own, { status: 'failed' }), cosmetic = await receipt(own, { status: 'paid', productId: 'theme_neon' });
      const foreign = await receipt(stranger, { status: 'paid' });
      const first = await session(own);
      assert.equal(first.state.premium, true, 'A previously active period does not confirm this pending renewal');
      assert.deepEqual(first.paidPremiumPurchaseIds, []);
      for (const item of [pending, refunded, failed, cosmetic, foreign]) {
        assert.equal(premiumHoldConfirmed({ purchaseId: item.id }, first.paidPremiumPurchaseIds), false);
      }
      await sql`UPDATE purchases SET status='paid',paid_at=now() WHERE id=${pending.id} AND user_id=${own.userId}`;
      const paid = await session(own);
      assert.deepEqual(paid.paidPremiumPurchaseIds, [pending.id]);
      assert.equal(premiumHoldConfirmed({ purchaseId: pending.id }, paid.paidPremiumPurchaseIds), true);
      const other = await session(stranger);
      assert.deepEqual(other.paidPremiumPurchaseIds, [foreign.id]);
      assert.equal(premiumHoldConfirmed({ purchaseId: pending.id }, other.paidPremiumPurchaseIds), false);
      const serialized = JSON.stringify(paid);
      for (const item of [pending, refunded, failed, cosmetic, foreign]) {
        assert.equal(serialized.includes(item.invoicePayload), false, 'Invoice payload stays private');
        assert.equal(serialized.includes(item.charge), false, 'Telegram charge identifier stays private');
      }
    });

    await t.test('Premium snapshot is bounded to the newest hundred paid own receipts and does not alter purchases', async () => {
      const own = await player();
      const rows = Array.from({ length: 105 }, (_, index) => ({
        id: crypto.randomUUID(), user_id: own.userId, product_id: 'premium_30d', stars_paid: 100,
        invoice_payload: `premium-bound:${crypto.randomUUID()}`, status: 'paid',
        created_at: new Date(Date.now() - index * 60_000),
      }));
      await sql`INSERT INTO purchases ${sql(rows)}`;
      const before = [...await sql`SELECT * FROM purchases WHERE user_id=${own.userId} ORDER BY created_at DESC,id DESC`];
      const snapshot = await session(own);
      assert.deepEqual(snapshot.paidPremiumPurchaseIds, rows.slice(0, 100).map(row => row.id));
      assert.equal(premiumHoldConfirmed({ purchaseId: rows[0].id }, snapshot.paidPremiumPurchaseIds), true);
      assert.equal(premiumHoldConfirmed({ purchaseId: rows[104].id }, snapshot.paidPremiumPurchaseIds), false,
        'A missing old receipt must not auto-unlock payment for a new renewal');
      const after = [...await sql`SELECT * FROM purchases WHERE user_id=${own.userId} ORDER BY created_at DESC,id DESC`];
      assert.deepEqual(after, before, 'Reading confirmations neither grants, refunds nor changes purchases');
    });
  } finally {
    if (createdUserIds.length) await sql`DELETE FROM users WHERE id=ANY(${sql.array(createdUserIds)}::uuid[])`;
  }
}
