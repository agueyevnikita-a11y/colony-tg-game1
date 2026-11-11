import { NextResponse } from 'next/server';
import { requestAccountClosure } from '@/lib/server/account-closure';
import { SupportOwnershipError } from '@/lib/server/support-ownership';
import { supportAuth, supportBody, supportError, supportHeaders } from '@/lib/server/support-request';
export const runtime='nodejs';
export async function POST(request:Request) {
  try {
    const auth=supportAuth(request); const body=await supportBody(request,['confirmation']);
    if(body.confirmation!=='ЗАКРЫТЬ АККАУНТ') throw new SupportOwnershipError(400,'Для закрытия введите ЗАКРЫТЬ АККАУНТ.');
    return NextResponse.json({ok:true,request:await requestAccountClosure(auth.user.id)},{headers:supportHeaders});
  } catch(error) { return supportError(error); }
}
