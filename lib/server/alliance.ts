import crypto from 'node:crypto';
import { sql } from '@/lib/server/db';
import { grantCosmetic } from '@/lib/server/cosmetics';
import { analyticsEvent } from '@/lib/server/progression';
import { ACTIVE_SEASON_ID } from '@/lib/game/season';
import { getAllianceDailyState } from '@/lib/server/alliance-daily';
import {
  ALLIANCE_CREATE_COST,
  ALLIANCE_DAILY_GOALS,
  ALLIANCE_CREATE_HQ,
  ALLIANCE_JOIN_HQ,
  ALLIANCE_MEMBER_LIMIT,
  ALLIANCE_OFFICER_LIMIT,
  ALLIANCE_PROJECT_RESTART_COOLDOWN_HOURS,
  ALLIANCE_REJOIN_COOLDOWN_HOURS,
  ORBITAL_RELAY_PROJECT,
  allianceCode,
  contributionPoints,
  projectPrestigeReward,
  projectStageForCycle,
  type AllianceResource,
} from '@/lib/game/alliance';

function validateAllianceName(raw: string) {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 28) throw new Error('Название альянса: от 3 до 28 символов');
  if (!/^[\p{L}\p{N} ._\-]+$/u.test(name)) throw new Error('В названии есть недопустимые символы');
  return name;
}

async function assertCooldown(tx: any, userId: string) {
  const rows = await tx<any[]>`SELECT alliance_left_at FROM users WHERE id=${userId}`;
  const leftAt = rows[0]?.alliance_left_at ? new Date(rows[0].alliance_left_at).getTime() : 0;
  const cooldownMs = ALLIANCE_REJOIN_COOLDOWN_HOURS * 3_600_000;
  if (leftAt && Date.now() - leftAt < cooldownMs) {
    const hours = Math.ceil((cooldownMs - (Date.now() - leftAt)) / 3_600_000);
    throw new Error(`После выхода из альянса нужно подождать ещё ${hours} ч.`);
  }
}

async function membership(tx: any, userId: string) {
  return (await tx<any[]>`
    SELECT am.*, a.name AS alliance_name, a.code AS alliance_code, a.owner_user_id, a.member_limit, a.prestige
    FROM alliance_members am JOIN alliances a ON a.id=am.alliance_id
    WHERE am.user_id=${userId}
    LIMIT 1
  `)[0] ?? null;
}

async function ensureProject(tx: any, allianceId: string) {
  const current = await tx<any[]>`
    SELECT * FROM alliance_projects
    WHERE alliance_id=${allianceId} AND project_key=${ORBITAL_RELAY_PROJECT.key}
    ORDER BY cycle DESC LIMIT 1
  `;
  if (current[0]) return current[0];
  const inserted = await tx<any[]>`
    INSERT INTO alliance_projects (alliance_id, project_key, cycle, stage, status)
    VALUES (${allianceId}, ${ORBITAL_RELAY_PROJECT.key}, 1, 1, 'active')
    RETURNING *
  `;
  return inserted[0];
}

async function playerLeaderboard(tx: any) {
  return tx<any[]>`
    SELECT u.telegram_id, u.first_name, u.username, u.colony_name, COALESCE(gs.hq_level,1) AS hq_level,
           COALESCE(gs.city_score,0)::bigint AS city_score, sp.points::bigint AS points
    FROM season_progress sp
    JOIN users u ON u.id=sp.user_id
    LEFT JOIN game_states gs ON gs.user_id=u.id
    WHERE sp.season_id=${ACTIVE_SEASON_ID}
    ORDER BY sp.points DESC, gs.city_score DESC NULLS LAST, gs.hq_level DESC NULLS LAST, u.created_at ASC
    LIMIT 50
  `;
}

async function allianceLeaderboard(tx: any) {
  return tx<any[]>`
    SELECT a.id, a.name, a.code, a.prestige::bigint AS prestige,
           (COALESCE(asp.points,0) + floor(COALESCE(sum(sp.points),0) / 4.0))::bigint AS points,
           count(DISTINCT am.user_id)::int AS members
    FROM alliances a
    LEFT JOIN alliance_season_points asp ON asp.alliance_id=a.id AND asp.season_id=${ACTIVE_SEASON_ID}
    LEFT JOIN alliance_members am ON am.alliance_id=a.id
    LEFT JOIN season_progress sp ON sp.user_id=am.user_id AND sp.season_id=${ACTIVE_SEASON_ID}
    GROUP BY a.id, a.name, a.code, a.prestige, asp.points
    ORDER BY points DESC, a.prestige DESC, a.created_at ASC
    LIMIT 50
  `;
}

export async function getAllianceState(tx: any, userId: string) {
  const m = await membership(tx, userId);
  const [players, alliancesTop] = await Promise.all([playerLeaderboard(tx), allianceLeaderboard(tx)]);

  if (!m) {
    const recommended = await tx<any[]>`
      SELECT a.id, a.name, a.code, a.member_limit, a.prestige,
             count(am.user_id)::int AS members,
             COALESCE(asp.points,0)::bigint AS season_points
      FROM alliances a
      LEFT JOIN alliance_members am ON am.alliance_id=a.id
      LEFT JOIN alliance_season_points asp ON asp.alliance_id=a.id AND asp.season_id=${ACTIVE_SEASON_ID}
      GROUP BY a.id, a.name, a.code, a.member_limit, a.prestige, asp.points
      HAVING count(am.user_id) < a.member_limit
      ORDER BY COALESCE(asp.points,0) DESC, a.prestige DESC, count(am.user_id) DESC, a.created_at ASC
      LIMIT 12
    `;
    return {
      membership: null,
      recommended,
      playerLeaderboard: players,
      allianceLeaderboard: alliancesTop,
      rules: {
        createCost: ALLIANCE_CREATE_COST,
        createHq: ALLIANCE_CREATE_HQ,
        joinHq: ALLIANCE_JOIN_HQ,
        memberLimit: ALLIANCE_MEMBER_LIMIT,
        officerLimit: ALLIANCE_OFFICER_LIMIT,
        rejoinCooldownHours: ALLIANCE_REJOIN_COOLDOWN_HOURS,
        restartCooldownHours: ALLIANCE_PROJECT_RESTART_COOLDOWN_HOURS,
      },
    };
  }

  const project = await ensureProject(tx, m.alliance_id);
  const members = await tx<any[]>`
    SELECT u.telegram_id, u.first_name, u.username, u.colony_name, am.role, am.joined_at,
           COALESCE(gs.hq_level,1) AS hq_level, COALESCE(gs.city_score,0)::bigint AS city_score,
           COALESCE(sum(ac.points),0)::bigint AS contribution_points
    FROM alliance_members am
    JOIN users u ON u.id=am.user_id
    LEFT JOIN game_states gs ON gs.user_id=u.id
    LEFT JOIN alliance_contributions ac ON ac.user_id=am.user_id AND ac.project_id=${project.id}
    WHERE am.alliance_id=${m.alliance_id}
    GROUP BY u.id, u.telegram_id, u.first_name, u.username, u.colony_name, am.role, am.joined_at, gs.hq_level, gs.city_score
    ORDER BY CASE WHEN am.role='owner' THEN 0 WHEN am.role='officer' THEN 1 ELSE 2 END, COALESCE(sum(ac.points),0) DESC, am.joined_at ASC
  `;
  const myContrib = await tx<any[]>`
    SELECT resource, COALESCE(sum(amount),0)::bigint AS amount, COALESCE(sum(points),0)::bigint AS points
    FROM alliance_contributions
    WHERE project_id=${project.id} AND user_id=${userId}
    GROUP BY resource
  `;
  const seasonScore = (await tx<any[]>`
    SELECT (COALESCE(asp.points,0) + floor(COALESCE(sum(sp.points),0) / 4.0))::bigint AS points
    FROM alliances a
    LEFT JOIN alliance_season_points asp ON asp.alliance_id=a.id AND asp.season_id=${ACTIVE_SEASON_ID}
    LEFT JOIN alliance_members am ON am.alliance_id=a.id
    LEFT JOIN season_progress sp ON sp.user_id=am.user_id AND sp.season_id=${ACTIVE_SEASON_ID}
    WHERE a.id=${m.alliance_id}
    GROUP BY a.id, asp.points
  `)[0];
  const seasonPoints = Number(seasonScore?.points ?? 0);
  const cycle = Number(project.cycle ?? 1);
  const stageCfg = projectStageForCycle(Number(project.stage), cycle) ?? projectStageForCycle(3, cycle)!;
  const dailyGoalRows = await getAllianceDailyState(tx, userId, m.alliance_id);
  const dailyGoals = dailyGoalRows.map((row:any) => ({ ...row, ...(ALLIANCE_DAILY_GOALS.find((g)=>g.key===row.goal_key) ?? {}) }));
  const officerCount = members.filter((x: any) => x.role === 'officer').length;

  return {
    membership: m,
    alliance: {
      id: m.alliance_id,
      name: m.alliance_name,
      code: m.alliance_code,
      memberLimit: m.member_limit,
      prestige: Number(m.prestige ?? 0),
      seasonPoints,
      members,
      officerCount,
    },
    project: {
      ...project,
      cycle,
      title: ORBITAL_RELAY_PROJECT.title,
      description: ORBITAL_RELAY_PROJECT.description,
      stageConfig: stageCfg,
      stages: ORBITAL_RELAY_PROJECT.stages,
      myContribution: myContrib,
      canRestart: project.status === 'completed' && (m.role === 'owner' || m.role === 'officer'),
      restartAvailableAt: project.completed_at
        ? new Date(new Date(project.completed_at).getTime() + ALLIANCE_PROJECT_RESTART_COOLDOWN_HOURS * 3_600_000).toISOString()
        : null,
    },
    dailyGoals,
    playerLeaderboard: players,
    allianceLeaderboard: alliancesTop,
    rules: {
      createCost: ALLIANCE_CREATE_COST,
      createHq: ALLIANCE_CREATE_HQ,
      joinHq: ALLIANCE_JOIN_HQ,
      memberLimit: ALLIANCE_MEMBER_LIMIT,
      officerLimit: ALLIANCE_OFFICER_LIMIT,
      rejoinCooldownHours: ALLIANCE_REJOIN_COOLDOWN_HOURS,
      restartCooldownHours: ALLIANCE_PROJECT_RESTART_COOLDOWN_HOURS,
    },
  };
}

export async function createAlliance(userId: string, rawName: string) {
  const name = validateAllianceName(rawName);
  return sql.begin(async (tx) => {
    const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    if (Number(state.hq_level) < ALLIANCE_CREATE_HQ) throw new Error(`Создание альянса доступно с HQ${ALLIANCE_CREATE_HQ}`);
    if (Number(state.credits) < ALLIANCE_CREATE_COST) throw new Error(`Нужно 💰${ALLIANCE_CREATE_COST} кредитов`);
    if (await membership(tx, userId)) throw new Error('Вы уже состоите в альянсе');
    await assertCooldown(tx, userId);

    const id = crypto.randomUUID();
    let code = allianceCode(name, id);
    for (let i = 0; i < 5; i++) {
      const exists = await tx<any[]>`SELECT 1 FROM alliances WHERE code=${code} LIMIT 1`;
      if (!exists.length) break;
      code = allianceCode(name, crypto.randomUUID());
    }
    const inserted = await tx<any[]>`
      INSERT INTO alliances (id, code, name, owner_user_id, member_limit)
      VALUES (${id}, ${code}, ${name}, ${userId}, ${ALLIANCE_MEMBER_LIMIT})
      RETURNING *
    `;
    await tx`INSERT INTO alliance_members (alliance_id,user_id,role) VALUES (${id},${userId},'owner')`;
    await tx`INSERT INTO alliance_projects (alliance_id,project_key,cycle,stage,status) VALUES (${id},${ORBITAL_RELAY_PROJECT.key},1,1,'active')`;
    await tx`INSERT INTO alliance_season_points(alliance_id,season_id,points) VALUES(${id},${ACTIVE_SEASON_ID},0) ON CONFLICT DO NOTHING`;
    await tx`UPDATE game_states SET credits=credits-${ALLIANCE_CREATE_COST},updated_at=now() WHERE user_id=${userId}`;
    await analyticsEvent(tx, userId, 'alliance_created', { alliance_id: id, code });
    return inserted[0];
  });
}

export async function joinAlliance(userId: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new Error('Введите код альянса');
  return sql.begin(async (tx) => {
    const state = (await tx<any[]>`SELECT hq_level FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    if (Number(state.hq_level) < ALLIANCE_JOIN_HQ) throw new Error(`Вступление доступно с HQ${ALLIANCE_JOIN_HQ}`);
    if (await membership(tx, userId)) throw new Error('Вы уже состоите в альянсе');
    await assertCooldown(tx, userId);
    const alliance = (await tx<any[]>`SELECT * FROM alliances WHERE upper(code)=${code} FOR UPDATE`)[0];
    if (!alliance) throw new Error('Альянс с таким кодом не найден');
    const count = Number((await tx<any[]>`SELECT count(*)::int AS count FROM alliance_members WHERE alliance_id=${alliance.id}`)[0]?.count ?? 0);
    if (count >= Number(alliance.member_limit)) throw new Error('В альянсе нет свободных мест');
    await tx`INSERT INTO alliance_members(alliance_id,user_id,role) VALUES(${alliance.id},${userId},'member')`;
    await tx`INSERT INTO alliance_season_points(alliance_id,season_id,points) VALUES(${alliance.id},${ACTIVE_SEASON_ID},0) ON CONFLICT DO NOTHING`;
    await analyticsEvent(tx, userId, 'alliance_joined', { alliance_id: alliance.id, code: alliance.code });
    return alliance;
  });
}

export async function leaveAlliance(userId: string) {
  return sql.begin(async (tx) => {
    const m = await membership(tx, userId);
    if (!m) throw new Error('Вы не состоите в альянсе');
    const count = Number((await tx<any[]>`SELECT count(*)::int AS count FROM alliance_members WHERE alliance_id=${m.alliance_id}`)[0]?.count ?? 0);
    if (m.role === 'owner' && count > 1) throw new Error('Сначала передайте руководство другому участнику');
    if (m.role === 'owner') await tx`DELETE FROM alliances WHERE id=${m.alliance_id}`;
    else await tx`DELETE FROM alliance_members WHERE user_id=${userId}`;
    await tx`UPDATE users SET alliance_left_at=now() WHERE id=${userId}`;
    await analyticsEvent(tx, userId, 'alliance_left', { alliance_id: m.alliance_id });
    return true;
  });
}

async function grantStageRewards(tx: any, allianceId: string, projectId: string, stage: number, cycle: number) {
  const cfg = projectStageForCycle(stage, cycle);
  if (!cfg) return;
  const eligible = await tx<any[]>`
    SELECT am.user_id, COALESCE(sum(ac.points),0)::bigint AS points
    FROM alliance_members am
    LEFT JOIN alliance_contributions ac ON ac.user_id=am.user_id AND ac.project_id=${projectId}
    WHERE am.alliance_id=${allianceId}
    GROUP BY am.user_id
    HAVING COALESCE(sum(ac.points),0) >= ${cfg.minimumContributionPoints}
  `;
  for (const row of eligible) {
    await grantCosmetic(tx, row.user_id, cfg.rewardCosmeticId, `alliance_${projectId}_stage_${stage}`, cfg.rewardDays);
    if (stage === ORBITAL_RELAY_PROJECT.stages.length && cycle > 1) {
      await grantCosmetic(tx, row.user_id, 'effect_relay_veteran', `alliance_${projectId}_cycle_${cycle}`, 14);
    }
  }
}

export async function contributeToAlliance(userId: string, resource: AllianceResource, rawAmount: number) {
  if (!['ore', 'energy', 'parts'].includes(resource)) throw new Error('Недопустимый ресурс');
  const amount = Math.floor(Number(rawAmount));
  const minimum = resource === 'parts' ? 10 : 100;
  if (!Number.isFinite(amount) || amount < minimum) throw new Error(`Минимальный вклад: ${minimum}`);

  return sql.begin(async (tx) => {
    const m = await membership(tx, userId);
    if (!m) throw new Error('Сначала вступите в альянс');
    const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    const project = (await tx<any[]>`
      SELECT * FROM alliance_projects
      WHERE alliance_id=${m.alliance_id} AND project_key=${ORBITAL_RELAY_PROJECT.key} AND status='active'
      ORDER BY cycle DESC LIMIT 1 FOR UPDATE
    `)[0];
    if (!project) throw new Error('Сейчас нет активного мегапроекта');
    const cycle = Number(project.cycle ?? 1);
    const cfg = projectStageForCycle(Number(project.stage), cycle);
    if (!cfg) throw new Error('Неизвестный этап мегапроекта');
    const column = resource === 'ore' ? 'ore_contributed' : resource === 'energy' ? 'energy_contributed' : 'parts_contributed';
    const current = Number(project[column] ?? 0);
    const needed = Math.max(0, Number(cfg.target[resource]) - current);
    if (needed <= 0) throw new Error('Этот ресурс на текущем этапе уже собран');
    const accepted = Math.min(amount, needed);
    if (Number(state[resource]) < accepted) throw new Error('Недостаточно ресурса');
    const points = contributionPoints(resource, accepted);

    if (resource === 'ore') await tx`UPDATE game_states SET ore=ore-${accepted},updated_at=now() WHERE user_id=${userId}`;
    if (resource === 'energy') await tx`UPDATE game_states SET energy=energy-${accepted},updated_at=now() WHERE user_id=${userId}`;
    if (resource === 'parts') await tx`UPDATE game_states SET parts=parts-${accepted},updated_at=now() WHERE user_id=${userId}`;

    await tx`
      INSERT INTO alliance_contributions(project_id,user_id,stage,resource,amount,points)
      VALUES(${project.id},${userId},${project.stage},${resource},${accepted},${points})
    `;
    if (resource === 'ore') await tx`UPDATE alliance_projects SET ore_contributed=ore_contributed+${accepted},updated_at=now() WHERE id=${project.id}`;
    if (resource === 'energy') await tx`UPDATE alliance_projects SET energy_contributed=energy_contributed+${accepted},updated_at=now() WHERE id=${project.id}`;
    if (resource === 'parts') await tx`UPDATE alliance_projects SET parts_contributed=parts_contributed+${accepted},updated_at=now() WHERE id=${project.id}`;
    await tx`
      INSERT INTO alliance_season_points(alliance_id,season_id,points)
      VALUES(${m.alliance_id},${ACTIVE_SEASON_ID},${points})
      ON CONFLICT(alliance_id,season_id) DO UPDATE SET points=alliance_season_points.points+EXCLUDED.points,updated_at=now()
    `;
    await analyticsEvent(tx, userId, 'alliance_contribution', { alliance_id: m.alliance_id, resource, amount: accepted, points, stage: project.stage, cycle });

    const after = (await tx<any[]>`SELECT * FROM alliance_projects WHERE id=${project.id} FOR UPDATE`)[0];
    const complete = Number(after.ore_contributed) >= cfg.target.ore
      && Number(after.energy_contributed) >= cfg.target.energy
      && Number(after.parts_contributed) >= cfg.target.parts;
    if (complete) {
      await grantStageRewards(tx, m.alliance_id, project.id, Number(after.stage), cycle);
      const lastStage = Number(after.stage) >= ORBITAL_RELAY_PROJECT.stages.length;
      if (lastStage) {
        const prestige = projectPrestigeReward(cycle);
        await tx`UPDATE alliance_projects SET status='completed',completed_at=now(),updated_at=now() WHERE id=${project.id}`;
        await tx`UPDATE alliances SET prestige=prestige+${prestige} WHERE id=${m.alliance_id}`;
      } else {
        await tx`
          UPDATE alliance_projects
          SET stage=stage+1, ore_contributed=0, energy_contributed=0, parts_contributed=0, updated_at=now()
          WHERE id=${project.id}
        `;
      }
    }
    return { accepted, points, stageCompleted: complete };
  });
}

export async function startNextAllianceProject(userId: string) {
  return sql.begin(async (tx) => {
    const m = await membership(tx, userId);
    if (!m) throw new Error('Вы не состоите в альянсе');
    if (m.role !== 'owner' && m.role !== 'officer') throw new Error('Запускать новый цикл могут владелец и офицеры');
    const latest = (await tx<any[]>`
      SELECT * FROM alliance_projects
      WHERE alliance_id=${m.alliance_id} AND project_key=${ORBITAL_RELAY_PROJECT.key}
      ORDER BY cycle DESC LIMIT 1 FOR UPDATE
    `)[0];
    if (!latest || latest.status !== 'completed') throw new Error('Текущий мегапроект ещё не завершён');
    const availableAt = new Date(latest.completed_at).getTime() + ALLIANCE_PROJECT_RESTART_COOLDOWN_HOURS * 3_600_000;
    if (Date.now() < availableAt) {
      const hours = Math.ceil((availableAt - Date.now()) / 3_600_000);
      throw new Error(`Новый цикл можно запустить через ${hours} ч.`);
    }
    const cycle = Number(latest.cycle ?? 1) + 1;
    const rows = await tx<any[]>`
      INSERT INTO alliance_projects(alliance_id,project_key,cycle,stage,status)
      VALUES(${m.alliance_id},${ORBITAL_RELAY_PROJECT.key},${cycle},1,'active') RETURNING *
    `;
    await analyticsEvent(tx, userId, 'alliance_project_restarted', { alliance_id: m.alliance_id, cycle });
    return rows[0];
  });
}

async function memberByTelegram(tx: any, allianceId: string, telegramId: number) {
  return (await tx<any[]>`
    SELECT am.*, u.telegram_id, u.first_name, u.username, u.colony_name
    FROM alliance_members am JOIN users u ON u.id=am.user_id
    WHERE am.alliance_id=${allianceId} AND u.telegram_id=${telegramId}
    LIMIT 1
  `)[0] ?? null;
}

export async function setAllianceRole(userId: string, telegramId: number, role: 'officer' | 'member') {
  return sql.begin(async (tx) => {
    const actor = await membership(tx, userId);
    if (!actor || actor.role !== 'owner') throw new Error('Только владелец может назначать офицеров');
    const target = await memberByTelegram(tx, actor.alliance_id, telegramId);
    if (!target) throw new Error('Участник не найден');
    if (target.user_id === userId || target.role === 'owner') throw new Error('Нельзя изменить роль владельца');
    if (role === 'officer') {
      const count = Number((await tx<any[]>`SELECT count(*)::int AS count FROM alliance_members WHERE alliance_id=${actor.alliance_id} AND role='officer'`)[0]?.count ?? 0);
      if (count >= ALLIANCE_OFFICER_LIMIT && target.role !== 'officer') throw new Error(`Максимум ${ALLIANCE_OFFICER_LIMIT} офицеров`);
    }
    await tx`UPDATE alliance_members SET role=${role} WHERE alliance_id=${actor.alliance_id} AND user_id=${target.user_id}`;
    await analyticsEvent(tx, userId, 'alliance_role_changed', { target_telegram_id: telegramId, role });
    return true;
  });
}

export async function kickAllianceMember(userId: string, telegramId: number) {
  return sql.begin(async (tx) => {
    const actor = await membership(tx, userId);
    if (!actor || (actor.role !== 'owner' && actor.role !== 'officer')) throw new Error('Недостаточно прав');
    const target = await memberByTelegram(tx, actor.alliance_id, telegramId);
    if (!target) throw new Error('Участник не найден');
    if (target.role === 'owner' || target.user_id === userId) throw new Error('Этого участника нельзя исключить');
    if (actor.role === 'officer' && target.role !== 'member') throw new Error('Офицер может исключать только обычных участников');
    await tx`DELETE FROM alliance_members WHERE alliance_id=${actor.alliance_id} AND user_id=${target.user_id}`;
    await tx`UPDATE users SET alliance_left_at=now() WHERE id=${target.user_id}`;
    await analyticsEvent(tx, userId, 'alliance_member_kicked', { target_telegram_id: telegramId });
    return true;
  });
}

export async function transferAllianceOwnership(userId: string, telegramId: number) {
  return sql.begin(async (tx) => {
    const actor = await membership(tx, userId);
    if (!actor || actor.role !== 'owner') throw new Error('Только владелец может передать руководство');
    const target = await memberByTelegram(tx, actor.alliance_id, telegramId);
    if (!target || target.user_id === userId) throw new Error('Выберите другого участника');
    await tx`UPDATE alliance_members SET role='member' WHERE alliance_id=${actor.alliance_id} AND user_id=${userId}`;
    await tx`UPDATE alliance_members SET role='owner' WHERE alliance_id=${actor.alliance_id} AND user_id=${target.user_id}`;
    await tx`UPDATE alliances SET owner_user_id=${target.user_id} WHERE id=${actor.alliance_id}`;
    await analyticsEvent(tx, userId, 'alliance_ownership_transferred', { target_telegram_id: telegramId });
    return true;
  });
}

export async function claimAllianceDailyGoal(userId: string, goalKey: string) {
  return sql.begin(async (tx) => {
    const m = await membership(tx, userId);
    if (!m) throw new Error('Вы не состоите в альянсе');
    const goal = (await tx<any[]>`
      SELECT * FROM alliance_daily_goals
      WHERE alliance_id=${m.alliance_id} AND goal_date=CURRENT_DATE AND goal_key=${goalKey}
      FOR UPDATE
    `)[0];
    if (!goal) throw new Error('Командная цель не найдена');
    if (!goal.completed_at) throw new Error('Командная цель ещё не выполнена');
    const member = (await tx<any[]>`
      SELECT * FROM alliance_daily_goal_members
      WHERE alliance_id=${m.alliance_id} AND goal_date=CURRENT_DATE AND goal_key=${goalKey} AND user_id=${userId}
      FOR UPDATE
    `)[0];
    if (!member || Number(member.contribution) <= 0) throw new Error('Нужно лично внести вклад в эту цель до её завершения');
    if (member.claimed_at) throw new Error('Награда уже получена');
    await tx`
      UPDATE alliance_daily_goal_members SET claimed_at=now()
      WHERE alliance_id=${m.alliance_id} AND goal_date=CURRENT_DATE AND goal_key=${goalKey} AND user_id=${userId}
    `;
    await tx`
      UPDATE game_states SET crystals=crystals+${Number(goal.reward_crystals)}, credits=credits+${Number(goal.reward_credits)}, updated_at=now()
      WHERE user_id=${userId}
    `;
    await analyticsEvent(tx, userId, 'alliance_daily_claimed', { goal_key: goalKey, crystals: Number(goal.reward_crystals), credits: Number(goal.reward_credits) });
    return { crystals: Number(goal.reward_crystals), credits: Number(goal.reward_credits) };
  });
}
