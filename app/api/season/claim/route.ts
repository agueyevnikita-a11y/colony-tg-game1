import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { claimSeasonRewards, parseSeasonClaimRequest } from '@/lib/server/season';
import { analyticsEvent } from '@/lib/server/progression';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const selection = parseSeasonClaimRequest(await request.json());
    const userId = await ensurePlayer(auth.user, auth.startParam);
    const result = await sql.begin(async (tx: any) => {
      const claimed = await claimSeasonRewards(tx, userId, selection);
      for (const reward of claimed.rewards) await analyticsEvent(tx, userId, 'season_reward_claimed', { level: reward.level, points: reward.points });
      return claimed;
    });
    return NextResponse.json({ ok: true, result, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
