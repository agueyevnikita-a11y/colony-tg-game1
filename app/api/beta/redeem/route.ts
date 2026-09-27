import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { redeemBetaCode } from '@/lib/server/access';
import { assertRateLimit } from '@/lib/server/rate-limit';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);
    const userId=await ensurePlayer(auth.user,auth.startParam,{skipAccessGate:true});
    await assertRateLimit(`beta_redeem:${userId}`,10,600);
    const {code}=await request.json() as {code?:string};
    if(!code)throw new Error('Введите beta-код');
    const result=await redeemBetaCode(userId,code);
    return NextResponse.json({ok:true,...result});
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Ошибка beta-кода'},{status:400});
  }
}
