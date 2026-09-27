import { NextResponse } from 'next/server';
import { getInitDataFromRequest, TelegramAuthError } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { recordDailySession } from '@/lib/server/progression';
import { logErrorEvent } from '@/lib/server/errors';
import { getAccessState } from '@/lib/server/access';
import { APP_VERSION } from '@/lib/version';
import { RateLimitError } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let userId:string|undefined;
  try {
    const auth = getInitDataFromRequest(request);
    userId = await ensurePlayer(auth.user, auth.startParam, { skipAccessGate:true });
    const access = await sql.begin(async tx=>getAccessState(tx,userId!,Number(auth.user.id)));
    if(!access.allowed){
      return NextResponse.json({ok:true,userId,telegramUser:auth.user,admin:access.isAdmin,access,limited:true,version:APP_VERSION},{headers:{'Cache-Control':'no-store'}});
    }
    await sql.begin(async (tx) => { await recordDailySession(tx, userId!); });
    const game = await reconcilePlayer(userId);
    return NextResponse.json({ ok: true, userId, telegramUser: auth.user, admin: access.isAdmin, access, version:APP_VERSION, ...game },{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    if (error instanceof TelegramAuthError) {
      const message = error.code === 'TELEGRAM_AUTH_EXPIRED'
        ? 'Сессия Telegram истекла. Закройте игру и откройте её заново через бота.'
        : 'Откройте COLONY через Telegram, чтобы войти в свою колонию.';
      return NextResponse.json({ ok: false, code: error.code, error: message }, { status: 401 });
    }
    if (error instanceof RateLimitError) {
      return NextResponse.json({ ok: false, code: 'RATE_LIMITED', error: error.message }, {
        status: 429, headers: { 'Retry-After': String(error.retryAfterSec) },
      });
    }
    void logErrorEvent({ userId, source: 'session', error });
    return NextResponse.json({ ok: false, code: 'SERVICE_UNAVAILABLE', error: 'Колония временно недоступна. Попробуйте ещё раз немного позже.' }, { status: 503 });
  }
}
