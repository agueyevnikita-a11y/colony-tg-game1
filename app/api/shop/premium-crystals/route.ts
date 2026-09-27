import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { CRYSTAL_PREMIUM_PRICE } from '@/lib/game/config';
import { analyticsEvent } from '@/lib/server/progression';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    await sql.begin(async (tx) => {
      const rows = await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`;
      const state = rows[0];
      if (Number(state.crystals) < CRYSTAL_PREMIUM_PRICE) throw new Error(`Нужно ${CRYSTAL_PREMIUM_PRICE} кристаллов`);
      await tx`
        UPDATE game_states SET
          crystals=crystals-${CRYSTAL_PREMIUM_PRICE},
          premium_until=GREATEST(COALESCE(premium_until, now()), now()) + interval '30 days',
          updated_at=now()
        WHERE user_id=${userId}
      `;
      await analyticsEvent(tx, userId, 'premium_bought_crystals', { crystals: CRYSTAL_PREMIUM_PRICE, days: 30 });
    });
    return NextResponse.json({ ok: true, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
