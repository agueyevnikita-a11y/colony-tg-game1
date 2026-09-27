import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { claimDailyLogin } from '@/lib/server/daily-login';
import { pushInbox } from '@/lib/server/inbox';

export const runtime='nodejs';
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request); const userId=await ensurePlayer(auth.user,auth.startParam);
    const reward=await sql.begin(async tx=>{
      const row=await claimDailyLogin(tx,userId);
      await pushInbox(tx,userId,{kind:'reward',dedupeKey:`daily_${row.reward_date}`,title:`Серия входов: день ${row.cycle_day}`,body:`Получено: 💰${row.credit_reward}${Number(row.crystal_reward)>0?` · 💎${row.crystal_reward}`:''}. Текущая серия: ${row.streak_number} дн.`});
      return row;
    });
    return NextResponse.json({ok:true,reward,...(await reconcilePlayer(userId))});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Unknown error'},{status:400});}
}
