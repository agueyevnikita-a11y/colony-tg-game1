export type QuestPeriod = 'daily' | 'weekly';
export type QuestClaimResult = { period: QuestPeriod; count: number; credits: number; crystals: number; questKeys: string[] };
export type QuestSnapshot = {
  id: string; quest_key: string; progress: number | string; target: number | string;
  crystal_reward: number | string; credit_reward: number | string; claimed_at?: unknown;
};
export type QuestCatalogEntry = { key: string; title: string; description: string; event?: string };

function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER ? parsed : null;
}

export function questNumber(value: unknown): number { return numeric(value) ?? 0; }

export function questProgressRatio(quest: Pick<QuestSnapshot, 'progress' | 'target'>): number | null {
  const progress = numeric(quest.progress), target = numeric(quest.target);
  return progress !== null && target !== null && target > 0 ? Math.min(1, progress / target) : null;
}

/** Compare unfinished goals only; the caller keeps ready and claimed groups separate. */
export function compareQuestProgress(left: Pick<QuestSnapshot, 'progress' | 'target'>, right: Pick<QuestSnapshot, 'progress' | 'target'>) {
  return (questProgressRatio(right) ?? -1) - (questProgressRatio(left) ?? -1);
}

export function relatedQuestForEvent(input: {
  event: string; period: QuestPeriod; quests: readonly QuestSnapshot[]; catalog: readonly QuestCatalogEntry[];
  resetsAt?: string; now: number;
}): { quest: QuestSnapshot; config: QuestCatalogEntry; remaining: number } | null {
  const resetAt = Date.parse(input.resetsAt ?? '');
  if (!Number.isFinite(input.now) || !Number.isFinite(resetAt) || resetAt <= input.now
    || !input.event || !['daily', 'weekly'].includes(input.period)) return null;
  const candidates = input.quests.flatMap((quest, index) => {
    const matches = input.catalog.filter((item) => item.key === quest.quest_key);
    const config = matches.length === 1 ? matches[0] : null;
    const progress = numeric(quest.progress), target = numeric(quest.target);
    if (!config || config.event !== input.event || quest.claimed_at || progress === null || target === null || target <= 0 || progress >= target) return [];
    return [{ quest, config, remaining: target - progress, index }];
  });
  candidates.sort((left, right) => compareQuestProgress(left.quest, right.quest) || left.index - right.index);
  const result = candidates[0];
  return result ? { quest: result.quest, config: result.config, remaining: result.remaining } : null;
}

/** A receipt can acknowledge any subset of the ready snapshot, including no new payout. */
export function validQuestClaimReceipt(value: unknown, period: QuestPeriod, selected: readonly QuestSnapshot[]): value is QuestClaimResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(selected) || !selected.length) return false;
  const result = value as Record<string, unknown>;
  if (result.period !== period || !['daily', 'weekly'].includes(period)
    || typeof result.count !== 'number' || !Number.isSafeInteger(result.count) || result.count < 0
    || typeof result.credits !== 'number' || !Number.isSafeInteger(result.credits) || result.credits < 0
    || typeof result.crystals !== 'number' || !Number.isSafeInteger(result.crystals) || result.crystals < 0
    || !Array.isArray(result.questKeys) || result.questKeys.length !== result.count
    || result.questKeys.some((key) => typeof key !== 'string') || new Set(result.questKeys).size !== result.count) return false;
  const snapshots = new Map<string, QuestSnapshot>();
  const ids = new Set<string>();
  for (const quest of selected) {
    const progress = numeric(quest.progress), target = numeric(quest.target);
    const credits = numeric(quest.credit_reward), crystals = numeric(quest.crystal_reward);
    if (typeof quest.id !== 'string' || !quest.id.trim() || typeof quest.quest_key !== 'string' || !quest.quest_key.trim() || snapshots.has(quest.quest_key) || ids.has(quest.id) || quest.claimed_at
      || progress === null || target === null || target <= 0 || progress < target
      || credits === null || crystals === null || !Number.isSafeInteger(credits) || !Number.isSafeInteger(crystals)) return false;
    snapshots.set(quest.quest_key, quest);
    ids.add(quest.id);
  }
  let credits = 0, crystals = 0;
  for (const key of result.questKeys as string[]) {
    const quest = snapshots.get(key);
    if (!quest) return false;
    credits += Number(quest.credit_reward);
    crystals += Number(quest.crystal_reward);
    if (!Number.isSafeInteger(credits) || !Number.isSafeInteger(crystals)) return false;
  }
  return result.credits === credits && result.crystals === crystals;
}
