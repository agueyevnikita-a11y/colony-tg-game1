import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { recordProgressEvent } from '@/lib/server/progression';
import { completedResearchKeys } from '@/lib/server/research';
import { productionMultipliers } from '@/lib/game/research';

export const runtime = 'nodejs';

const BASE_JOB = { ore: 100, energy: 40, parts: 35, seconds: 300 };

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);

    await sql.begin(async (tx) => {
      const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
      const foundry = (await tx<any[]>`
        SELECT * FROM buildings WHERE user_id=${userId} AND type='foundry' AND status='active' ORDER BY level DESC LIMIT 1
      `)[0];
      if (!foundry) throw new Error('Сначала построй литейный цех');
      const running = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM foundry_jobs WHERE building_id=${foundry.id} AND claimed_at IS NULL
      `;
      const maxJobs = Math.min(3, 1 + Math.floor((Number(foundry.level) - 1) / 5));
      if (Number(running[0]?.count ?? 0) >= maxJobs) throw new Error('Очередь литейного цеха заполнена');
      if (Number(state.ore) < BASE_JOB.ore || Number(state.energy) < BASE_JOB.energy) {
        throw new Error('Нужно 100 руды и 40 энергии');
      }
      const completedResearch = await completedResearchKeys(tx, userId);
      const researchEffects = productionMultipliers(completedResearch);
      const seconds = Math.max(60, Math.ceil(BASE_JOB.seconds / (1 + (Number(foundry.level) - 1) * 0.12)));
      const parts = Math.floor(BASE_JOB.parts * (1 + (Number(foundry.level) - 1) * 0.08) * researchEffects.foundryParts);
      await tx`
        UPDATE game_states SET ore=ore-${BASE_JOB.ore}, energy=energy-${BASE_JOB.energy}, updated_at=now()
        WHERE user_id=${userId}
      `;
      await tx`
        INSERT INTO foundry_jobs (user_id,building_id,ore_spent,energy_spent,parts_reward,completes_at)
        VALUES (${userId},${foundry.id},${BASE_JOB.ore},${BASE_JOB.energy},${parts},now()+make_interval(secs => ${seconds}))
      `;
      await recordProgressEvent(tx, userId, 'foundry_started', 1, { building_id: foundry.id, parts_reward: parts });
    });

    return NextResponse.json({ ok: true, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
