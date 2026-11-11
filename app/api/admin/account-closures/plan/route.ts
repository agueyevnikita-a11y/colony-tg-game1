import { NextResponse } from 'next/server';
import { findClosureCase } from '@/lib/server/account-closure';
import { assertAdminTelegramId } from '@/lib/server/admin';
import { sql } from '@/lib/server/db';
import { SupportOwnershipError } from '@/lib/server/support-ownership';
import { supportAuth, supportBody, supportError, supportHeaders } from '@/lib/server/support-request';
import { inspectAccountErasure } from '@/scripts/privacy/lib/account-erasure-data.mjs';
export const runtime='nodejs';
export async function POST(request:Request) {
  try {
    const auth=supportAuth(request);
    try { assertAdminTelegramId(auth.user.id); } catch { throw new SupportOwnershipError(403,'Недостаточно прав.'); }
    const body=await supportBody(request,['requestId']);
    if(typeof body.requestId!=='string') throw new SupportOwnershipError(400,'Укажите номер заявки.');
    const record=await findClosureCase(body.requestId);
    const admins=(process.env.ADMIN_TELEGRAM_IDS||'').split(',').map(Number);
    const inspection=await sql.begin(async tx=>inspectAccountErasure(tx,record.userId,admins));
    return NextResponse.json({ok:true,plan:{request:{id:record.id,status:record.status},...inspection,copiesStatus:'not_reviewed',executable:false}},{headers:supportHeaders});
  } catch(error) { return supportError(error); }
}
