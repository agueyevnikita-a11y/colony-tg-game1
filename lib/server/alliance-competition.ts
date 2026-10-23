import { competitionWeek, competitionPrize, competitionCosmetics, allocateAlliancePool, COMPETITION_PRIZES,
  COMPETITION_MIN_REWARD_POINTS, COMPETITION_MIN_TEAM_CONTRIBUTORS, COMPETITION_POINTS_PER_MODULE, type AllianceCompetitionState } from '@/lib/game/alliance-competition';
import { grantCosmetic } from '@/lib/server/cosmetics';

export async function allianceCompetitionSchemaReady(tx: any) {
  const [row] = await tx`SELECT to_regclass('alliance_competition_periods') AS periods,
    to_regclass('alliance_competition_bindings') AS bindings,to_regclass('alliance_competition_entries') AS entries,
    to_regclass('alliance_competition_standings') AS standings,to_regclass('alliance_competition_awards') AS awards`;
  return Boolean(row?.periods && row?.bindings && row?.entries && row?.standings && row?.awards);
}

async function ensurePeriod(tx: any) {
  const period = competitionWeek();
  await tx`INSERT INTO alliance_competition_periods(id,starts_at,ends_at) VALUES(${period.id},${period.startsAt},${period.endsAt}) ON CONFLICT DO NOTHING`;
  return period;
}

export async function recordAllianceCompetitionContribution(tx: any, input: { userId: string; allianceId: string; sourceId: string }) {
  const period = await ensurePeriod(tx);
  const row = (await tx`SELECT finalized_at FROM alliance_competition_periods WHERE id=${period.id} FOR UPDATE`)[0];
  if (row.finalized_at) throw new Error('Недельный зачёт уже закрыт');
  const alliance = (await tx`SELECT name FROM alliances WHERE id=${input.allianceId}`)[0];
  if (!alliance) throw new Error('Альянс не найден');
  await tx`INSERT INTO alliance_competition_bindings(period_id,user_id,alliance_id,alliance_name)
    VALUES(${period.id},${input.userId},${input.allianceId},${alliance.name}) ON CONFLICT DO NOTHING`;
  const binding = (await tx`SELECT alliance_id FROM alliance_competition_bindings WHERE period_id=${period.id} AND user_id=${input.userId}`)[0];
  if (binding.alliance_id !== input.allianceId) return { points: 0, eligible: false };
  const inserted = await tx`INSERT INTO alliance_competition_entries(source_id,period_id,user_id,alliance_id,alliance_name,points)
    VALUES(${input.sourceId},${period.id},${input.userId},${input.allianceId},${alliance.name},${COMPETITION_POINTS_PER_MODULE})
    ON CONFLICT(source_id) DO NOTHING RETURNING source_id`;
  return { points: inserted.length ? COMPETITION_POINTS_PER_MODULE : 0, eligible: true };
}

async function rankedPlayers(tx: any, periodId: string) {
  return tx`WITH scores AS (
    SELECT e.user_id, sum(e.points)::bigint AS points, max(e.created_at) AS last_at
    FROM alliance_competition_entries e WHERE e.period_id=${periodId} GROUP BY e.user_id
  ) SELECT s.*, u.telegram_id, COALESCE(NULLIF(u.colony_name,''),u.first_name,u.username,'Колония') AS name,
      row_number() OVER(ORDER BY s.points DESC,s.last_at ASC,s.user_id ASC)::int AS rank
    FROM scores s JOIN users u ON u.id=s.user_id ORDER BY rank`;
}

async function rankedAlliances(tx: any, periodId: string) {
  return tx`WITH members AS (
    SELECT alliance_id,user_id,sum(points)::bigint AS points FROM alliance_competition_entries
    WHERE period_id=${periodId} GROUP BY alliance_id,user_id
  ), scores AS (
    SELECT alliance_id, (array_agg(alliance_name ORDER BY created_at DESC,source_id))[1] AS name,
      sum(points)::bigint AS points,max(created_at) AS last_at,count(DISTINCT user_id)::int AS contributors,
      (SELECT count(*)::int FROM members m WHERE m.alliance_id=e.alliance_id AND m.points>=${COMPETITION_MIN_REWARD_POINTS}) AS qualified_contributors
    FROM alliance_competition_entries e WHERE period_id=${periodId} GROUP BY alliance_id
  ) SELECT *,CASE WHEN qualified_contributors>=${COMPETITION_MIN_TEAM_CONTRIBUTORS} THEN
      row_number() OVER(ORDER BY (qualified_contributors>=${COMPETITION_MIN_TEAM_CONTRIBUTORS}) DESC,points DESC,last_at ASC,alliance_id ASC)::int ELSE NULL END AS rank
    FROM scores ORDER BY rank NULLS LAST,points DESC,alliance_id`;
}

async function contributors(tx: any, periodId: string, allianceId: string) {
  const rows = await tx`SELECT user_id,sum(points)::bigint AS points FROM alliance_competition_entries
    WHERE period_id=${periodId} AND alliance_id=${allianceId} GROUP BY user_id`;
  return rows.map((row: any) => ({ userId: row.user_id, points: Number(row.points) }));
}

/** Freeze entitlements once; this never locks or pays other players' resource states. */
export async function finalizeCompetitionPeriod(tx: any, periodId: string) {
  const period = (await tx`SELECT * FROM alliance_competition_periods WHERE id=${periodId} FOR UPDATE`)[0];
  if (!period || new Date(period.ends_at).getTime() > Date.now()) return false;
  if (period.finalized_at) return true;
  const players = await rankedPlayers(tx, periodId), alliances = await rankedAlliances(tx, periodId);
  for (const player of players) {
    await tx`INSERT INTO alliance_competition_standings(period_id,kind,entity_id,name,points,rank)
      VALUES(${periodId},'personal',${player.user_id},${player.name},${player.points},${player.rank})`;
    const prize = competitionPrize(Number(player.rank));
    if (!prize || Number(player.points) < COMPETITION_MIN_REWARD_POINTS) continue;
    await tx`INSERT INTO alliance_competition_awards(period_id,user_id,kind,rank,crystals,cosmetic_ids)
      VALUES(${periodId},${player.user_id},'personal',${player.rank},${prize.personal},${tx.json(competitionCosmetics('personal', Number(player.rank)))})`;
  }
  for (const alliance of alliances) {
    await tx`INSERT INTO alliance_competition_standings(period_id,kind,entity_id,name,points,rank)
      VALUES(${periodId},'alliance',${alliance.alliance_id},${alliance.name},${alliance.points},${alliance.rank})`;
    const prize = competitionPrize(Number(alliance.rank));
    if (!prize) continue;
    const shares = allocateAlliancePool(prize.alliancePool, await contributors(tx, periodId, alliance.alliance_id));
    for (const share of shares) {
      await tx`INSERT INTO alliance_competition_awards(period_id,user_id,kind,rank,crystals,cosmetic_ids,alliance_name)
        VALUES(${periodId},${share.userId},'alliance',${alliance.rank},${share.crystals},${tx.json(competitionCosmetics('alliance', Number(alliance.rank)))},${alliance.name})`;
    }
  }
  await tx`UPDATE alliance_competition_periods SET finalized_at=now() WHERE id=${periodId}`;
  return true;
}

export async function getAllianceCompetitionState(tx: any, userId: string): Promise<AllianceCompetitionState> {
  const period = competitionWeek();
  const result: AllianceCompetitionState = { available: false, period, minimumRewardPoints: COMPETITION_MIN_REWARD_POINTS,
    pointsPerModule: COMPETITION_POINTS_PER_MODULE, minimumTeamContributors: COMPETITION_MIN_TEAM_CONTRIBUTORS, binding: null, players: [], alliances: [],
    me: { points: 0, rank: null, estimatedPersonalCrystals: 0, estimatedTeamCrystals: 0 }, rewards: [], prizes: COMPETITION_PRIZES };
  if (!await allianceCompetitionSchemaReady(tx)) return result;
  await ensurePeriod(tx);
  const due = await tx`SELECT id FROM alliance_competition_periods WHERE ends_at<=now() AND finalized_at IS NULL ORDER BY ends_at,id LIMIT 4`;
  for (const row of due) await finalizeCompetitionPeriod(tx, row.id);
  const [players, alliances, binding, awards] = await Promise.all([
    rankedPlayers(tx, period.id), rankedAlliances(tx, period.id),
    tx`SELECT alliance_id,alliance_name FROM alliance_competition_bindings WHERE period_id=${period.id} AND user_id=${userId}`,
    tx`SELECT a.*,p.ends_at FROM alliance_competition_awards a JOIN alliance_competition_periods p ON p.id=a.period_id
      WHERE a.user_id=${userId} ORDER BY a.claimed_at NULLS FIRST,p.ends_at DESC,a.kind LIMIT 30`,
  ]);
  result.available = true;
  result.players = players.slice(0, 50).map((row: any) => ({ userId: row.user_id, telegramId: String(row.telegram_id), name: row.name,
    points: Number(row.points), rank: Number(row.rank), crystals: Number(row.points) >= COMPETITION_MIN_REWARD_POINTS ? competitionPrize(Number(row.rank))?.personal ?? 0 : 0 }));
  result.alliances = alliances.slice(0, 50).map((row: any) => ({ allianceId: row.alliance_id, name: row.name, points: Number(row.points),
    rank: row.rank === null ? null : Number(row.rank), pool: competitionPrize(Number(row.rank))?.alliancePool ?? 0,
    contributors: Number(row.contributors), qualifiedContributors: Number(row.qualified_contributors) }));
  const me = players.find((row: any) => row.user_id === userId);
  if (me) result.me = { points: Number(me.points), rank: Number(me.rank), estimatedPersonalCrystals: Number(me.points) >= COMPETITION_MIN_REWARD_POINTS ? competitionPrize(Number(me.rank))?.personal ?? 0 : 0, estimatedTeamCrystals: 0 };
  if (binding[0]) {
    result.binding = { allianceId: binding[0].alliance_id, allianceName: binding[0].alliance_name };
    const team = alliances.find((row: any) => row.alliance_id === binding[0].alliance_id);
    const prize = team && competitionPrize(Number(team.rank));
    if (prize) result.me.estimatedTeamCrystals = allocateAlliancePool(prize.alliancePool, await contributors(tx, period.id, binding[0].alliance_id)).find(row => row.userId === userId)?.crystals ?? 0;
  }
  result.rewards = awards.map((row: any) => ({ periodId: row.period_id, endsAt: new Date(row.ends_at).toISOString(), kind: row.kind,
    rank: Number(row.rank), crystals: Number(row.crystals), cosmeticIds: row.cosmetic_ids, allianceName: row.alliance_name,
    claimedAt: row.claimed_at ? new Date(row.claimed_at).toISOString() : null }));
  return result;
}

export async function claimAllianceCompetitionRewards(tx: any, userId: string, periodId: string) {
  if (typeof periodId !== 'string' || periodId.length > 90 || !periodId.trim()) throw new Error('Укажи неделю награды');
  const state = (await tx`SELECT user_id FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
  if (!state) throw new Error('Игровой профиль не найден');
  if (!await allianceCompetitionSchemaReady(tx)) throw new Error('Недельная лига ещё не открыта');
  if (!await finalizeCompetitionPeriod(tx, periodId)) throw new Error('Неделя ещё не завершена');
  const awards = await tx`SELECT * FROM alliance_competition_awards WHERE period_id=${periodId} AND user_id=${userId} AND claimed_at IS NULL ORDER BY kind FOR UPDATE`;
  let crystals = 0;
  const cosmeticIds: string[] = [];
  for (const award of awards) {
    const receipt = await tx`UPDATE alliance_competition_awards SET claimed_at=now() WHERE period_id=${periodId} AND user_id=${userId} AND kind=${award.kind} AND claimed_at IS NULL RETURNING kind`;
    if (!receipt.length) continue;
    crystals += Number(award.crystals);
    for (const cosmeticId of award.cosmetic_ids) {
      await grantCosmetic(tx, userId, cosmeticId, `competition_${periodId}_${award.kind}`);
      cosmeticIds.push(cosmeticId);
    }
  }
  if (crystals) await tx`UPDATE game_states SET crystals=crystals+${crystals},updated_at=now() WHERE user_id=${userId}`;
  return { periodId, count: awards.length, crystals, cosmeticIds: [...new Set(cosmeticIds)] };
}
