import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { cityGridSize } from '@/lib/game/config';
import { calculateComfort } from '@/lib/game/comfort';
import { closedPlayerIds } from '@/lib/server/closed-player-visibility';

export const runtime = 'nodejs';

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    await ensurePlayer(auth.user, auth.startParam);
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Некорректный запрос колонии');
    const hasUserId = Object.prototype.hasOwnProperty.call(body, 'userId');
    if (hasUserId && (typeof body.userId !== 'string' || body.userId.length !== 36 || !USER_ID.test(body.userId))) {
      throw new Error('Некорректный ID колонии');
    }
    // Old shared city links remain readable; newly generated links use the game UUID.
    if (!hasUserId && (typeof body.telegramId !== 'number' || !Number.isSafeInteger(body.telegramId) || body.telegramId <= 0)) {
      throw new Error('Некорректный ID колонии');
    }
    const targetCondition = hasUserId ? sql`u.id=${body.userId.toLowerCase()}` : sql`u.telegram_id=${body.telegramId}`;
    const hiddenPlayers = await closedPlayerIds(sql);

    const users = await sql<any[]>`
      SELECT u.id, u.colony_name, u.profile_bio, u.created_at,
             gs.hq_level, gs.player_level, gs.city_score, gs.premium_until,
             ps.buildings_started, ps.contracts_completed, ps.qualified_referrals
      FROM users u
      JOIN game_states gs ON gs.user_id=u.id
      LEFT JOIN player_stats ps ON ps.user_id=u.id
      WHERE ${targetCondition} AND NOT(u.id=ANY(${sql.array(hiddenPlayers)}::uuid[]))
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
        id: target.id,
        colony_name: target.colony_name || 'Колония',
        profile_bio: target.profile_bio,
        created_at: target.created_at,
        hq_level: target.hq_level,
        player_level: target.player_level,
        city_score: target.city_score,
        buildings_started: target.buildings_started,
        contracts_completed: target.contracts_completed,
        qualified_referrals: target.qualified_referrals,
        premium: !!target.premium_until && new Date(target.premium_until) > new Date(),
        gridSize: cityGridSize(Number(target.hq_level)),
        buildings,
        decor,
        comfort: calculateComfort(decor),
        cosmetics,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
