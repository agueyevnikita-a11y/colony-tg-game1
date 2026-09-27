import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { enqueueNotification, getNotificationPreferences } from '@/lib/server/notifications';
import { BUILDINGS } from '@/lib/game/config';
import { researchByKey } from '@/lib/game/research';
import { expeditionByKey } from '@/lib/game/expeditions';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    const body = await request.json().catch(() => ({}));
    const enabled = !!body.enabled;
    const prefs = await sql.begin(async (tx) => {
      await tx`
        INSERT INTO notification_preferences(user_id,enabled) VALUES(${userId},${enabled})
        ON CONFLICT(user_id) DO UPDATE SET enabled=${enabled},updated_at=now()
      `;
      if (!enabled) {
        await tx`UPDATE notification_jobs SET cancelled_at=now(),processing_at=NULL WHERE user_id=${userId} AND sent_at IS NULL AND cancelled_at IS NULL`;
      } else {
        const builds = await tx<any[]>`SELECT id,type,target_level,completes_at FROM buildings WHERE user_id=${userId} AND status IN ('building','upgrading') AND completes_at>now()`;
        for (const b of builds) {
          const cfg = BUILDINGS[b.type as keyof typeof BUILDINGS];
          await enqueueNotification(tx,userId,'building_ready',`building:${b.id}:${b.target_level ?? 1}`,b.completes_at,{name:`${cfg?.name ?? 'Здание'} ур. ${b.target_level ?? 1}`,buildingId:b.id});
        }
        const research = (await tx<any[]>`SELECT research_key,completes_at FROM user_research WHERE user_id=${userId} AND status='researching' LIMIT 1`)[0];
        if (research) { const cfg=researchByKey(research.research_key); await enqueueNotification(tx,userId,'research_ready',`research:${research.research_key}`,research.completes_at,{name:cfg?.name ?? research.research_key,researchKey:research.research_key}); }
        const expeditions = await tx<any[]>`SELECT id,expedition_key,completes_at FROM expeditions WHERE user_id=${userId} AND status='active'`;
        for (const e of expeditions) { const cfg=expeditionByKey(e.expedition_key); await enqueueNotification(tx,userId,'expedition_ready',`expedition:${e.id}`,e.completes_at,{name:cfg?.name ?? e.expedition_key,expeditionId:e.id}); }
      }
      return getNotificationPreferences(tx, userId);
    });
    return NextResponse.json({ ok: true, notifications: prefs });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 });
  }
}
