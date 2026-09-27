import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { recordProgressEvent } from '@/lib/server/progression';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    await reconcilePlayer(userId);
    const { contractId } = (await request.json()) as { contractId: string };

    await sql.begin(async (tx) => {
      const rows = await tx<any[]>`
        SELECT * FROM npc_contracts
        WHERE id=${contractId} AND user_id=${userId} AND completed_at IS NULL AND expires_at > now()
        FOR UPDATE
      `;
      const c = rows[0];
      if (!c) throw new Error('Контракт истёк или не найден');
      const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
      const resource = c.resource as 'ore' | 'parts';
      if (Number(state[resource]) < Number(c.amount)) throw new Error(`Не хватает ресурса: ${resource === 'ore' ? 'руды' : 'деталей'}`);

      if (resource === 'ore') {
        await tx`UPDATE game_states SET ore=ore-${Number(c.amount)}, credits=credits+${Number(c.credit_reward)}, updated_at=now() WHERE user_id=${userId}`;
      } else {
        await tx`UPDATE game_states SET parts=parts-${Number(c.amount)}, credits=credits+${Number(c.credit_reward)}, updated_at=now() WHERE user_id=${userId}`;
      }
      await tx`UPDATE npc_contracts SET completed_at=now() WHERE id=${c.id}`;
      await recordProgressEvent(tx, userId, 'contract_completed', 1, { resource, amount: Number(c.amount), credits: Number(c.credit_reward) });
    });

    return NextResponse.json({ ok: true, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
