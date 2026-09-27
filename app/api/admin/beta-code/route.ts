import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { assertAdminTelegramId } from '@/lib/server/admin';
import { hashBetaCode } from '@/lib/server/access';
import { sql } from '@/lib/server/db';

export const runtime='nodejs';
function makeCode(){return `COL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;}
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);const userId=await ensurePlayer(auth.user,auth.startParam);assertAdminTelegramId(auth.user.id);
    const body=await request.json() as {code?:string;label?:string;maxUses?:number;expiresDays?:number};
    const code=String(body.code??makeCode()).trim().toUpperCase();
    if(code.length<4||code.length>64)throw new Error('Код должен быть 4–64 символа');
    const maxUses=Math.max(1,Math.min(10000,Math.floor(Number(body.maxUses??1))));
    const expiresDays=body.expiresDays==null?null:Math.max(1,Math.min(365,Math.floor(Number(body.expiresDays))));
    const hash=hashBetaCode(code);
    const expiresAt=expiresDays?new Date(Date.now()+expiresDays*86_400_000):null;
    await sql`
      INSERT INTO beta_invite_codes(code_hash,label,max_uses,expires_at,created_by)
      VALUES(${hash},${String(body.label??'closed-beta').slice(0,80)},${maxUses},${expiresAt},${userId})
      ON CONFLICT(code_hash) DO UPDATE SET active=true,max_uses=EXCLUDED.max_uses,label=EXCLUDED.label
    `;
    return NextResponse.json({ok:true,code,maxUses,expiresDays});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Admin error'},{status:403});}
}
