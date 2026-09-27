import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { cityGridSize } from '@/lib/game/config';
import { analyticsEvent } from '@/lib/server/progression';

export const runtime = 'nodejs';

type Body = { buildingId: string; x: number; y: number };

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    const body = (await request.json()) as Body;
    const x = Number(body.x);
    const y = Number(body.y);
    if (!body.buildingId || !Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Некорректная клетка');

    await sql.begin(async (tx) => {
      const states = await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`;
      const state = states[0];
      if (!state) throw new Error('Состояние игрока не найдено');
      const gridSize = cityGridSize(Number(state.hq_level));
      if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) throw new Error('Клетка находится за пределами территории');

      const rows = await tx<any[]>`
        SELECT * FROM buildings WHERE id=${body.buildingId} AND user_id=${userId} FOR UPDATE
      `;
      const building = rows[0];
      if (!building) throw new Error('Здание не найдено');
      if (building.status !== 'active') throw new Error('Нельзя перемещать строящееся здание');

      const occupied = await tx<any[]>`
        SELECT id::text FROM buildings WHERE user_id=${userId} AND x=${x} AND y=${y} AND id<>${building.id}
        UNION ALL
        SELECT id::text FROM city_decor WHERE user_id=${userId} AND x=${x} AND y=${y}
        LIMIT 1
      `;
      if (occupied.length) throw new Error('Эта клетка уже занята');

      await tx`UPDATE buildings SET x=${x}, y=${y}, updated_at=now() WHERE id=${building.id}`;
      await analyticsEvent(tx, userId, 'city_building_moved', { building_id: building.id, type: building.type, x, y });
    });

    return NextResponse.json({ ok: true, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
