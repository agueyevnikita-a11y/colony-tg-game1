import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { readInboxSelection } from '@/lib/server/inbox';

export const runtime='nodejs';
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request); const userId=await ensurePlayer(auth.user,auth.startParam);
    const body=await request.json();
    const result=await sql.begin(tx=>readInboxSelection(tx,userId,body));
    return NextResponse.json({ok:true,...result,...(await reconcilePlayer(userId))});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Unknown error'},{status:400});}
}
