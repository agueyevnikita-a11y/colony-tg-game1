import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
export const runtime='nodejs';
function admins(){return new Set((process.env.ADMIN_TELEGRAM_IDS??'').split(',').map(x=>Number(x.trim())).filter(Number.isFinite));}
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);await ensurePlayer(auth.user,auth.startParam);
    if(!admins().has(Number(auth.user.id))) return new NextResponse('forbidden',{status:403});
    const body=await request.json();const key=String(body.key??'');const enabled=Boolean(body.enabled);const rollout=Math.max(0,Math.min(100,Math.round(Number(body.rolloutPercent??100))));
    const rows=await sql<any[]>`UPDATE feature_flags SET enabled=${enabled},rollout_percent=${rollout},updated_at=now() WHERE flag_key=${key} RETURNING *`;
    if(!rows.length) throw new Error('Feature flag не найден');
    return NextResponse.json({ok:true,flag:rows[0]});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Unknown error'},{status:400});}
}
