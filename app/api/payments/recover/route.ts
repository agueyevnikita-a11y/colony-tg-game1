import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { assertFeature } from '@/lib/server/feature-flags';
import { assertRateLimit } from '@/lib/server/rate-limit';
import { fulfillPurchase } from '@/lib/server/payments';
import { logErrorEvent } from '@/lib/server/errors';

export const runtime='nodejs';

export async function POST(request:Request){
  let userId:string|undefined;
  try{
    const auth=getInitDataFromRequest(request); userId=await ensurePlayer(auth.user,auth.startParam);
    await assertRateLimit(`payment_recovery:${userId}`,3,600);
    await sql.begin(async tx=>{await assertFeature(tx,userId!,'stars_shop');});
    const token=process.env.BOT_TOKEN;if(!token)throw new Error('BOT_TOKEN is not configured');
    const pending=await sql<any[]>`
      SELECT * FROM purchases WHERE user_id=${userId} AND status='created' AND created_at>now()-interval '30 days'
      ORDER BY created_at DESC LIMIT 50
    `;
    if(!pending.length) return NextResponse.json({ok:true,recovered:0,scanned:0,message:'Необработанных покупок нет'});
    const wanted=new Map(pending.map((p:any)=>[String(p.invoice_payload),p]));
    let scanned=0,recovered=0;
    for(let offset=0;offset<300 && wanted.size;offset+=100){
      const res=await fetch(`https://api.telegram.org/bot${token}/getStarTransactions`,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({offset,limit:100}),cache:'no-store',
      });
      const data=await res.json() as any;if(!data.ok)throw new Error(data.description??'Telegram Star transaction error');
      const transactions=Array.isArray(data.result?.transactions)?data.result.transactions:[];
      scanned+=transactions.length;
      for(const t of transactions){
        const payload=t?.source?.type==='user' && t?.source?.transaction_type==='invoice_payment' ? t.source.invoice_payload : null;
        if(!payload||!wanted.has(String(payload)))continue;
        if(Number(t.source?.user?.id)!==Number(auth.user.id))continue;
        const purchase=wanted.get(String(payload));
        if(Number(t.amount)!==Number(purchase.stars_paid))continue;
        const did=await sql.begin(async tx=>{
          const locked=(await tx<any[]>`SELECT * FROM purchases WHERE id=${purchase.id} FOR UPDATE`)[0];
          return fulfillPurchase(tx,locked,String(t.id),'recovery');
        });
        if(did)recovered++;
        wanted.delete(String(payload));
      }
      if(transactions.length<100)break;
    }
    await sql`INSERT INTO payment_recovery_runs(user_id,scanned_transactions,recovered_purchases) VALUES(${userId},${scanned},${recovered})`;
    return NextResponse.json({ok:true,recovered,scanned,message:recovered?`Восстановлено покупок: ${recovered}`:'Новых оплаченных транзакций не найдено'});
  }catch(error){
    await logErrorEvent({userId,source:'payment_recovery',error});
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Ошибка проверки покупок'},{status:400});
  }
}
