import { NextResponse } from 'next/server';
import { ownClosureStatus } from '@/lib/server/account-closure';
import { supportAuth, supportBody, supportError, supportHeaders } from '@/lib/server/support-request';
export const runtime='nodejs';
export async function POST(request:Request) {
  try { const auth=supportAuth(request); await supportBody(request,[]); return NextResponse.json({ok:true,request:await ownClosureStatus(auth.user.id)},{headers:supportHeaders}); }
  catch(error) { return supportError(error); }
}
