import type { Transaction } from '@/lib/server/db';
import { DAILY_QUESTS, WEEKLY_QUESTS } from '@/lib/game/progression';
import { analyticsEvent } from '@/lib/server/progression';

type QuestPeriod = 'daily' | 'weekly';
type QuestClaimSelection = { period: QuestPeriod; questKey: string } | { period: QuestPeriod; all: true };
type QuestClaimResult = { period: QuestPeriod; count: number; credits: number; crystals: number; questKeys: string[] };
type QuestRow = { id: string; quest_key: string; progress: number; target: number; claimed_at: unknown; credit_reward: number; crystal_reward: number };

export function parseQuestClaimSelection(body: unknown): QuestClaimSelection {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Некорректный запрос награды');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['period', 'questKey', 'all'].includes(key))) throw new Error('Некорректные параметры награды');
  if (input.period !== 'daily' && input.period !== 'weekly') throw new Error('Некорректный период задания');
  const hasKey = Object.hasOwn(input, 'questKey');
  const hasAll = Object.hasOwn(input, 'all');
  if (hasKey === hasAll) throw new Error('Выбери одно задание или все готовые');
  if (hasAll) {
    if (input.all !== true) throw new Error('Некорректный выбор заданий');
    return { period: input.period, all: true };
  }
  const catalog = input.period === 'daily' ? DAILY_QUESTS : WEEKLY_QUESTS;
  if (typeof input.questKey !== 'string' || !catalog.some((quest) => quest.key === input.questKey)) throw new Error('Некорректное задание для этого периода');
  return { period: input.period, questKey: input.questKey };
}

export async function claimQuestRewards(tx: Transaction, userId: string, selection: QuestClaimSelection): Promise<QuestClaimResult> {
  // Match production's game_states -> quest rows lock order.
  const [state] = await tx`SELECT user_id FROM game_states WHERE user_id=${userId} FOR UPDATE`;
  if (!state) throw new Error('Игровой профиль не найден');
  const all = 'all' in selection;
  const key = 'questKey' in selection ? selection.questKey : '';
  const rows = selection.period === 'weekly'
    ? await tx<QuestRow[]>`
      SELECT * FROM weekly_quests
      WHERE user_id=${userId} AND week_start=date_trunc('week', CURRENT_DATE)::date
        AND (${all} OR quest_key=${key})
        AND (${!all} OR (claimed_at IS NULL AND progress>=target))
      ORDER BY quest_key,id FOR UPDATE
    `
    : await tx<QuestRow[]>`
      SELECT * FROM daily_quests
      WHERE user_id=${userId} AND quest_date=CURRENT_DATE
        AND (${all} OR quest_key=${key})
        AND (${!all} OR (claimed_at IS NULL AND progress>=target))
      ORDER BY quest_key,id FOR UPDATE
    `;
  if (!all) {
    const quest = rows[0];
    if (!quest) throw new Error('Задание не найдено');
    if (quest.claimed_at) throw new Error('Награда уже получена');
    if (Number(quest.progress) < Number(quest.target)) throw new Error('Задание ещё не выполнено');
  }
  const result: QuestClaimResult = { period: selection.period, count: 0, credits: 0, crystals: 0, questKeys: [] };
  if (!rows.length) return result;
  const ids = rows.map((row) => row.id);
  const claimed = selection.period === 'weekly'
    ? await tx<QuestRow[]>`
      UPDATE weekly_quests SET claimed_at=now()
      WHERE user_id=${userId} AND id=ANY(${tx.array(ids)}::uuid[])
        AND week_start=date_trunc('week', CURRENT_DATE)::date AND claimed_at IS NULL AND progress>=target
      RETURNING quest_key,credit_reward,crystal_reward
    `
    : await tx<QuestRow[]>`
      UPDATE daily_quests SET claimed_at=now()
      WHERE user_id=${userId} AND id=ANY(${tx.array(ids)}::uuid[])
        AND quest_date=CURRENT_DATE AND claimed_at IS NULL AND progress>=target
      RETURNING quest_key,credit_reward,crystal_reward
    `;
  for (const quest of claimed) {
    result.count += 1;
    result.credits += Number(quest.credit_reward);
    result.crystals += Number(quest.crystal_reward);
    result.questKeys.push(quest.quest_key);
  }
  result.questKeys.sort();
  if (result.count) {
    await tx`
      UPDATE game_states SET credits=credits+${result.credits},crystals=crystals+${result.crystals},updated_at=now()
      WHERE user_id=${userId}
    `;
    for (const quest of claimed) await analyticsEvent(tx, userId, 'quest_claimed', {
      period: selection.period, quest_key: quest.quest_key, crystals: Number(quest.crystal_reward), credits: Number(quest.credit_reward),
    });
  }
  return result;
}
