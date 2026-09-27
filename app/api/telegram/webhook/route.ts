import { NextResponse } from 'next/server';
import { sql } from '@/lib/server/db';
import { logErrorEvent } from '@/lib/server/errors';
import { fulfillPurchase, markRefundedPurchase } from '@/lib/server/payments';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) return new NextResponse('TELEGRAM_WEBHOOK_SECRET missing', { status: 503 });
    if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) return new NextResponse('unauthorized', { status: 401 });
    const token = process.env.BOT_TOKEN;
    if (!token) return new NextResponse('BOT_TOKEN missing', { status: 500 });
    const update = await request.json() as any;

    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const rows = await sql<any[]>`
        SELECT p.*,u.telegram_id FROM purchases p JOIN users u ON u.id=p.user_id
        WHERE p.invoice_payload=${q.invoice_payload} AND p.status='created' LIMIT 1
      `;
      const purchase = rows[0];
      const valid = !!purchase && q.currency === 'XTR' && Number(q.total_amount) === Number(purchase.stars_paid)
        && Number(q.from?.id) === Number(purchase.telegram_id);
      const response = await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({pre_checkout_query_id:q.id,ok:valid,...(valid?{}:{error_message:'Платёж не прошёл проверку. Откройте магазин и попробуйте снова.'})}),
      });
      const result = await response.json() as { ok?: boolean; description?: string };
      if (!response.ok || !result.ok) throw new Error(result.description ?? 'Telegram pre-checkout response failed');
      return NextResponse.json({ok:true});
    }

    const payment=update.message?.successful_payment;
    if(payment){
      const payload=String(payment.invoice_payload ?? '');
      await sql.begin(async tx=>{
        const purchase=(await tx<any[]>`
          SELECT p.*,u.telegram_id FROM purchases p JOIN users u ON u.id=p.user_id
          WHERE p.invoice_payload=${payload} FOR UPDATE OF p
        `)[0];
        if(!purchase)throw new Error('Unknown invoice payload');
        if(payment.currency!=='XTR'||Number(payment.total_amount)!==Number(purchase.stars_paid))throw new Error('Payment amount mismatch');
        if(Number(update.message?.from?.id)!==Number(purchase.telegram_id))throw new Error('Payment payer mismatch');
        if(typeof payment.telegram_payment_charge_id!=='string'||!payment.telegram_payment_charge_id.trim())throw new Error('Missing payment charge ID');
        await fulfillPurchase(tx,purchase,String(payment.telegram_payment_charge_id),'webhook');
      });
    }

    const refunded=update.message?.refunded_payment;
    if(refunded?.telegram_payment_charge_id){
      await sql.begin(async tx=>{await markRefundedPurchase(tx,String(refunded.telegram_payment_charge_id));});
    }
    return NextResponse.json({ok:true});
  } catch(error) {
    await logErrorEvent({source:'telegram_webhook',error});
    return NextResponse.json({ok:false,error:'webhook_error'},{status:500});
  }
}
