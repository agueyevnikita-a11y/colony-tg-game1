import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { parseAllianceDirectoryRequest } from '@/lib/game/alliance-directory';
import { getAllianceDirectory } from '@/lib/server/alliance-directory';
import { assertFeature } from '@/lib/server/feature-flags';
import { sql } from '@/lib/server/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const input = parseAllianceDirectoryRequest(await request.json());
    const userId = await ensurePlayer(auth.user, auth.startParam);
    const directory = await sql.begin(async tx => {
      await assertFeature(tx, userId, 'alliances');
      return getAllianceDirectory(tx, input);
    });
    return NextResponse.json({ ok: true, directory });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Не удалось найти альянс' }, { status: 400 });
  }
}
