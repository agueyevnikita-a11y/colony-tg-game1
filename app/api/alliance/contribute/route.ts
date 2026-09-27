import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { contributeToAlliance } from '@/lib/server/alliance';
import type { AllianceResource } from '@/lib/game/alliance';
export const runtime='nodejs';
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);
    const userId=await ensurePlayer(auth.user,auth.startParam);
    const body=await request.json() as {resource:AllianceResource;amount:number};
    await reconcilePlayer(userId);
    const result=await contributeToAlliance(userId,body.resource,Number(body.amount));
    return NextResponse.json({ok:true,result,...(await reconcilePlayer(userId))});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Unknown error'},{status:400});}
}
