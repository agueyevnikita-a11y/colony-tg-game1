import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer,reconcilePlayer } from '@/lib/server/game';
import { startExpedition } from '@/lib/server/expeditions';
import { assertFeature } from '@/lib/server/feature-flags';
import { sql } from '@/lib/server/db';
export const runtime='nodejs';
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);const userId=await ensurePlayer(auth.user,auth.startParam);
    await sql.begin(async tx=>{await assertFeature(tx,userId,'expeditions');});
    const body=await request.json().catch(()=>({}));await reconcilePlayer(userId);const result=await startExpedition(userId,String(body.expeditionKey??''));
    return NextResponse.json({ok:true,result,...(await reconcilePlayer(userId))});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Unknown error'},{status:400});}
}
