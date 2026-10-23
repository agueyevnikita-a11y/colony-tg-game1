import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { parseAllianceCooperationRequest } from '@/lib/game/alliance-cooperation';
import { runAllianceCooperationAction } from '@/lib/server/alliance-cooperation';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const body = parseAllianceCooperationRequest(await request.json());
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    const result = await runAllianceCooperationAction(userId, body);
    return NextResponse.json({ ok: true, result, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Не удалось выполнить действие совместной добычи' }, { status: 400 });
  }
}
