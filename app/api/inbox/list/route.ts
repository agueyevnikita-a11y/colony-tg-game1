import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { getInboxPage } from '@/lib/server/inbox';
import { sql } from '@/lib/server/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user, auth.startParam);
    const query = await request.json();
    return NextResponse.json({ ok: true, inboxPage: await getInboxPage(sql, userId, query) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Не удалось загрузить почту' }, { status: 400 });
  }
}
