import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { BUILDINGS, HQ_UPGRADES, type BuildingType, type ResourceCost } from '@/lib/game/config';
import { buildTimeSec, upgradeCost } from '@/lib/game/economy';
import { recordProgressEvent } from '@/lib/server/progression';
import { enqueueNotification } from '@/lib/server/notifications';

export const runtime = 'nodejs';

type Body = { buildingId: string };

function canPay(state: any, cost: ResourceCost) {
  return Object.entries(cost).every(([k, v]) => !v || Number(state[k]) >= v);
}

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    const { buildingId } = (await request.json()) as Body;
    if (!buildingId) throw new Error('Не выбрано здание');

    const result = await sql.begin(async (tx) => {
      const states = await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`;
      const state = states[0];
      if (!state) throw new Error('Состояние игрока не найдено');
      const premium = !!state.premium_until && new Date(state.premium_until) > new Date();

      const rows = await tx<any[]>`
        SELECT * FROM buildings WHERE id=${buildingId} AND user_id=${userId} FOR UPDATE
      `;
      const building = rows[0];
      if (!building) throw new Error('Здание не найдено');
      if (building.status !== 'active') throw new Error('Здание уже занято строительством');

      const type = building.type as BuildingType;
      const cfg = BUILDINGS[type];
      if (!cfg) throw new Error('Неизвестный тип здания');
      const targetLevel = Number(building.level) + 1;
      if (targetLevel > cfg.maxLevel) throw new Error('Достигнут максимальный уровень');

      const cost = type === 'hq' ? HQ_UPGRADES[targetLevel]?.cost : upgradeCost(type, Number(building.level));
      if (!cost) throw new Error('Следующее улучшение HQ пока не настроено');
      if (!canPay(state, cost)) throw new Error('Не хватает ресурсов');

      const activeQueue = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM buildings
        WHERE user_id=${userId} AND status IN ('building','upgrading')
      `;
      const maxQueue = premium ? 3 : 2;
      if (Number(activeQueue[0]?.count ?? 0) >= maxQueue) throw new Error(`Очередь строительства заполнена (${maxQueue})`);

      const seconds = type === 'hq'
        ? Math.max(5, Math.ceil((HQ_UPGRADES[targetLevel]?.timeSec ?? 0) * (premium ? 0.95 : 1)))
        : buildTimeSec(type, targetLevel, premium);

      await tx`
        UPDATE game_states SET
          ore=ore-${cost.ore ?? 0}, energy=energy-${cost.energy ?? 0},
          parts=parts-${cost.parts ?? 0}, credits=credits-${cost.credits ?? 0}, updated_at=now()
        WHERE user_id=${userId}
      `;
      await tx`
        UPDATE buildings SET status='upgrading', target_level=${targetLevel},
          completes_at=now()+make_interval(secs => ${seconds}), updated_at=now()
        WHERE id=${building.id}
      `;
      await recordProgressEvent(tx, userId, 'build_started', 1, {
        building_type: type,
        target_level: targetLevel,
        action: 'upgrade',
      });
      await enqueueNotification(tx, userId, 'building_ready', `building:${building.id}:${targetLevel}`, new Date(Date.now()+seconds*1000), { name: `${cfg.name} ур. ${targetLevel}`, buildingId: building.id });
      return { buildingId, targetLevel, seconds, cost };
    });

    return NextResponse.json({ ok: true, result, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
