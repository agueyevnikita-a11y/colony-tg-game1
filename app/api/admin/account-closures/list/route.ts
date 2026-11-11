import { NextResponse } from 'next/server';
import { adminClosureList } from '@/lib/server/account-closure';
import { assertAdminTelegramId } from '@/lib/server/admin';
import { SupportOwnershipError } from '@/lib/server/support-ownership';
import { supportAuth, supportBody, supportError, supportHeaders } from '@/lib/server/support-request';
export const runtime='nodejs';
export async function POST(request:Request) {
  try {
    const auth=supportAuth(request);
    try { assertAdminTelegramId(auth.user.id); } catch { throw new SupportOwnershipError(403,'Недостаточно прав.'); }
    await supportBody(request,[]);
    return NextResponse.json({ok:true,requests:await adminClosureList()},{headers:supportHeaders});
  } catch(error) { return supportError(error); }
}
