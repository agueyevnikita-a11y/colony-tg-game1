import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { assertAdminTelegramId } from '@/lib/server/admin';
import { sql } from '@/lib/server/db';

export const runtime='nodejs';
const allowed=new Set(['maintenance','beta_required']);
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);await ensurePlayer(auth.user,auth.startParam);assertAdminTelegramId(auth.user.id);
    const body=await request.json() as {key?:string;enabled?:boolean;message?:string};
    const key=String(body.key??'');if(!allowed.has(key))throw new Error('Unknown setting');
    const value=key==='maintenance'?{enabled:Boolean(body.enabled),message:String(body.message??'COLONY на техническом обслуживании.')}:{enabled:Boolean(body.enabled)};
    await sql`
      INSERT INTO system_settings(setting_key,value,updated_at) VALUES(${key},${sql.json(value)},now())
      ON CONFLICT(setting_key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()
    `;
    return NextResponse.json({ok:true,key,value});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Admin error'},{status:403});}
}
