import { NextResponse } from 'next/server';
import { sql } from '@/lib/server/db';
import { notificationText, type NotificationKind } from '@/lib/server/notifications';
import { logErrorEvent } from '@/lib/server/errors';
import { cleanupRateLimits } from '@/lib/server/rate-limit';

export const runtime='nodejs';
export async function POST(request:Request){
  try{
    const secret=process.env.CRON_SECRET;
    if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`) return new NextResponse('unauthorized',{status:401});
    const token=process.env.BOT_TOKEN;if(!token)return new NextResponse('BOT_TOKEN missing',{status:500});
    await cleanupRateLimits();
    const botUsername=process.env.NEXT_PUBLIC_BOT_USERNAME||'';
    const claimed=await sql<any[]>`WITH due AS (SELECT id FROM notification_jobs WHERE sent_at IS NULL AND cancelled_at IS NULL AND scheduled_at<=now() AND (processing_at IS NULL OR processing_at<now()-interval '5 minutes') ORDER BY scheduled_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED) UPDATE notification_jobs nj SET processing_at=now() FROM due WHERE nj.id=due.id RETURNING nj.id`;
    if(!claimed.length)return NextResponse.json({ok:true,processed:0,sent:0,skipped:0,failed:0});
    const ids=claimed.map(x=>x.id);
    const jobs=await sql<any[]>`SELECT nj.*,u.telegram_id,np.enabled,np.building_ready,np.research_ready,np.expedition_ready,u.bot_write_allowed FROM notification_jobs nj JOIN users u ON u.id=nj.user_id JOIN notification_preferences np ON np.user_id=nj.user_id WHERE nj.id=ANY(${sql.array(ids)}::uuid[])`;
    let sent=0,skipped=0,failed=0;
    for(const job of jobs){
      const kind=job.kind as NotificationKind;
      const allowedByKind=kind==='building_ready'?job.building_ready:kind==='research_ready'?job.research_ready:job.expedition_ready;
      if(!job.enabled||!job.bot_write_allowed||!allowedByKind){await sql`UPDATE notification_jobs SET cancelled_at=now(),processing_at=NULL,error_text='notifications_disabled' WHERE id=${job.id}`;skipped++;continue;}
      const payload=typeof job.payload==='string'?JSON.parse(job.payload):job.payload;
      const result=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:Number(job.telegram_id),text:notificationText(kind,payload),reply_markup:botUsername?{inline_keyboard:[[{text:'Открыть COLONY',url:`https://t.me/${botUsername}?startapp`}]]}:undefined})});
      if(result.ok){await sql`UPDATE notification_jobs SET sent_at=now(),processing_at=NULL,error_text=NULL WHERE id=${job.id}`;sent++;continue;}
      const errorText=(await result.text()).slice(0,500);
      if(result.status===403){await sql.begin(async tx=>{await tx`UPDATE users SET bot_write_allowed=false WHERE id=${job.user_id}`;await tx`UPDATE notification_jobs SET cancelled_at=now(),processing_at=NULL,error_text=${errorText} WHERE user_id=${job.user_id} AND sent_at IS NULL AND cancelled_at IS NULL`;});}
      else {await sql`UPDATE notification_jobs SET processing_at=NULL,error_text=${errorText} WHERE id=${job.id}`;await logErrorEvent({userId:job.user_id,source:'notification_delivery',error:new Error(errorText),context:{status:result.status,kind}});}
      failed++;
    }
    return NextResponse.json({ok:true,processed:jobs.length,sent,skipped,failed});
  }catch(error){await logErrorEvent({source:'notification_cron',error});return NextResponse.json({ok:false,error:'cron_error'},{status:500});}
}
