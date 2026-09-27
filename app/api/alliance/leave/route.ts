import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { leaveAlliance } from '@/lib/server/alliance';
export const runtime='nodejs';
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);
    const userId=await ensurePlayer(auth.user,auth.startParam);
    await reconcilePlayer(userId);
    await leaveAlliance(userId);
    return NextResponse.json({ok:true,...(await reconcilePlayer(userId))});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Unknown error'},{status:400});}
}
