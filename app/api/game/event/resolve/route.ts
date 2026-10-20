import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { resolveColonyEvent } from '@/lib/server/colony-events';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Некорректное решение события');
    const { eventId, choiceId } = body as { eventId?: unknown; choiceId?: unknown };
    if (typeof eventId !== 'string' || typeof choiceId !== 'string') throw new Error('Выбери решение события');
    await reconcilePlayer(userId);
    const result = await resolveColonyEvent(userId, eventId, choiceId);
    return NextResponse.json({ ok: true, result, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Не удалось применить решение' }, { status: 400 });
  }
}
