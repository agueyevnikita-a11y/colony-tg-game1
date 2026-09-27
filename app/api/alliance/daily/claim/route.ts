import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { claimAllianceDailyGoal } from '@/lib/server/alliance';
export const runtime='nodejs';
export async function POST(request:Request){try{const auth=getInitDataFromRequest(request);const userId=await ensurePlayer(auth.user,auth.startParam);const b=await request.json();const result=await claimAllianceDailyGoal(userId,String(b.goalKey));return NextResponse.json({ok:true,result,...await reconcilePlayer(userId)});}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Unknown error'},{status:400});}}
