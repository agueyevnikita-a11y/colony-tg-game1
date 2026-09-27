import { sql } from '@/lib/server/db';
import { cityGridSize } from '@/lib/game/config';
import { DECOR_CATALOG, type DecorType } from '@/lib/game/decor';

export async function placeDecor(userId: string, type: DecorType, rawX: number, rawY: number) {
  const cfg = DECOR_CATALOG[type];
  if (!cfg) throw new Error('Неизвестный декор');
  const x = Math.floor(Number(rawX));
  const y = Math.floor(Number(rawY));
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Некорректная клетка');

  return sql.begin(async (tx) => {
    const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    if (Number(state.hq_level) < cfg.unlockHq) throw new Error(`Декор доступен с HQ${cfg.unlockHq}`);
    const size = cityGridSize(Number(state.hq_level));
    if (x < 0 || y < 0 || x >= size || y >= size) throw new Error('Клетка за границей территории');
    if (Number(state.credits) < cfg.credits) throw new Error(`Нужно 💰${cfg.credits} кредитов`);
    const occupied = await tx<any[]>`
      SELECT 1 FROM buildings WHERE user_id=${userId} AND x=${x} AND y=${y}
      UNION ALL
      SELECT 1 FROM city_decor WHERE user_id=${userId} AND x=${x} AND y=${y}
      LIMIT 1
    `;
    if (occupied.length) throw new Error('Клетка занята');
    const rows = await tx<any[]>`
      INSERT INTO city_decor(user_id,type,x,y) VALUES(${userId},${type},${x},${y}) RETURNING *
    `;
    await tx`UPDATE game_states SET credits=credits-${cfg.credits},updated_at=now() WHERE user_id=${userId}`;
    await tx`INSERT INTO analytics_events(user_id,event_name,payload) VALUES(${userId},'decor_placed',${tx.json({ type, x, y, credits: cfg.credits })})`;
    return rows[0];
  });
}

export async function removeDecor(userId: string, decorId: string) {
  return sql.begin(async (tx) => {
    const rows = await tx<any[]>`SELECT * FROM city_decor WHERE id=${decorId} AND user_id=${userId} FOR UPDATE`;
    const decor = rows[0];
    if (!decor) throw new Error('Декор не найден');
    const cfg = DECOR_CATALOG[decor.type as DecorType];
    const refund = Math.floor((cfg?.credits ?? 0) * 0.5);
    await tx`DELETE FROM city_decor WHERE id=${decorId}`;
    if (refund > 0) await tx`UPDATE game_states SET credits=credits+${refund},updated_at=now() WHERE user_id=${userId}`;
    await tx`INSERT INTO analytics_events(user_id,event_name,payload) VALUES(${userId},'decor_removed',${tx.json({ type: decor.type, refund })})`;
    return { refund };
  });
}
