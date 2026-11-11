import { NextResponse } from 'next/server';
import { cancelAccountClosure } from '@/lib/server/account-closure';
import { SupportOwnershipError } from '@/lib/server/support-ownership';
import { supportAuth, supportBody, supportError, supportHeaders } from '@/lib/server/support-request';
export const runtime='nodejs';
export async function POST(request:Request) {
  try {
    const auth=supportAuth(request); const body=await supportBody(request,['confirmation','requestId']);
    if(body.confirmation!=='ОТОЗВАТЬ ЗАПРОС'||typeof body.requestId!=='string') throw new SupportOwnershipError(400,'Укажите заявку и введите ОТОЗВАТЬ ЗАПРОС.');
    return NextResponse.json({ok:true,request:await cancelAccountClosure(auth.user.id,body.requestId)},{headers:supportHeaders});
  } catch(error) { return supportError(error); }
}
