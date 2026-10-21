import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { claimQuestRewards, parseQuestClaimSelection } from '@/lib/server/quest-rewards';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const selection = parseQuestClaimSelection(await request.json());
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    const result = await sql.begin((tx) => claimQuestRewards(tx, userId, selection));
    return NextResponse.json({ ok: true, result, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
