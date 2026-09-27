import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer,reconcilePlayer } from '@/lib/server/game';
import { joinAlliance } from '@/lib/server/alliance';
import { assertFeature } from '@/lib/server/feature-flags';
import { sql } from '@/lib/server/db';
export const runtime='nodejs';
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);const userId=await ensurePlayer(auth.user,auth.startParam);
    await sql.begin(async tx=>{await assertFeature(tx,userId,'alliances');});
    const body=await request.json() as {code:string};await reconcilePlayer(userId);await joinAlliance(userId,String(body.code??''));
    return NextResponse.json({ok:true,...(await reconcilePlayer(userId))});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Unknown error'},{status:400});}
}
