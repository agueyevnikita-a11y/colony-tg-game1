import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';

export const runtime='nodejs';
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request); const userId=await ensurePlayer(auth.user,auth.startParam);
    const body=await request.json().catch(()=>({}));
    if(body.all){await sql`UPDATE game_inbox SET read_at=COALESCE(read_at,now()) WHERE user_id=${userId}`;}
    else if(body.id){await sql`UPDATE game_inbox SET read_at=COALESCE(read_at,now()) WHERE user_id=${userId} AND id=${String(body.id)}`;}
    return NextResponse.json({ok:true,...(await reconcilePlayer(userId))});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Unknown error'},{status:400});}
}
