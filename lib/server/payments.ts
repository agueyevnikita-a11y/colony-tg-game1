import { PRODUCTS } from '@/lib/game/config';
import { analyticsEvent } from '@/lib/server/progression';
import { pushInbox } from '@/lib/server/inbox';

export async function fulfillPurchase(tx:any,purchase:any,telegramPaymentChargeId:string,source:'webhook'|'recovery'='webhook') {
  if (!purchase) throw new Error('Purchase not found');
  if (purchase.status === 'paid') return false;
  if (purchase.status === 'refunded') throw new Error('Purchase was refunded');
  const product = PRODUCTS[purchase.product_id as keyof typeof PRODUCTS] as any;
  if (!product) throw new Error('Unknown paid product');

  const updated = await tx<any[]>`
    UPDATE purchases
    SET status='paid',paid_at=COALESCE(paid_at,now()),telegram_payment_charge_id=${telegramPaymentChargeId}
    WHERE id=${purchase.id} AND status='created'
    RETURNING id
  `;
  if (!updated.length) return false;

  await analyticsEvent(tx,purchase.user_id,'stars_purchase',{ product_id:purchase.product_id,stars:Number(purchase.stars_paid),source });
  if(product.kind==='premium') {
    await tx`UPDATE game_states SET premium_until=GREATEST(COALESCE(premium_until,now()),now())+make_interval(days=>${product.days}) WHERE user_id=${purchase.user_id}`;
  } else if(product.kind==='cosmetic') {
    await tx`INSERT INTO user_cosmetics(user_id,cosmetic_id,source) VALUES(${purchase.user_id},${product.cosmeticId},'stars')`;
  } else if(product.kind==='bundle') {
    for(const cosmeticId of ['founder_badge','founder_monument','founder_frame','founder_sky']) {
      await tx`INSERT INTO user_cosmetics(user_id,cosmetic_id,source) VALUES(${purchase.user_id},${cosmeticId},'stars')`;
    }
  }
  await pushInbox(tx,purchase.user_id,{
    kind:'purchase',dedupeKey:`purchase_${purchase.id}`,title:'Покупка Stars получена',
    body:`${product.title ?? purchase.product_id} активирован${source==='recovery'?' после проверки транзакции':''}. Спасибо за поддержку COLONY.`,
    metadata:{ productId:purchase.product_id,source },
  });
  return true;
}

export async function markRefundedPurchase(tx:any,telegramPaymentChargeId:string) {
  const rows=await tx<any[]>`
    UPDATE purchases SET status='refunded'
    WHERE telegram_payment_charge_id=${telegramPaymentChargeId} AND status='paid'
    RETURNING *
  `;
  const purchase=rows[0];
  if(!purchase) return false;
  await analyticsEvent(tx,purchase.user_id,'stars_refund',{ product_id:purchase.product_id,stars:Number(purchase.stars_paid) });
  await pushInbox(tx,purchase.user_id,{
    kind:'purchase',dedupeKey:`refund_${purchase.id}`,title:'Возврат Stars зарегистрирован',
    body:'Telegram сообщил о возврате покупки. Если доступ к товару отображается некорректно, отправьте сообщение через «Обратную связь».',
    metadata:{ productId:purchase.product_id },
  });
  return true;
}
