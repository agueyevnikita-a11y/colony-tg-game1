import { sql } from '@/lib/server/db';
import { grantCosmetic } from '@/lib/server/cosmetics';
import {
  SUPPLY_PROJECTS, SUPPLY_PROJECT_REQUIRED_HQ, SUPPLY_PROJECT_RESOURCES,
  parseSupplyProjectRequest, remainingSupplyRequirements,
  type SupplyProjectDefinition, type SupplyProjectState, type SupplyProjectsState,
  type SupplyRequirements, type SupplyProjectRequest,
} from '@/lib/game/supply-projects';

type SupplyBuilding = { type: string; status: string; completes_at?: string | Date | null };
const emptyRequirements = (): SupplyRequirements => ({ ore: 0, energy: 0, parts: 0 });
const json = (value: any): any => typeof value === 'string' ? JSON.parse(value) : value;

export async function supplyProjectsSchemaReady(tx: any): Promise<boolean> {
  const [row] = await tx`SELECT to_regclass('supply_project_progress') AS progress,to_regclass('supply_project_requests') AS requests`;
  return Boolean(row?.progress && row?.requests);
}

function storedDefinition(row: any): SupplyProjectDefinition {
  const definition = json(row.definition_json);
  const validAmount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const valid = definition?.id === row.project_key && definition.version === Number(row.definition_version)
    && typeof definition.name === 'string' && typeof definition.description === 'string' && typeof definition.icon === 'string'
    && Array.isArray(definition.stages) && definition.stages.length === 3
    && definition.stages.every((stage: any) => stage && typeof stage.name === 'string'
      && SUPPLY_PROJECT_RESOURCES.every(resource => validAmount(stage.requirements?.[resource]))
      && ['credits', 'science', 'crystals'].every(resource => validAmount(stage.reward?.[resource]))
      && Array.isArray(stage.reward?.cosmeticIds) && stage.reward.cosmeticIds.every((id: unknown) => typeof id === 'string'));
  if (!valid) throw new Error('Сохранённые условия проекта недоступны. Поставленные ресурсы сохранены.');
  return definition;
}

function projectState(definition: SupplyProjectDefinition, row?: any): SupplyProjectState {
  const stageIndex = Number(row?.stage_index ?? 0), completed = stageIndex === definition.stages.length;
  const delivered = row ? json(row.delivered_json) as SupplyRequirements : emptyRequirements();
  const remaining = completed ? emptyRequirements() : remainingSupplyRequirements(definition.stages[stageIndex].requirements, delivered);
  return { ...definition, stageIndex, delivered, remaining, completed, started: Boolean(row),
    ready: !completed && SUPPLY_PROJECT_RESOURCES.every(resource => remaining[resource] === 0),
    completedAt: row?.completed_at ? new Date(row.completed_at).toISOString() : null };
}

function selectedLogistics(buildings: SupplyBuilding[]) {
  const rows = buildings.filter(building => building.type === 'logistics');
  return rows.find(building => building.status === 'active')
    ?? rows.find(building => building.status === 'upgrading') ?? rows[0] ?? null;
}

/** Read-only state: selecting or previewing never creates a project or reserves stock. */
export async function getSupplyProjectsState(tx: any, userId: string, hqLevel?: number, buildings?: SupplyBuilding[]): Promise<SupplyProjectsState> {
  const available = await supplyProjectsSchemaReady(tx);
  const level = hqLevel ?? Number((await tx`SELECT hq_level FROM game_states WHERE user_id=${userId}`)[0]?.hq_level ?? 0);
  const buildingRows = buildings ?? await tx`SELECT type,status,completes_at FROM buildings WHERE user_id=${userId} AND type='logistics' ORDER BY created_at,id`;
  const logistics = selectedLogistics(buildingRows);
  const lockReason = !available ? 'migration' : level < SUPPLY_PROJECT_REQUIRED_HQ ? 'hq' : logistics?.status !== 'active' ? 'logistics' : null;
  const rows = available ? await tx`SELECT * FROM supply_project_progress WHERE user_id=${userId}` : [];
  const projects = SUPPLY_PROJECTS.map(definition => {
    const row = rows.find((entry: any) => entry.project_key === definition.id);
    return projectState(row ? storedDefinition(row) : definition, row);
  });
  return { available, unlocked: lockReason === null, requiredHq: SUPPLY_PROJECT_REQUIRED_HQ, lockReason,
    logistics: logistics ? { status: logistics.status, completesAt: logistics.completes_at ? new Date(logistics.completes_at).toISOString() : null } : null,
    projects };
}

/** Own state serializes both supply actions and receipts before any project is inspected. */
export async function runSupplyProjectAction(userId: string, input: SupplyProjectRequest) {
  const request = parseSupplyProjectRequest(input), fingerprint = JSON.stringify(request);
  return sql.begin(async (tx: any) => {
    const [state] = await tx`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`;
    if (!state) throw new Error('Игровой профиль не найден');
    if (!await supplyProjectsSchemaReady(tx)) throw new Error('Проекты снабжения появятся после обновления сервера');
    const [receipt] = await tx`SELECT fingerprint,result_json FROM supply_project_requests WHERE user_id=${userId} AND request_id=${request.requestId}`;
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new Error('Номер поставки уже использован для другого действия');
      return json(receipt.result_json);
    }
    const [row] = await tx`SELECT * FROM supply_project_progress WHERE user_id=${userId} AND project_key=${request.projectKey} FOR UPDATE`;
    const definition = row ? storedDefinition(row) : SUPPLY_PROJECTS.find(project => project.id === request.projectKey)!;
    const progress = projectState(definition, row);
    if (progress.completed) throw new Error('Этот проект уже завершён. Повторная награда недоступна.');
    if (request.definitionVersion !== definition.version || request.expectedStage !== progress.stageIndex) throw new Error('Условия или этап проекта изменились. Обнови проект перед действием.');
    let result: Record<string, unknown>;
    if (request.action === 'deliver') {
      if (Number(state.hq_level) < SUPPLY_PROJECT_REQUIRED_HQ) throw new Error(`Для поставок нужен центр колонии ур. ${SUPPLY_PROJECT_REQUIRED_HQ}`);
      // A concurrent upgrade cannot disable logistics between the availability check and debit.
      const logistics = await tx`SELECT id FROM buildings WHERE user_id=${userId} AND type='logistics' AND status='active' ORDER BY id FOR SHARE`;
      if (!logistics.length) throw new Error('Для поставок нужен работающий логистический центр. Прогресс проекта сохранён.');
      if (progress.ready) throw new Error('Все ресурсы этапа доставлены. Сначала получи награду.');
      const accepted = Math.min(request.amount, progress.remaining[request.resource]);
      if (accepted <= 0) throw new Error('Этот ресурс для этапа уже доставлен. Выбери другой.');
      if (Number(state[request.resource]) < accepted) throw new Error(`Для этой поставки не хватает ${accepted - Number(state[request.resource])} ${request.resource === 'ore' ? 'руды' : request.resource === 'energy' ? 'энергии' : 'деталей'}`);
      const delivered = { ...progress.delivered, [request.resource]: progress.delivered[request.resource] + accepted };
      if (request.resource === 'ore') await tx`UPDATE game_states SET ore=ore-${accepted},updated_at=now() WHERE user_id=${userId}`;
      else if (request.resource === 'energy') await tx`UPDATE game_states SET energy=energy-${accepted},updated_at=now() WHERE user_id=${userId}`;
      else await tx`UPDATE game_states SET parts=parts-${accepted},updated_at=now() WHERE user_id=${userId}`;
      if (row) await tx`UPDATE supply_project_progress SET delivered_json=${tx.json(delivered)} WHERE user_id=${userId} AND project_key=${request.projectKey}`;
      else await tx`INSERT INTO supply_project_progress(user_id,project_key,definition_version,definition_json,stage_index,delivered_json)
        VALUES(${userId},${definition.id},${definition.version},${tx.json(definition)},0,${tx.json(delivered)})`;
      const remaining = remainingSupplyRequirements(definition.stages[progress.stageIndex].requirements, delivered);
      result = { projectKey: definition.id, definitionVersion: definition.version, stageIndex: progress.stageIndex,
        resource: request.resource, requested: request.amount, accepted, delivered, remaining,
        ready: SUPPLY_PROJECT_RESOURCES.every(resource => remaining[resource] === 0) };
    } else {
      if (!row || !progress.ready) throw new Error('Сначала доставь все ресурсы текущего этапа');
      const reward = definition.stages[progress.stageIndex].reward;
      const nextStage = progress.stageIndex + 1, completed = nextStage === definition.stages.length;
      for (const cosmeticId of reward.cosmeticIds) await grantCosmetic(tx, userId, cosmeticId, `supply_${definition.id}_stage_${progress.stageIndex}`);
      await tx`UPDATE game_states SET credits=credits+${reward.credits},science=science+${reward.science},crystals=crystals+${reward.crystals},updated_at=now() WHERE user_id=${userId}`;
      await tx`UPDATE supply_project_progress SET stage_index=${nextStage},delivered_json=${tx.json(emptyRequirements())},
        completed_at=${completed ? new Date() : null} WHERE user_id=${userId} AND project_key=${request.projectKey}`;
      result = { projectKey: definition.id, definitionVersion: definition.version, claimedStage: progress.stageIndex,
        stageIndex: nextStage, completed, reward };
    }
    await tx`INSERT INTO supply_project_requests(user_id,request_id,fingerprint,result_json)
      VALUES(${userId},${request.requestId},${fingerprint},${tx.json(result)})`;
    return result;
  });
}
