import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { analyticsEvent } from '@/lib/server/progression';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    const { cosmeticId } = (await request.json()) as { cosmeticId: string };

    await sql.begin(async (tx) => {
      const rows = await tx<any[]>`
        SELECT uc.acquired_at, c.category
        FROM user_cosmetics uc JOIN cosmetics c ON c.id=uc.cosmetic_id
        WHERE uc.user_id=${userId} AND uc.cosmetic_id=${cosmeticId}
          AND (uc.expires_at IS NULL OR uc.expires_at > now())
        ORDER BY uc.acquired_at DESC LIMIT 1
      `;
      const owned = rows[0];
      if (!owned) throw new Error('Косметика не принадлежит игроку или срок истёк');
      await tx`
        UPDATE user_cosmetics uc SET equipped=false
        FROM cosmetics c
        WHERE uc.cosmetic_id=c.id AND uc.user_id=${userId} AND c.category=${owned.category}
      `;
      await tx`
        UPDATE user_cosmetics SET equipped=true
        WHERE user_id=${userId} AND cosmetic_id=${cosmeticId} AND acquired_at=${owned.acquired_at}
      `;
      await analyticsEvent(tx, userId, 'cosmetic_equipped', { cosmetic_id: cosmeticId, category: owned.category });
    });

    return NextResponse.json({ ok: true, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
