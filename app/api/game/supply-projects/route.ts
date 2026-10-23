import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { parseSupplyProjectRequest } from '@/lib/game/supply-projects';
import { runSupplyProjectAction } from '@/lib/server/supply-projects';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const body = parseSupplyProjectRequest(await request.json());
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    const result = await runSupplyProjectAction(userId, body);
    return NextResponse.json({ ok: true, result, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Не удалось выполнить действие проекта снабжения' }, { status: 400 });
  }
}
