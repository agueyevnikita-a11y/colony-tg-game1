import { LOCAL_PROFILES, localProfileByKey, type LocalProfileKey } from '../game/local-profiles';
import type { BuildingType } from '../game/config';
import type { ResearchKey } from '../game/research';

export { LOCAL_PROFILES, localProfileByKey, type LocalProfileKey } from '../game/local-profiles';
type Environment = Record<string, string | undefined>;

/** No database import is allowed until all local-only boundaries pass. */
export function localProfilesAvailable(request: Request, env: Environment = process.env): boolean {
  if (env.NODE_ENV !== 'development' || env.ALLOW_DEV_AUTH !== 'true' || env.NEXT_PUBLIC_LOCAL_DEV !== 'true') return false;
  try {
    const raw = env.DATABASE_URL ?? '';
    if (raw !== raw.trim()) return false;
    const db = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.hostname !== '127.0.0.1' || db.port !== '55432'
      || db.pathname !== '/colony_local' || db.username !== 'colony_local' || db.search || db.hash) return false;
    const url = new URL(request.url);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '3015' || url.username || url.password) return false;
    const host = request.headers.get('host');
    if (host !== null && host.toLowerCase() !== url.host) return false;
    const forwardedHost = request.headers.get('x-forwarded-host');
    if (forwardedHost !== null && forwardedHost.toLowerCase() !== url.host) return false;
    const origin = request.headers.get('origin');
    if (origin !== null && (new URL(origin).origin !== url.origin || origin !== new URL(origin).origin)) return false;
    if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
    return true;
  } catch { return false; }
}

export function parseLocalProfileSelection(body: unknown): LocalProfileKey {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(body))
    || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'profile')) throw new Error('Выбери локальный профиль.');
  const profile = localProfileByKey((body as Record<string, unknown>).profile);
  if (!profile) throw new Error('Локальный профиль не найден.');
  return profile.key;
}

export const LOCAL_DEVELOPED_RESEARCH: readonly ResearchKey[] = [
  'basic_theory', 'extraction_ai', 'solar_lattice', 'deep_drilling', 'photovoltaic_arrays',
  'thermal_recovery', 'precision_casting', 'industrial_casting', 'deep_navigation',
  'signal_analysis', 'urban_ecology', 'public_spaces', 'trade_network', 'expedition_protocols',
];

export const LOCAL_DEVELOPED_BUILDINGS: readonly { type: BuildingType; level: number; x: number; y: number }[] = [
  { type: 'hq', level: 5, x: 3, y: 3 },
  { type: 'mine', level: 3, x: 1, y: 3 },
  { type: 'solar', level: 3, x: 2, y: 2 },
  { type: 'foundry', level: 2, x: 2, y: 3 },
  { type: 'warehouse', level: 3, x: 3, y: 4 },
  { type: 'habitat', level: 2, x: 4, y: 4 },
  { type: 'research_lab', level: 4, x: 4, y: 3 },
  { type: 'trade_hub', level: 1, x: 5, y: 3 },
  { type: 'expedition_center', level: 1, x: 5, y: 4 },
  { type: 'deep_mine', level: 1, x: 1, y: 4 },
  { type: 'solar_array', level: 1, x: 2, y: 4 },
];
const developedDecor = [
  { type: 'road', x: 3, y: 2 }, { type: 'tree', x: 4, y: 2 },
  { type: 'bench', x: 5, y: 2 }, { type: 'fountain', x: 6, y: 2 },
];

/** Existing identities are never modified; only a newly inserted fixture is seeded. */
export async function ensureLocalProfile(request: Request, key: LocalProfileKey) {
  if (!localProfilesAvailable(request)) throw new Error('Локальные профили недоступны.');
  const profile = localProfileByKey(key);
  if (!profile) throw new Error('Локальный профиль не найден.');
  // Use the guarded URL directly, not a potentially cached game database client.
  const databaseUrl = process.env.DATABASE_URL!;
  const [{ default: postgres }, { storageCaps }, { calculateComfort }, { TUTORIAL_STEPS }] = await Promise.all([
    import('postgres'), import('../game/economy'), import('../game/comfort'), import('../game/tutorial'),
  ]);
  const db = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  try {
    await db.begin(async tx => {
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO users(telegram_id,first_name,username,language_code)
        VALUES(${profile.id},'Dev',${`dev_${profile.id}`},'ru')
        ON CONFLICT(telegram_id) DO NOTHING RETURNING id
      `;
      if (!created || key !== 'developed') return;
      const caps = storageCaps(LOCAL_DEVELOPED_BUILDINGS.filter(building => building.type === 'warehouse').map(building => building.level));
      await tx`
        UPDATE users SET colony_name='Испытательный сектор',profile_bio='Локальная база для проверки механик COLONY.',profile_completed_at=now()
        WHERE id=${created.id}
      `;
      await tx`
        INSERT INTO game_states(user_id,hq_level,ore,energy,parts,credits,crystals,science,tutorial_step,tutorial_completed_at)
        VALUES(${created.id},5,${Math.min(5000, caps.ore)},${Math.min(4000, caps.energy)},${Math.min(500, caps.parts)},30000,100,3000,${TUTORIAL_STEPS.length},now())
      `;
      for (const building of LOCAL_DEVELOPED_BUILDINGS) await tx`
        INSERT INTO buildings(user_id,type,level,x,y,status)
        VALUES(${created.id},${building.type},${building.level},${building.x},${building.y},'active')
      `;
      for (const research of LOCAL_DEVELOPED_RESEARCH) await tx`
        INSERT INTO user_research(user_id,research_key,status,started_at,completes_at,completed_at)
        VALUES(${created.id},${research},'completed',now(),now(),now())
      `;
      for (const decor of developedDecor) await tx`
        INSERT INTO city_decor(user_id,type,x,y) VALUES(${created.id},${decor.type},${decor.x},${decor.y})
      `;
      await tx`
        INSERT INTO player_stats(user_id,buildings_started,research_completed,max_comfort)
        VALUES(${created.id},${LOCAL_DEVELOPED_BUILDINGS.length},${LOCAL_DEVELOPED_RESEARCH.length},${calculateComfort(developedDecor).score})
      `;
      await tx`
        INSERT INTO analytics_events(user_id,event_name,payload)
        VALUES(${created.id},'local_profile_seeded',${tx.json({ profile: key })})
      `;
    });
  } finally { await db.end({ timeout: 2 }); }
  return profile;
}
