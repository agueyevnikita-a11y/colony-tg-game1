import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { logErrorEvent } from '@/lib/server/errors';
export const runtime='nodejs';
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request); const userId=await ensurePlayer(auth.user,auth.startParam);
    const body=await request.json();
    await logErrorEvent({userId,source:'client',error:new Error(String(body.message??'Client error')),context:{stack:String(body.stack??'').slice(0,4000),path:String(body.path??'').slice(0,500)}});
    return NextResponse.json({ok:true});
  }catch{return NextResponse.json({ok:true});}
}
