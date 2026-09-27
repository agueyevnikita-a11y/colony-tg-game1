import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { BUILDINGS, HQ_UPGRADES, cityGridSize, type BuildingType, type ResourceCost } from '@/lib/game/config';
import { buildTimeSec } from '@/lib/game/economy';
import { recordProgressEvent } from '@/lib/server/progression';
import { enqueueNotification } from '@/lib/server/notifications';

export const runtime = 'nodejs';

type Body = { type: BuildingType; x?: number; y?: number };

function canPay(state: any, cost: ResourceCost) {
  return Object.entries(cost).every(([k, v]) => !v || Number(state[k]) >= v);
}

function findFreeCell(cells: Array<{ x: number; y: number }>, size: number) {
  const occupied = new Set(cells.map((b) => `${b.x}:${b.y}`));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!occupied.has(`${x}:${y}`)) return { x, y };
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    const body = (await request.json()) as Body;
    const cfg = BUILDINGS[body.type];
    if (!cfg) return NextResponse.json({ ok: false, error: 'Unknown building' }, { status: 400 });

    const result = await sql.begin(async (tx) => {
      const states = await tx<any[]>`SELECT * FROM game_states WHERE user_id = ${userId} FOR UPDATE`;
      const state = states[0];
      const premium = !!state.premium_until && new Date(state.premium_until) > new Date();
      const activeQueue = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM buildings WHERE user_id=${userId} AND status IN ('building','upgrading')
      `;
      const maxQueue = premium ? 3 : 2;
      if (Number(activeQueue[0]?.count ?? 0) >= maxQueue) throw new Error(`Build queue is full (${maxQueue})`);

      if (body.type === 'hq') {
        const hqRows = await tx<any[]>`SELECT * FROM buildings WHERE user_id=${userId} AND type='hq' LIMIT 1 FOR UPDATE`;
        const hq = hqRows[0];
        if (!hq || hq.status !== 'active') throw new Error('HQ is busy');
        const target = hq.level + 1;
        const up = HQ_UPGRADES[target];
        if (!up) throw new Error('HQ upgrade is not configured yet');
        if (!canPay(state, up.cost)) throw new Error('Не хватает ресурсов');
        const seconds = Math.max(5, Math.ceil(up.timeSec * (premium ? 0.95 : 1)));
        await tx`
          UPDATE game_states SET
            ore=ore-${up.cost.ore ?? 0}, energy=energy-${up.cost.energy ?? 0},
            parts=parts-${up.cost.parts ?? 0}, credits=credits-${up.cost.credits ?? 0}, updated_at=now()
          WHERE user_id=${userId}
        `;
        await tx`
          UPDATE buildings SET status='upgrading', target_level=${target}, completes_at=now()+make_interval(secs => ${seconds}), updated_at=now()
          WHERE id=${hq.id}
        `;
        await recordProgressEvent(tx, userId, 'build_started', 1, { building_type: 'hq', target_level: target });
        await enqueueNotification(tx, userId, 'building_ready', `building:${hq.id}:${target}`, new Date(Date.now()+seconds*1000), { name: `Центр управления HQ${target}`, buildingId: hq.id });
        return { action: 'upgrade', seconds };
      }

      if (state.hq_level < cfg.unlockHq) throw new Error(`Requires HQ level ${cfg.unlockHq}`);
      if (!canPay(state, cfg.baseBuildCost)) throw new Error('Не хватает ресурсов');
      const buildings = await tx<any[]>`SELECT x, y FROM buildings WHERE user_id=${userId}`;
      const decor = await tx<any[]>`SELECT x, y FROM city_decor WHERE user_id=${userId}`;
      const occupiedCells = [...buildings, ...decor];
      const size = cityGridSize(Number(state.hq_level));
      let x = Number(body.x);
      let y = Number(body.y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        const free = findFreeCell(occupiedCells, size);
        if (!free) throw new Error('На текущей территории нет свободных клеток');
        x = free.x;
        y = free.y;
      }
      if (x < 0 || y < 0 || x >= size || y >= size) throw new Error('Клетка находится за пределами территории');
      if (occupiedCells.some((b) => Number(b.x) === x && Number(b.y) === y)) throw new Error('Эта клетка уже занята');

      const seconds = buildTimeSec(body.type, 1, premium);
      await tx`
        UPDATE game_states SET
          ore=ore-${cfg.baseBuildCost.ore ?? 0}, energy=energy-${cfg.baseBuildCost.energy ?? 0},
          parts=parts-${cfg.baseBuildCost.parts ?? 0}, credits=credits-${cfg.baseBuildCost.credits ?? 0}, updated_at=now()
        WHERE user_id=${userId}
      `;
      const builtRows = await tx<any[]>`
        INSERT INTO buildings (user_id,type,level,x,y,status,target_level,completes_at)
        VALUES (${userId},${body.type},0,${x},${y},'building',1,now()+make_interval(secs => ${seconds}))
        RETURNING id
      `;
      const buildingId = builtRows[0]?.id;
      await recordProgressEvent(tx, userId, 'build_started', 1, { building_type: body.type, target_level: 1, x, y });
      if (buildingId) await enqueueNotification(tx, userId, 'building_ready', `building:${buildingId}:1`, new Date(Date.now()+seconds*1000), { name: cfg.name, buildingId });
      return { action: 'build', seconds, x, y, buildingId };
    });

    const game = await reconcilePlayer(userId);
    return NextResponse.json({ ok: true, result, ...game });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
