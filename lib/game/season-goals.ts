import { SEASON_EVENT_POINTS } from './season';
import { progressGoalForEvent, type ProgressGoal } from './progress-goals';
import type { QuestCatalogEntry, QuestPeriod, QuestSnapshot } from './quest-guidance';

export type SeasonPointSource = { event: string; label: string; points: number; goal: ProgressGoal };

const SOURCE_LABELS: readonly [string, string][] = [
  ['daily_session', 'Первый вход в игровой день'],
  ['build_started', 'Начало оплаченной стройки или улучшения'],
  ['foundry_started', 'Оплата каждого цикла партии'],
  ['contract_completed', 'Выполнение обычного контракта'],
  ['qualified_referral', 'Приглашённый друг достиг центра ур. 3'],
  ['research_completed', 'Завершение технологии'],
  ['expedition_started', 'Успешная отправка аппарата'],
  ['expedition_completed', 'Получение результата экспедиции'],
  ['artifact_found', 'Каждый полученный артефакт, включая повторы'],
];

/** The points and counting rules come from the same tables as colony progression. */
export const SEASON_POINT_SOURCES: readonly SeasonPointSource[] = SOURCE_LABELS.flatMap(([event, label]) => {
  const goal = progressGoalForEvent(event), points = SEASON_EVENT_POINTS[event];
  return goal && Number.isSafeInteger(points) && points > 0 ? [{ event, label, points, goal }] : [];
});

type QuestPeriodGoals = { quests: readonly QuestSnapshot[]; catalog: readonly QuestCatalogEntry[]; resetsAt?: string };
export type SeasonQuestGoal = { period: QuestPeriod; quest: QuestSnapshot; config: QuestCatalogEntry; source: SeasonPointSource; remaining: number };

function count(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** One unfinished quest whose normal activity also earns SP; this never promises a season payout. */
export function nextSeasonQuestGoal(input: { daily?: QuestPeriodGoals; weekly?: QuestPeriodGoals; now: number }): SeasonQuestGoal | null {
  if (!input || !Number.isFinite(input.now)) return null;
  let nearest: SeasonQuestGoal | null = null, nearestRatio = -1;
  for (const period of ['daily', 'weekly'] as const) {
    const data = input[period];
    if (!data || !Array.isArray(data.quests) || !Array.isArray(data.catalog) || typeof data.resetsAt !== 'string') continue;
    const resetAt = Date.parse(data.resetsAt);
    if (!Number.isFinite(resetAt) || resetAt <= input.now) continue;
    for (const quest of data.quests) {
      if (!quest || typeof quest !== 'object' || Array.isArray(quest)
        || typeof quest.id !== 'string' || !quest.id.trim() || typeof quest.quest_key !== 'string' || !quest.quest_key.trim() || quest.claimed_at) continue;
      if (data.quests.filter((row) => row?.quest_key === quest.quest_key).length !== 1
        || data.quests.filter((row) => row?.id === quest.id).length !== 1) continue;
      const matches = data.catalog.filter((row) => row?.key === quest.quest_key);
      if (matches.length !== 1) continue;
      const config = matches[0];
      if (typeof config.title !== 'string' || !config.title.trim() || typeof config.description !== 'string' || config.event === 'daily_session') continue;
      const source = SEASON_POINT_SOURCES.find((row) => row.event === config.event);
      if (!source) continue;
      const progress = count(quest.progress), target = count(quest.target);
      if (progress === null || target === null || target <= 0 || progress >= target
        || count(quest.credit_reward) === null || count(quest.crystal_reward) === null) continue;
      const ratio = progress / target;
      if (ratio <= nearestRatio) continue;
      nearest = { period, quest, config, source, remaining: target - progress };
      nearestRatio = ratio;
    }
  }
  return nearest;
}
