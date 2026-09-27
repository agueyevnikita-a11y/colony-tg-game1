import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer, reconcilePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';

export const runtime = 'nodejs';

function cleanName(value: unknown) {
  const name = String(value ?? '').replace(/[\u0000-\u001F\u007F]/g,'').replace(/\s+/g,' ').trim();
  if (name.length < 3 || name.length > 24) throw new Error('Название колонии: от 3 до 24 символов');
  if (/https?:\/\/|t\.me\//i.test(name)) throw new Error('Ссылки в названии колонии запрещены');
  return name;
}
function cleanBio(value: unknown) {
  const bio = String(value ?? '').replace(/[\u0000-\u001F\u007F]/g,'').replace(/\s+/g,' ').trim();
  if (bio.length > 80) throw new Error('Описание: максимум 80 символов');
  return bio;
}

export async function POST(request: Request) {
  try {
    const auth = getInitDataFromRequest(request);
    const userId = await ensurePlayer(auth.user,auth.startParam);
    const body = await request.json();
    const colonyName = cleanName(body.colonyName);
    const bio = cleanBio(body.bio);
    await sql`
      UPDATE users SET colony_name=${colonyName}, profile_bio=${bio || null}, profile_completed_at=COALESCE(profile_completed_at,now())
      WHERE id=${userId}
    `;
    return NextResponse.json({ ok:true, ...(await reconcilePlayer(userId)) });
  } catch (error) {
    return NextResponse.json({ ok:false,error:error instanceof Error?error.message:'Unknown error' },{status:400});
  }
}
