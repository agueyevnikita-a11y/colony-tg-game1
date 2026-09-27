import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { cityGridSize } from '@/lib/game/config';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    await ensurePlayer(auth.user, auth.startParam);
    const { telegramId } = (await request.json()) as { telegramId: number };
    if (!Number.isFinite(Number(telegramId))) throw new Error('Некорректный Telegram ID');

    const users = await sql<any[]>`
      SELECT u.id, u.telegram_id, u.first_name, u.username, u.colony_name, u.profile_bio, u.created_at,
             gs.hq_level, gs.player_level, gs.city_score, gs.premium_until,
             ps.buildings_started, ps.contracts_completed, ps.qualified_referrals
      FROM users u
      JOIN game_states gs ON gs.user_id=u.id
      LEFT JOIN player_stats ps ON ps.user_id=u.id
      WHERE u.telegram_id=${telegramId}
      LIMIT 1
    `;
    const target = users[0];
    if (!target) throw new Error('Колония не найдена');

    const buildings = await sql<any[]>`
      SELECT id, type, level, status, target_level, x, y
      FROM buildings WHERE user_id=${target.id} ORDER BY created_at ASC
    `;
    const decor = await sql<any[]>`
      SELECT id,type,x,y FROM city_decor WHERE user_id=${target.id} ORDER BY created_at ASC
    `;
    const cosmetics = await sql<any[]>`
      SELECT uc.cosmetic_id, c.name, c.category, c.metadata
      FROM user_cosmetics uc JOIN cosmetics c ON c.id=uc.cosmetic_id
      WHERE uc.user_id=${target.id} AND uc.equipped=true AND (uc.expires_at IS NULL OR uc.expires_at > now())
    `;
    return NextResponse.json({
      ok: true,
      city: {
        ...target,
        premium: !!target.premium_until && new Date(target.premium_until) > new Date(),
        gridSize: cityGridSize(Number(target.hq_level)),
        buildings,
        decor,
        cosmetics,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
