import { NextResponse } from 'next/server';
import { sql } from '@/lib/server/db';
import { logErrorEvent } from '@/lib/server/errors';
import { fulfillPurchase, markRefundedPurchase } from '@/lib/server/payments';
import { botUsername, buildBotReply, parseBotUpdate } from '@/lib/server/bot-commands';
import { callTelegramApi, matchesWebhookSecret, withDeadline } from '@/lib/server/telegram-api';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return new NextResponse('webhook unavailable', { status: 503 });
  if (!matchesWebhookSecret(request.headers.get('x-telegram-bot-api-secret-token'), secret)) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  let update;
  try {
    update = parseBotUpdate(await request.json(), botUsername());
  } catch {
    // Malformed or unauthenticated requests must never reach the database, including telemetry.
    return NextResponse.json({ ok: false, error: 'invalid_update' }, { status: 400 });
  }
  if (update.kind === 'ignore') return NextResponse.json({ ok: true });
  const token = process.env.BOT_TOKEN;
  if (!token) return new NextResponse('webhook unavailable', { status: 503 });

  try {
    if (update.kind === 'pre_checkout') {
      const query = update.query;
      let valid = false;
      try {
        // Telegram requires a reply within 10 seconds. Reserve time for the API call even if DB stalls.
        const rows = await withDeadline(sql<any[]>`
          SELECT p.*,u.telegram_id FROM purchases p JOIN users u ON u.id=p.user_id
          WHERE p.invoice_payload=${query.invoice_payload} AND p.status='created' LIMIT 1
        `, 2500);
        const purchase = rows[0];
        valid = !!purchase && query.currency === 'XTR' && query.total_amount === Number(purchase.stars_paid)
          && query.userId === Number(purchase.telegram_id);
      } catch {
        // Decline safely when the purchase cannot be verified; do not wait on error telemetry here.
      }
      await callTelegramApi(token, 'answerPreCheckoutQuery', {
        pre_checkout_query_id: query.id,
        ok: valid,
        ...(valid ? {} : { error_message: 'Платёж не прошёл проверку. Откройте магазин и попробуйте снова. Помощь: /paysupport.' }),
      });
      return NextResponse.json({ ok: true });
    }

    if (update.kind === 'command') {
      await callTelegramApi(token, 'sendMessage', buildBotReply(update));
    } else if (update.kind === 'write_access_allowed') {
      await sql`UPDATE users SET bot_write_allowed=true WHERE telegram_id=${update.userId}`;
    } else if (update.kind === 'payment') {
      const { payment, userId } = update;
      await sql.begin(async tx => {
        const purchase = (await tx<any[]>`
          SELECT p.*,u.telegram_id FROM purchases p JOIN users u ON u.id=p.user_id
          WHERE p.invoice_payload=${payment.invoice_payload} FOR UPDATE OF p
        `)[0];
        if (!purchase) throw new Error('Unknown invoice payload');
        if (payment.currency !== 'XTR' || payment.total_amount !== Number(purchase.stars_paid)) throw new Error('Payment amount mismatch');
        if (userId !== Number(purchase.telegram_id)) throw new Error('Payment payer mismatch');
        await fulfillPurchase(tx, purchase, payment.telegram_payment_charge_id, 'webhook');
      });
    } else if (update.kind === 'refund') {
      await sql.begin(async tx => { await markRefundedPurchase(tx, update.payment.telegram_payment_charge_id); });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    // A pre-checkout failure must not spend its remaining deadline waiting on database telemetry.
    if (update.kind !== 'pre_checkout') await logErrorEvent({ source: 'telegram_webhook', error });
    return NextResponse.json({ ok: false, error: 'webhook_error' }, { status: 500 });
  }
}
