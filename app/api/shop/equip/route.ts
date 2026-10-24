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
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Некорректный выбор косметики');
    const { cosmeticId, equipped = true } = body as { cosmeticId?: unknown; equipped?: unknown };
    if (typeof cosmeticId !== 'string' || !cosmeticId.trim()) throw new Error('Выбери косметический предмет');
    if (typeof equipped !== 'boolean') throw new Error('Некорректное действие с косметикой');

    await sql.begin(async (tx) => {
      // All appearance changes for this player share a lock. Concurrent category
      // switches cannot each leave their own item equipped.
      const state = (await tx<any[]>`SELECT user_id FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
      if (!state) throw new Error('Игровой профиль не найден');
      const rows = await tx<any[]>`
        SELECT uc.acquired_at::text AS acquired_at, uc.equipped, c.category
        FROM user_cosmetics uc JOIN cosmetics c ON c.id=uc.cosmetic_id
        WHERE uc.user_id=${userId} AND uc.cosmetic_id=${cosmeticId}
          AND (uc.expires_at IS NULL OR uc.expires_at > clock_timestamp())
        ORDER BY (uc.expires_at IS NULL) DESC, uc.expires_at DESC NULLS LAST, uc.acquired_at DESC LIMIT 1
        FOR UPDATE OF uc
      `;
      const owned = rows[0];
      if (!owned) throw new Error('Косметика не принадлежит игроку или срок истёк');
      if (!equipped) {
        const removed = await tx<any[]>`
          UPDATE user_cosmetics SET equipped=false
          WHERE user_id=${userId} AND cosmetic_id=${cosmeticId} AND equipped=true
          RETURNING cosmetic_id
        `;
        if (removed.length) await analyticsEvent(tx, userId, 'cosmetic_unequipped', { cosmetic_id: cosmeticId, category: owned.category });
      } else {
        const cleared = await tx<any[]>`
          UPDATE user_cosmetics uc SET equipped=false
          FROM cosmetics c
          WHERE uc.cosmetic_id=c.id AND uc.user_id=${userId} AND c.category=${owned.category} AND uc.equipped=true
            AND NOT (uc.cosmetic_id=${cosmeticId} AND uc.acquired_at=${owned.acquired_at}::text::timestamptz)
          RETURNING uc.cosmetic_id
        `;
        // Force the parameter to text before PostgreSQL casts it: inferring it
        // as timestamptz makes postgres.js serialize through JS Date and discard
        // the microseconds of this composite key, even when given a string.
        const selected = await tx<any[]>`
          UPDATE user_cosmetics SET equipped=true
          WHERE user_id=${userId} AND cosmetic_id=${cosmeticId} AND acquired_at=${owned.acquired_at}::text::timestamptz
          RETURNING cosmetic_id
        `;
        if (selected.length !== 1) throw new Error('Не удалось применить предмет. Попробуй ещё раз.');
        if (cleared.length || !owned.equipped) await analyticsEvent(tx, userId, 'cosmetic_equipped', { cosmetic_id: cosmeticId, category: owned.category });
      }
    });

    return NextResponse.json({ ok: true, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
