import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { completeNpcContract } from '@/lib/server/contracts';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { contractId?: unknown }).contractId !== 'string') throw new Error('Выбери контракт');
    const result = await completeNpcContract(userId, (body as { contractId: string }).contractId);
    return NextResponse.json({ ok: true, result, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
