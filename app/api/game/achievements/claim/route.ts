import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { ACHIEVEMENTS } from '@/lib/game/progression';
import { analyticsEvent } from '@/lib/server/progression';
import { grantCosmetic } from '@/lib/server/cosmetics';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    const { achievementKey } = (await request.json()) as { achievementKey: string };
    const cfg = ACHIEVEMENTS.find((a) => a.key === achievementKey);
    if (!cfg) throw new Error('Достижение не найдено');

    await sql.begin(async (tx) => {
      const rows = await tx<any[]>`
        SELECT * FROM user_achievements WHERE user_id=${userId} AND achievement_key=${achievementKey} FOR UPDATE
      `;
      const unlocked = rows[0];
      if (!unlocked) throw new Error('Достижение ещё не открыто');
      if (unlocked.claimed_at) throw new Error('Награда уже получена');

      const reward = cfg.reward as { crystals?: number; cosmeticId?: string; cosmeticDays?: number };
      if (reward.crystals) {
        await tx`UPDATE game_states SET crystals=crystals+${reward.crystals}, updated_at=now() WHERE user_id=${userId}`;
      }
      if (reward.cosmeticId) {
        await grantCosmetic(tx, userId, reward.cosmeticId, `achievement:${achievementKey}`, reward.cosmeticDays);
      }
      await tx`UPDATE user_achievements SET claimed_at=now() WHERE user_id=${userId} AND achievement_key=${achievementKey}`;
      await analyticsEvent(tx, userId, 'achievement_claimed', { achievement_key: achievementKey });
    });

    return NextResponse.json({ ok: true, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
