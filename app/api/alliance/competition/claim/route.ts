import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { claimAllianceCompetitionRewards } from '@/lib/server/alliance-competition';
import { sql } from '@/lib/server/db';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    const body = await request.json();
    const result = await sql.begin(tx => claimAllianceCompetitionRewards(tx, userId, body?.periodId));
    return NextResponse.json({ ok: true, result, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Не удалось получить награду недели' }, { status: 400 });
  }
}
