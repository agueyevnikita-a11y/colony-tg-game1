import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { recordDailySession } from '@/lib/server/progression';
import { logErrorEvent } from '@/lib/server/errors';
import { getAccessState } from '@/lib/server/access';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let userId:string|undefined;
  try {
    const auth = getInitDataFromRequest(request);
    userId = await ensurePlayer(auth.user, auth.startParam, { skipAccessGate:true });
    const access = await sql.begin(async tx=>getAccessState(tx,userId!,Number(auth.user.id)));
    if(!access.allowed){
      return NextResponse.json({ok:true,userId,telegramUser:auth.user,admin:access.isAdmin,access,limited:true,version:'1.0.1-beta.1'});
    }
    await sql.begin(async (tx) => { await recordDailySession(tx, userId!); });
    const game = await reconcilePlayer(userId);
    return NextResponse.json({ ok: true, userId, telegramUser: auth.user, admin: access.isAdmin, access, version:'1.0.1-beta.1', ...game });
  } catch (error) {
    await logErrorEvent({ userId, source: 'session', error });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 401 });
  }
}
