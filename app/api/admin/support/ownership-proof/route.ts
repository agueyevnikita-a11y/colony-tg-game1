import { NextResponse } from 'next/server';
import { assertAdminTelegramId } from '@/lib/server/admin';
import { consumeOwnershipProof, SupportOwnershipError } from '@/lib/server/support-ownership';
import { supportAuth, supportBody, supportError, supportHeaders } from '@/lib/server/support-request';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = supportAuth(request);
    try { assertAdminTelegramId(auth.user.id); }
    catch { throw new SupportOwnershipError(403, 'Недостаточно прав для проверки обращения.'); }
    const body = await supportBody(request, ['code', 'requestRef']);
    if (typeof body.code !== 'string' || typeof body.requestRef !== 'string') {
      throw new SupportOwnershipError(400, 'Укажите код и номер обращения.');
    }
    const verification = await consumeOwnershipProof(auth.user.id, body.code.trim().toUpperCase(), body.requestRef.trim());
    return NextResponse.json({ ok: true, verification }, { headers: supportHeaders });
  } catch (error) { return supportError(error); }
}
