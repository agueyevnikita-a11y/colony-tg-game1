import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { resolveExpedition } from '@/lib/server/expeditions';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Некорректное решение экспедиции');
    const { expeditionId, choiceId } = body as { expeditionId?: unknown; choiceId?: unknown };
    if (typeof expeditionId !== 'string' || (choiceId !== undefined && typeof choiceId !== 'string')) throw new Error('Выбери экспедицию и решение');
    await reconcilePlayer(userId);
    const result = await resolveExpedition(userId, expeditionId, choiceId);
    return NextResponse.json({ ok: true, result, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
