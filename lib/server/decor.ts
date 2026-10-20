import { sql } from '@/lib/server/db';
import { cityGridSize } from '@/lib/game/config';
import { decorByType, decorCoordinates } from '@/lib/game/decor';
import { completedResearchKeys, reconcileResearch } from '@/lib/server/research';
import { researchByKey } from '@/lib/game/research';
import { calculateComfort } from '@/lib/game/comfort';

/** Called while the player's balance lock also serializes all city changes. */
async function recordComfortPeak(tx: any, userId: string) {
  const decor = await tx<{ type: string }[]>`SELECT type FROM city_decor WHERE user_id=${userId}`;
  const { score } = calculateComfort(decor);
  await tx`UPDATE player_stats SET max_comfort=GREATEST(max_comfort,${score}),updated_at=now() WHERE user_id=${userId}`;
}

export async function placeDecor(userId: string, type: unknown, rawX: unknown, rawY: unknown) {
  const cfg = decorByType(type);
  if (!cfg) throw new Error('Неизвестный декор');
  const decorType = String(type);

  return sql.begin(async (tx) => {
    const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    const { x, y } = decorCoordinates(rawX, rawY, cityGridSize(Number(state.hq_level)));
    if (Number(state.hq_level) < cfg.unlockHq) throw new Error(`Нужна база уровня ${cfg.unlockHq}`);
    if (cfg.unlockResearch) {
      await reconcileResearch(tx, userId);
      const completed = await completedResearchKeys(tx, userId);
      if (!completed.has(cfg.unlockResearch)) throw new Error(`Нужно исследование «${researchByKey(cfg.unlockResearch)?.name ?? cfg.unlockResearch}»`);
    }
    if (Number(state.credits) < cfg.credits) throw new Error(`Нужно ${cfg.credits} кредитов для размещения`);
    const occupied = await tx<any[]>`
      SELECT 1 FROM buildings WHERE user_id=${userId} AND x=${x} AND y=${y}
      UNION ALL
      SELECT 1 FROM city_decor WHERE user_id=${userId} AND x=${x} AND y=${y}
      LIMIT 1
    `;
    if (occupied.length) throw new Error('Клетка занята');
    const rows = await tx<any[]>`
      INSERT INTO city_decor(user_id,type,x,y) VALUES(${userId},${decorType},${x},${y}) RETURNING *
    `;
    await recordComfortPeak(tx, userId);
    await tx`UPDATE game_states SET credits=credits-${cfg.credits},updated_at=now() WHERE user_id=${userId}`;
    await tx`INSERT INTO analytics_events(user_id,event_name,payload) VALUES(${userId},'decor_placed',${tx.json({ type: decorType, x, y, credits: cfg.credits })})`;
    return rows[0];
  });
}

export async function removeDecor(userId: string, decorId: string) {
  assertDecorId(decorId);
  return sql.begin(async (tx) => {
    const state = (await tx<any[]>`SELECT user_id FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    const rows = await tx<any[]>`SELECT * FROM city_decor WHERE id=${decorId} AND user_id=${userId} FOR UPDATE`;
    const decor = rows[0];
    if (!decor) throw new Error('Декор не найден');
    const cfg = decorByType(decor.type);
    const refund = Math.floor((cfg?.credits ?? 0) * 0.5);
    await recordComfortPeak(tx, userId);
    await tx`DELETE FROM city_decor WHERE id=${decorId}`;
    if (refund > 0) await tx`UPDATE game_states SET credits=credits+${refund},updated_at=now() WHERE user_id=${userId}`;
    await tx`INSERT INTO analytics_events(user_id,event_name,payload) VALUES(${userId},'decor_removed',${tx.json({ type: decor.type, refund })})`;
    return { refund };
  });
}

function assertDecorId(decorId: unknown): asserts decorId is string {
  if (typeof decorId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decorId)) {
    throw new Error('Выбери декор на карте');
  }
}

export async function moveDecor(userId: string, decorId: string, rawX: unknown, rawY: unknown) {
  assertDecorId(decorId);
  return sql.begin(async (tx) => {
    const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    const { x, y } = decorCoordinates(rawX, rawY, cityGridSize(Number(state.hq_level)));
    const decor = (await tx<any[]>`SELECT * FROM city_decor WHERE id=${decorId} AND user_id=${userId} FOR UPDATE`)[0];
    if (!decor) throw new Error('Декор не найден');
    if (Number(decor.x) === x && Number(decor.y) === y) return decor;
    const occupied = await tx<any[]>`
      SELECT 1 FROM buildings WHERE user_id=${userId} AND x=${x} AND y=${y}
      UNION ALL
      SELECT 1 FROM city_decor WHERE user_id=${userId} AND x=${x} AND y=${y} AND id<>${decorId}
      LIMIT 1
    `;
    if (occupied.length) throw new Error('Клетка занята. Выбери свободную.');
    const rows = await tx<any[]>`UPDATE city_decor SET x=${x},y=${y} WHERE id=${decorId} AND user_id=${userId} RETURNING *`;
    await tx`INSERT INTO analytics_events(user_id,event_name,payload) VALUES(${userId},'decor_moved',${tx.json({ type: decor.type, x, y })})`;
    return rows[0];
  });
}
