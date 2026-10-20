import { randomInt } from 'node:crypto';
import { sql, type Transaction, type JsonValue } from './db';
import {
  COLONY_EVENT_COOLDOWN_SEC, colonyEventsUnlocked, eligibleColonyEvents, evaluateColonyChoice,
  type ColonyEventDefinition, type ColonyEventAmounts,
} from '@/lib/game/colony-events';
import { storageCaps } from '@/lib/game/economy';
import { productionMultipliers, researchByKey } from '@/lib/game/research';
import { completedResearchKeys } from './research';

type EventResult = {
  id: string;
  title: string;
  choiceTitle: string;
  resultText: string;
  cost: ColonyEventAmounts;
  reward: ColonyEventAmounts;
  resolvedAt: string;
};

const requiredColumns = ['id', 'user_id', 'event_key', 'status', 'event_json', 'choice_id', 'result_json', 'created_at', 'resolved_at'];

/** No cache: a running server sees the feature immediately after migration. */
export async function colonyEventsSchemaReady(tx: Transaction) {
  const rows = await tx<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='colony_events'
  `;
  const columns = new Set(rows.map((row) => row.column_name));
  return requiredColumns.every((column) => columns.has(column));
}

function definitionOf(row: any): ColonyEventDefinition {
  const definition = typeof row.event_json === 'string' ? JSON.parse(row.event_json) : row.event_json;
  if (!definition || typeof definition !== 'object' || !Array.isArray(definition.choices)) throw new Error('Событие колонии повреждено');
  return definition;
}

function resultOf(row: any): EventResult {
  const result = typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json;
  if (!result || typeof result !== 'object') throw new Error('Результат события недоступен');
  return result;
}

/** Caller holds game_states FOR UPDATE; event creation shares the same lock. */
export async function getColonyEventState(tx: Transaction, userId: string, state: any, buildings: any[]) {
  const unlocked = colonyEventsUnlocked(Number(state.hq_level), Number(state.tutorial_step ?? 0));
  if (!(await colonyEventsSchemaReady(tx))) return { enabled: false, unlocked, active: null, lastResolved: null, nextAt: null };

  let pending = (await tx<any[]>`
    SELECT id,event_json,created_at FROM colony_events
    WHERE user_id=${userId} AND status='pending' LIMIT 1 FOR UPDATE
  `)[0];
  const last = (await tx<any[]>`
    SELECT id,event_key,result_json,resolved_at,
           resolved_at+make_interval(secs => ${COLONY_EVENT_COOLDOWN_SEC}) AS next_at,
           resolved_at+make_interval(secs => ${COLONY_EVENT_COOLDOWN_SEC}) <= now() AS ready
    FROM colony_events WHERE user_id=${userId} AND status='resolved'
    ORDER BY resolved_at DESC,id DESC LIMIT 1
  `)[0];
  const nextAt = last ? new Date(last.next_at).toISOString() : null;
  if (!pending && unlocked && (!last || last.ready)) {
    const eligible = eligibleColonyEvents(buildings);
    const alternatives = eligible.filter((definition) => definition.key !== last?.event_key);
    const candidates = alternatives.length ? alternatives : eligible;
    if (candidates.length) {
      const definition = candidates[randomInt(candidates.length)];
      pending = (await tx<any[]>`
        INSERT INTO colony_events (user_id,event_key,event_json)
        VALUES (${userId},${definition.key},${tx.json(definition as unknown as JsonValue)})
        ON CONFLICT (user_id) WHERE status='pending' DO NOTHING
        RETURNING id,event_json,created_at
      `)[0];
      if (!pending) pending = (await tx<any[]>`
        SELECT id,event_json,created_at FROM colony_events WHERE user_id=${userId} AND status='pending' LIMIT 1
      `)[0];
    }
  }
  return {
    enabled: true,
    unlocked,
    active: pending ? { ...definitionOf(pending), id: pending.id as string, createdAt: new Date(pending.created_at).toISOString() } : null,
    lastResolved: last ? resultOf(last) : null,
    nextAt,
  };
}

const resourceNames: Record<string, string> = { ore: 'руды', energy: 'энергии', parts: 'деталей', credits: 'кредитов', science: 'науки' };
function describeAmounts(amounts: Record<string, number>) {
  return Object.entries(amounts).map(([resource, amount]) => `${amount} ${resourceNames[resource] ?? resource}`).join(', ');
}

export async function resolveColonyEvent(userId: string, eventId: string, choiceId: string): Promise<EventResult> {
  if (typeof eventId !== 'string' || typeof choiceId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)
    || !/^[a-z][a-z0-9_]{0,63}$/.test(choiceId)) throw new Error('Некорректное решение события');
  return sql.begin(async (tx) => {
    const state = (await tx<any[]>`SELECT *,now() AS event_resolution_at FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    if (!(await colonyEventsSchemaReady(tx))) throw new Error('События колонии временно недоступны');
    const event = (await tx<any[]>`
      SELECT id,status,event_json,choice_id,result_json FROM colony_events
      WHERE id=${eventId} AND user_id=${userId} FOR UPDATE
    `)[0];
    if (!event) throw new Error('Событие не найдено');
    if (event.status === 'resolved') {
      if (event.choice_id !== choiceId) throw new Error('Для этого события уже выбрано другое решение');
      return resultOf(event);
    }
    const definition = definitionOf(event);
    const choice = definition.choices.find((item) => item.id === choiceId);
    if (!choice) throw new Error('Выбери доступное решение события');
    const completed = await completedResearchKeys(tx, userId);
    const warehouses = await tx<{ level: number }[]>`
      SELECT level FROM buildings WHERE user_id=${userId} AND type='warehouse' AND status='active'
    `;
    const baseCaps = storageCaps(warehouses.map((building) => Number(building.level)));
    const multiplier = productionMultipliers(completed).storage;
    const escrowRows = await tx<{ resource: string; amount: string }[]>`
      SELECT resource,COALESCE(sum(amount_remaining),0)::bigint AS amount
      FROM market_orders WHERE user_id=${userId} AND status='open' AND expires_at>now() GROUP BY resource
    `;
    const reserved: Record<string, number> = {};
    for (const row of escrowRows) reserved[row.resource] = Number(row.amount);
    const liquidCaps = {
      ore: Math.max(0, Math.floor(baseCaps.ore * multiplier) - (reserved.ore ?? 0)),
      energy: Math.max(0, Math.floor(baseCaps.energy * multiplier) - (reserved.energy ?? 0)),
      parts: Math.max(0, Math.floor(baseCaps.parts * multiplier) - (reserved.parts ?? 0)),
    };
    const evaluation = evaluateColonyChoice(choice, state, liquidCaps, [...completed]);
    if (evaluation.requiredResearch) throw new Error(`Сначала заверши исследование «${researchByKey(evaluation.requiredResearch)?.name ?? evaluation.requiredResearch}»`);
    if (Object.keys(evaluation.shortages).length) throw new Error(`Не хватает ${describeAmounts(evaluation.shortages)}`);
    if (Object.keys(evaluation.storageShortages).length) throw new Error(`На складе не хватает места для ${describeAmounts(evaluation.storageShortages)}. Освободи место или выбери другое решение.`);
    if (!evaluation.canResolve) throw new Error('Это решение сейчас недоступно');

    const cost = choice.cost;
    const reward = choice.reward;
    await tx`
      UPDATE game_states SET
        ore=ore-${cost.ore ?? 0}+${reward.ore ?? 0},energy=energy-${cost.energy ?? 0}+${reward.energy ?? 0},
        parts=parts-${cost.parts ?? 0}+${reward.parts ?? 0},credits=credits-${cost.credits ?? 0}+${reward.credits ?? 0},
        science=science-${cost.science ?? 0}+${reward.science ?? 0},updated_at=now()
      WHERE user_id=${userId}
    `;
    const resolvedAt = new Date(state.event_resolution_at).toISOString();
    const result: EventResult = { id: event.id, title: definition.title, choiceTitle: choice.title, resultText: choice.resultText, cost, reward, resolvedAt };
    await tx`
      UPDATE colony_events SET status='resolved',choice_id=${choice.id},result_json=${tx.json(result as unknown as JsonValue)},resolved_at=${resolvedAt}
      WHERE id=${event.id}
    `;
    return result;
  });
}
