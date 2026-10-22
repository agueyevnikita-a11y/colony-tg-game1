import { LOCAL_PROFILES, ensureLocalProfile, localProfilesAvailable, parseLocalProfileSelection } from '@/lib/server/local-profiles';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
const unavailable = () => Response.json({ ok: false, error: 'Not found' }, { status: 404, headers });

export async function GET(request: Request) {
  if (!localProfilesAvailable(request)) return unavailable();
  return Response.json({ ok: true, profiles: LOCAL_PROFILES }, { headers });
}

export async function POST(request: Request) {
  if (!localProfilesAvailable(request)) return unavailable();
  let key;
  try { key = parseLocalProfileSelection(await request.json()); }
  catch { return Response.json({ ok: false, error: 'Выбери один из локальных профилей.' }, { status: 400, headers }); }
  try { return Response.json({ ok: true, profile: await ensureLocalProfile(request, key) }, { headers }); }
  catch { return Response.json({ ok: false, error: 'Не удалось подготовить локальный профиль. Попробуй ещё раз.' }, { status: 503, headers }); }
}
