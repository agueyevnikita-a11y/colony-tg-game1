import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { analyticsEvent } from '@/lib/server/progression';

export const runtime = 'nodejs';

type Body = { period: 'daily' | 'weekly'; questKey: string };

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    const { period, questKey } = (await request.json()) as Body;

    await sql.begin(async (tx) => {
      const table = period === 'weekly' ? 'weekly_quests' : 'daily_quests';
      const rows = period === 'weekly'
        ? await tx<any[]>`SELECT * FROM weekly_quests WHERE user_id=${userId} AND quest_key=${questKey} AND week_start=date_trunc('week', CURRENT_DATE)::date FOR UPDATE`
        : await tx<any[]>`SELECT * FROM daily_quests WHERE user_id=${userId} AND quest_key=${questKey} AND quest_date=CURRENT_DATE FOR UPDATE`;
      const q = rows[0];
      if (!q) throw new Error('Задание не найдено');
      if (q.claimed_at) throw new Error('Награда уже получена');
      if (Number(q.progress) < Number(q.target)) throw new Error('Задание ещё не выполнено');

      if (table === 'weekly_quests') {
        await tx`UPDATE weekly_quests SET claimed_at=now() WHERE id=${q.id}`;
      } else {
        await tx`UPDATE daily_quests SET claimed_at=now() WHERE id=${q.id}`;
      }
      await tx`
        UPDATE game_states SET crystals=crystals+${Number(q.crystal_reward)}, credits=credits+${Number(q.credit_reward)}, updated_at=now()
        WHERE user_id=${userId}
      `;
      await analyticsEvent(tx, userId, 'quest_claimed', { period, quest_key: questKey, crystals: Number(q.crystal_reward) });
    });

    return NextResponse.json({ ok: true, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
