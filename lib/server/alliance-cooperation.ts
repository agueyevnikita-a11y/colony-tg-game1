import crypto from 'node:crypto';
import { sql } from './db';
import { storageCaps } from '@/lib/game/economy';
import { productionMultipliers } from '@/lib/game/research';
import { completedResearchKeys } from './research';
import { recordAllianceCompetitionContribution } from './alliance-competition';
import {
  ALLIANCE_COOPERATION_DURATION_SEC, ALLIANCE_COOPERATION_MAX_UNITS, ALLIANCE_COOPERATION_SHARED_SCIENCE,
  ALLIANCE_COOPERATION_TECH_COSTS, COOPERATION_ROLES, COOPERATION_TECHNOLOGIES,
  cooperationFinalReward, cooperationModuleReward, cooperationTeamBonus, parseAllianceCooperationRequest,
  type CooperationRequest, type CooperationReward,
} from '@/lib/game/alliance-cooperation';

const emptyReward = (): CooperationReward => ({ ore: 0, credits: 0, science: 0 });
const json = (value: any): any => typeof value === 'string' ? JSON.parse(value) : value;
const timestamp = (value: any) => new Date(value).toISOString();

export async function allianceCooperationSchemaReady(tx: any): Promise<boolean> {
  const [row] = await tx`SELECT to_regclass('alliance_cooperation_progress') AS progress,
    to_regclass('alliance_cooperation_operations') AS operations,to_regclass('alliance_cooperation_contributions') AS contributions,
    to_regclass('alliance_cooperation_requests') AS requests`;
  return Boolean(row?.progress && row?.operations && row?.contributions && row?.requests);
}

/** All new mutation paths acquire state → membership → sorted alliances → operation. */
async function lockedContext(tx: any, userId: string, extraAllianceIds: string[] = []) {
  const [state] = await tx`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`;
  if (!state) throw new Error('Игровой профиль не найден');
  const [member] = await tx`SELECT am.alliance_id,am.role,a.name FROM alliance_members am JOIN alliances a ON a.id=am.alliance_id
    WHERE am.user_id=${userId} FOR UPDATE OF am`;
  const ids = [...new Set([...extraAllianceIds, ...(member ? [member.alliance_id] : [])])].sort();
  const alliances = ids.length ? await tx`SELECT id,name FROM alliances WHERE id IN ${tx(ids)} ORDER BY id FOR UPDATE` : [];
  return { state, member: member && alliances.some((alliance: any) => alliance.id === member.alliance_id) ? member : null };
}

async function ensureProgress(tx: any, allianceId: string) {
  await tx`INSERT INTO alliance_cooperation_progress(alliance_id) VALUES(${allianceId}) ON CONFLICT DO NOTHING`;
  return (await tx`SELECT * FROM alliance_cooperation_progress WHERE alliance_id=${allianceId} FOR UPDATE`)[0];
}

async function contributionRows(tx: any, operationId: string) {
  return tx`SELECT * FROM alliance_cooperation_contributions WHERE operation_id=${operationId} ORDER BY created_at,id`;
}

function teamOf(rows: any[]) {
  const participants = new Set(rows.map(row => row.user_id)).size;
  const roles = [...new Set<string>(rows.map(row => String(row.role)))];
  return { participants, roles, bonus: cooperationTeamBonus(participants, roles.length) };
}

/** Guild lock is already held when it still exists. Never locks another player's state. */
async function settleOperation(tx: any, operation: any) {
  if (operation.status === 'settled' || new Date(operation.ends_at).getTime() > Date.now()) return operation;
  const rows = await contributionRows(tx, operation.id), team = teamOf(rows);
  const sharedScience = rows.length * ALLIANCE_COOPERATION_SHARED_SCIENCE;
  // An erased guild cannot erase personal receipts; its shared science has no recipient.
  const [alliance] = await tx`SELECT id FROM alliances WHERE id=${operation.alliance_id}`;
  if (alliance && sharedScience) {
    await ensureProgress(tx, operation.alliance_id);
    await tx`UPDATE alliance_cooperation_progress SET shared_science=shared_science+${sharedScience},updated_at=now()
      WHERE alliance_id=${operation.alliance_id}`;
  }
  return (await tx`UPDATE alliance_cooperation_operations SET status='settled',team_bonus_percent=${team.bonus},
    shared_science_awarded=${sharedScience},settled_at=now() WHERE id=${operation.id} RETURNING *`)[0];
}

async function settleRelevant(tx: any, allianceIds: string[]) {
  if (!allianceIds.length) return;
  const operations = await tx`SELECT * FROM alliance_cooperation_operations WHERE alliance_id IN ${tx(allianceIds)}
    AND status='active' AND ends_at<=now() ORDER BY alliance_id,id FOR UPDATE`;
  for (const operation of operations) await settleOperation(tx, operation);
}

function sumRewards(rows: any[], bonus: number): CooperationReward {
  return rows.reduce((total, row) => {
    const reward = cooperationFinalReward(json(row.reward_json), bonus);
    return { ore: total.ore + reward.ore, credits: total.credits + reward.credits, science: total.science + reward.science };
  }, emptyReward());
}

async function oreCapacity(tx: any, userId: string) {
  const warehouses = await tx`SELECT level FROM buildings WHERE user_id=${userId} AND type='warehouse' AND status='active'`;
  const completed = await completedResearchKeys(tx, userId);
  const cap = Math.floor(storageCaps(warehouses.map((row: any) => Number(row.level))).ore * productionMultipliers(completed).storage);
  const [held] = await tx`SELECT COALESCE(sum(amount_remaining),0)::bigint AS ore FROM market_orders
    WHERE user_id=${userId} AND resource='ore' AND status='open' AND expires_at>now()`;
  return Math.max(0, cap - Number(held.ore));
}

export async function getAllianceCooperationState(tx: any, userId: string) {
  const rules = { durationSec: ALLIANCE_COOPERATION_DURATION_SEC, maxUnitsPerPlayer: ALLIANCE_COOPERATION_MAX_UNITS,
    sharedSciencePerUnit: ALLIANCE_COOPERATION_SHARED_SCIENCE };
  if (!(await allianceCooperationSchemaReady(tx))) return { available: false, current: null, pending: [], progress: null, roleOptions: COOPERATION_ROLES, rules };
  const ownPending = await tx`SELECT DISTINCT o.alliance_id FROM alliance_cooperation_operations o
    JOIN alliance_cooperation_contributions c ON c.operation_id=o.id WHERE c.user_id=${userId} AND c.claimed_at IS NULL`;
  const { state, member } = await lockedContext(tx, userId, ownPending.map((row: any) => row.alliance_id));
  const relevant = [...new Set<string>([...ownPending.map((row: any) => row.alliance_id), ...(member ? [member.alliance_id] : [])])].sort();
  await settleRelevant(tx, relevant);
  const progressRow = member ? await ensureProgress(tx, member.alliance_id) : null;
  const canResearch = Boolean(member && (member.role === 'owner' || member.role === 'officer'));
  const technologySnapshot = { drilling: Number(progressRow?.drilling_level ?? 0), analysis: Number(progressRow?.analysis_level ?? 0) };
  const progress = progressRow ? { sharedScience: Number(progressRow.shared_science), canResearch,
    technologies: COOPERATION_TECHNOLOGIES.map(technology => {
      const level = technologySnapshot[technology.id], nextCost = ALLIANCE_COOPERATION_TECH_COSTS[level] ?? null;
      return { ...technology, level, maxLevel: ALLIANCE_COOPERATION_TECH_COSTS.length, nextCost,
        canResearch: canResearch && nextCost !== null && Number(progressRow.shared_science) >= nextCost };
    }) } : null;
  const [currentRow] = member ? await tx`SELECT * FROM alliance_cooperation_operations WHERE alliance_id=${member.alliance_id}
    ORDER BY started_at DESC,id DESC LIMIT 1` : [];
  const currentRows = currentRow ? await contributionRows(tx, currentRow.id) : [];
  const currentTeam = teamOf(currentRows), currentMine = currentRows.filter((row: any) => row.user_id === userId);
  const currentBonus = currentRow?.status === 'settled' ? Number(currentRow.team_bonus_percent) : currentTeam.bonus;
  // Detailed teamwork is visible only for the viewer's current alliance, never pending cargo.
  const participantIds = [...new Set<string>(currentRows.map((row: any) => row.user_id))];
  const participantProfiles = participantIds.length ? await tx`SELECT u.id,
    COALESCE(NULLIF(u.colony_name,''),NULLIF(u.first_name,''),NULLIF(u.username,''),'Колонист') AS name,
    EXISTS(SELECT 1 FROM alliance_members am WHERE am.user_id=u.id AND am.alliance_id=${member.alliance_id}) AS is_current_member
    FROM users u WHERE u.id IN ${tx(participantIds)}` : [];
  const team = participantIds.map(participantId => {
    const profile = participantProfiles.find((row: any) => row.id === participantId);
    const modules = currentRows.filter((row: any) => row.user_id === participantId);
    return { name: String(profile?.name ?? 'Колонист'), isMe: participantId === userId,
      isCurrentMember: Boolean(profile?.is_current_member), units: modules.length,
      roles: COOPERATION_ROLES.map(role => ({ id: role.id, units: modules.filter((row: any) => row.role === role.id).length })).filter(role => role.units > 0) };
  });
  const current = currentRow ? { id: currentRow.id, allianceId: currentRow.alliance_id, allianceName: currentRow.alliance_name,
    status: currentRow.status, startedAt: timestamp(currentRow.started_at), endsAt: timestamp(currentRow.ends_at), participants: currentTeam.participants,
    roles: currentTeam.roles, team, teamBonusPercent: currentBonus, sharedScience: currentRows.length * ALLIANCE_COOPERATION_SHARED_SCIENCE,
    technologySnapshot: { drilling: Number(currentRow.drilling_level), analysis: Number(currentRow.analysis_level) },
    myUnits: currentMine.length, maxUnits: ALLIANCE_COOPERATION_MAX_UNITS,
    myContributions: currentMine.map((row: any) => ({ id: row.id, role: row.role, cost: json(row.cost_json),
      reward: cooperationFinalReward(json(row.reward_json), currentBonus), claimedAt: row.claimed_at ? timestamp(row.claimed_at) : null })),
    myReward: sumRewards(currentMine, currentBonus) } : null;
  const pendingOperations = await tx`SELECT DISTINCT o.* FROM alliance_cooperation_operations o
    JOIN alliance_cooperation_contributions c ON c.operation_id=o.id WHERE c.user_id=${userId} AND c.claimed_at IS NULL
    ORDER BY o.started_at,o.id`;
  const capacity = pendingOperations.length ? await oreCapacity(tx, userId) : 0;
  const pending = [];
  for (const operation of pendingOperations) {
    const rows = await contributionRows(tx, operation.id), mine = rows.filter((row: any) => row.user_id === userId && !row.claimed_at);
    const bonus = operation.status === 'settled' ? Number(operation.team_bonus_percent) : teamOf(rows).bonus;
    const reward = sumRewards(mine, bonus);
    const ready = operation.status === 'settled', shortage = Math.max(0, Number(state.ore) + reward.ore - capacity);
    pending.push({ id: operation.id, allianceName: operation.alliance_name, endsAt: timestamp(operation.ends_at), status: ready ? 'ready' : 'active',
      units: mine.length, reward, canClaim: ready && shortage === 0, storageShortages: { ore: shortage } });
  }
  const roleTechnologies = current?.status === 'active' ? current.technologySnapshot : technologySnapshot;
  return { available: true, current, pending, progress,
    roleOptions: COOPERATION_ROLES.map(role => ({ ...role, reward: cooperationModuleReward(role.id, roleTechnologies) })), rules };
}

export async function runAllianceCooperationAction(userId: string, input: CooperationRequest) {
  const request = parseAllianceCooperationRequest(input), fingerprint = JSON.stringify(request);
  return sql.begin(async (tx: any) => {
    if (!(await allianceCooperationSchemaReady(tx))) throw new Error('Совместная добыча появится после обновления сервера');
    const [target] = request.action === 'claim' ? await tx`SELECT alliance_id FROM alliance_cooperation_operations WHERE id=${request.operationId}` : [];
    const { state, member } = await lockedContext(tx, userId, target ? [target.alliance_id] : []);
    const [receipt] = await tx`SELECT fingerprint,result_json FROM alliance_cooperation_requests WHERE user_id=${userId} AND request_id=${request.requestId}`;
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new Error('Идентификатор уже использован для другого действия');
      return json(receipt.result_json);
    }
    let result: Record<string, unknown>;
    if (request.action === 'claim') {
      const [rawOperation] = await tx`SELECT * FROM alliance_cooperation_operations WHERE id=${request.operationId} FOR UPDATE`;
      if (!rawOperation) throw new Error('Операция добычи не найдена');
      const rows = await contributionRows(tx, rawOperation.id), mine = rows.filter((row: any) => row.user_id === userId && !row.claimed_at);
      if (!mine.length) throw new Error('Нет добычи для получения');
      if (new Date(rawOperation.ends_at).getTime() > Date.now()) throw new Error('Совместная добыча ещё продолжается');
      const operation = await settleOperation(tx, rawOperation), bonus = Number(operation.team_bonus_percent);
      const reward = sumRewards(mine, bonus);
      const cap = await oreCapacity(tx, userId);
      if (Number(state.ore) + reward.ore > cap) throw new Error(`На складе не хватает места для ${Number(state.ore) + reward.ore - cap} руды. Вся добыча сохранена.`);
      await tx`UPDATE alliance_cooperation_contributions SET claimed_at=now() WHERE operation_id=${operation.id} AND user_id=${userId} AND claimed_at IS NULL`;
      await tx`UPDATE game_states SET ore=ore+${reward.ore},credits=credits+${reward.credits},science=science+${reward.science},updated_at=now() WHERE user_id=${userId}`;
      result = { operationId: operation.id, reward, count: mine.length };
    } else {
      if (!member) throw new Error('Сначала вступи в альянс');
      await settleRelevant(tx, [member.alliance_id]);
      const progress = await ensureProgress(tx, member.alliance_id);
      if (request.action === 'start') {
        const [active] = await tx`SELECT * FROM alliance_cooperation_operations WHERE alliance_id=${member.alliance_id} AND status='active' FOR UPDATE`;
        if (active) result = { operationId: active.id, endsAt: timestamp(active.ends_at), started: false };
        else {
          const [operation] = await tx`INSERT INTO alliance_cooperation_operations(alliance_id,alliance_name,ends_at,drilling_level,analysis_level)
            VALUES(${member.alliance_id},${member.name},now()+make_interval(secs=>${ALLIANCE_COOPERATION_DURATION_SEC}),${Number(progress.drilling_level)},${Number(progress.analysis_level)}) RETURNING *`;
          result = { operationId: operation.id, endsAt: timestamp(operation.ends_at), started: true };
        }
      } else if (request.action === 'research') {
        if (member.role !== 'owner' && member.role !== 'officer') throw new Error('Технологии альянса развивают владелец и офицеры');
        const level = Number(request.technologyId === 'drilling' ? progress.drilling_level : progress.analysis_level);
        if (level !== request.expectedLevel) throw new Error('Уровень технологии изменился. Обнови альянс перед покупкой.');
        const cost = ALLIANCE_COOPERATION_TECH_COSTS[level];
        if (cost === undefined) throw new Error('Достигнут максимальный уровень технологии');
        if (Number(progress.shared_science) < cost) throw new Error('Недостаточно общей науки альянса');
        if (request.technologyId === 'drilling') await tx`UPDATE alliance_cooperation_progress SET shared_science=shared_science-${cost},drilling_level=drilling_level+1,updated_at=now() WHERE alliance_id=${member.alliance_id}`;
        else await tx`UPDATE alliance_cooperation_progress SET shared_science=shared_science-${cost},analysis_level=analysis_level+1,updated_at=now() WHERE alliance_id=${member.alliance_id}`;
        result = { technologyId: request.technologyId, level: level + 1, cost, sharedScience: Number(progress.shared_science) - cost };
      } else {
        const [operation] = await tx`SELECT * FROM alliance_cooperation_operations WHERE id=${request.operationId} AND alliance_id=${member.alliance_id} FOR UPDATE`;
        if (!operation || operation.status !== 'active' || new Date(operation.ends_at).getTime() <= Date.now()) throw new Error('Эта операция уже завершилась');
        const [count] = await tx`SELECT count(*)::integer AS units FROM alliance_cooperation_contributions WHERE operation_id=${operation.id} AND user_id=${userId}`;
        if (Number(count.units) >= ALLIANCE_COOPERATION_MAX_UNITS) throw new Error(`На операцию доступно ${ALLIANCE_COOPERATION_MAX_UNITS} модуля от игрока`);
        const role = COOPERATION_ROLES.find(item => item.id === request.role)!;
        for (const [resource, amount] of Object.entries(role.cost)) if (Number(state[resource] ?? 0) < Number(amount)) throw new Error('Не хватает ресурсов для модуля');
        const reward = cooperationModuleReward(role.id, { drilling: Number(operation.drilling_level), analysis: Number(operation.analysis_level) });
        const contributionId = crypto.randomUUID();
        await tx`UPDATE game_states SET energy=energy-${role.cost.energy ?? 0},parts=parts-${role.cost.parts ?? 0},science=science-${role.cost.science ?? 0},updated_at=now() WHERE user_id=${userId}`;
        await tx`INSERT INTO alliance_cooperation_contributions(id,operation_id,user_id,role,cost_json,reward_json)
          VALUES(${contributionId},${operation.id},${userId},${role.id},${tx.json(role.cost)},${tx.json(reward)})`;
        const competition = await recordAllianceCompetitionContribution(tx, { userId, allianceId: member.alliance_id, sourceId: contributionId });
        // The league period lock can queue this transaction past the mining deadline.
        // Use a fresh database clock after that wait; rejecting rolls back every ledger and cost.
        const [accepted] = await tx`SELECT clock_timestamp() AS accepted_at`;
        if (new Date(accepted.accepted_at).getTime() >= new Date(operation.ends_at).getTime()) {
          throw new Error('Операция добычи завершилась. Ресурсы не списаны — обнови альянс.');
        }
        result = { contributionId, operationId: operation.id, role: role.id, cost: role.cost, reward, competition };
      }
    }
    await tx`INSERT INTO alliance_cooperation_requests(user_id,request_id,fingerprint,result_json)
      VALUES(${userId},${request.requestId},${fingerprint},${tx.json(result)})`;
    return result;
  });
}
