import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { recordProgressEvent } from '@/lib/server/progression';
import { completedResearchKeys } from '@/lib/server/research';
import { productionMultipliers } from '@/lib/game/research';
import { availableFoundryLinks, foundryQueueCapacity, parseFoundryOrder, quoteFoundry } from '@/lib/game/foundry';

export const runtime = 'nodejs';

// Existing job IDs also serve as durable batch receipts; no schema migration needed.
function cycleId(userId: string, requestId: string, cycle: number) {
  const hex = createHash('sha256').update(`${userId}:${requestId}:${cycle}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    const text = await request.text();
    const order = parseFoundryOrder(text.trim() ? JSON.parse(text) : {});
    await reconcilePlayer(userId);
    const requestId = order.requestId ?? randomUUID();
    const firstId = cycleId(userId, requestId, 0);

    const result = await sql.begin(async (tx) => {
      const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
      if (!state) throw new Error('Состояние игрока не найдено');
      const receipt = (await tx<any[]>`SELECT building_id FROM foundry_jobs WHERE id=${firstId} AND user_id=${userId}`)[0];
      if (receipt) return { buildingId: receipt.building_id, alreadyStarted: true };
      const buildings = await tx<any[]>`SELECT * FROM buildings WHERE user_id=${userId} ORDER BY level DESC, created_at ASC, id ASC`;
      const foundry = order.buildingId
        ? buildings.find((building) => building.id === order.buildingId && building.type === 'foundry')
        : buildings.find((building) => building.type === 'foundry' && building.status === 'active');
      if (!foundry) throw new Error('Выберите свой литейный цех');
      if (foundry.status !== 'active') throw new Error('Дождитесь окончания строительства или улучшения цеха');
      const jobs = await tx<any[]>`SELECT * FROM foundry_jobs WHERE building_id=${foundry.id} AND claimed_at IS NULL ORDER BY completes_at ASC`;
      const capacity = foundryQueueCapacity(Number(foundry.level));
      if (jobs.length + order.cycles > capacity) throw new Error(`В очереди цеха осталось мест: ${Math.max(0, capacity - jobs.length)}. Готовые детали должны поместиться на склад.`);
      if (!availableFoundryLinks(foundry, buildings).includes(order.link)) throw new Error('Связь недоступна: поставьте действующую шахту или электростанцию рядом с цехом по стороне клетки');
      const researched = await completedResearchKeys(tx, userId);
      const quote = quoteFoundry({ level: Number(foundry.level), mode: order.mode, link: order.link,
        cycles: order.cycles, partsMultiplier: productionMultipliers(researched).foundryParts });
      if (Number(state.ore) < quote.ore || Number(state.energy) < quote.energy) {
        throw new Error(`Для партии нужно ${quote.ore} руды и ${quote.energy} энергии`);
      }

      await tx`UPDATE game_states SET ore=ore-${quote.ore}, energy=energy-${quote.energy}, updated_at=now() WHERE user_id=${userId}`;
      let startsAt = Math.max(Date.now(), ...jobs.map((job) => new Date(job.completes_at).getTime()));
      for (let cycle = 0; cycle < order.cycles; cycle++) {
        const completesAt = startsAt + quote.cycleSeconds * 1000;
        await tx`
          INSERT INTO foundry_jobs (id,user_id,building_id,ore_spent,energy_spent,parts_reward,started_at,completes_at)
          VALUES (${cycleId(userId, requestId, cycle)},${userId},${foundry.id},${quote.ore/order.cycles},${quote.energy/order.cycles},
            ${quote.cycleParts},${new Date(startsAt)},${new Date(completesAt)})
        `;
        startsAt = completesAt;
      }
      await recordProgressEvent(tx, userId, 'foundry_started', order.cycles, {
        building_id: foundry.id, mode: order.mode, link: order.link, cycles: order.cycles, parts_reward: quote.parts,
      });
      return { buildingId: foundry.id, jobsStarted: order.cycles, completesAt: new Date(startsAt).toISOString() };
    });

    return NextResponse.json({ ok: true, result, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Не удалось запустить производство' }, { status: 400 });
  }
}
