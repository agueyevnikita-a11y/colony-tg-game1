export type DailyLoginClaimResult =
  | { status: 'received'; rewardDate: string; credits: number; crystals: number }
  | { status: 'day_changed'; rewardDate: string }
  | { status: 'unconfirmed' };

/** An unknown server deadline cannot decide whether a reward is still available. */
export function isRewardPeriodExpired(resetsAt: unknown, now: number): boolean {
  const deadline = typeof resetsAt === 'string' && resetsAt ? Date.parse(resetsAt) : NaN;
  return Number.isFinite(deadline) && Number.isFinite(now) && deadline <= now;
}

function rewardDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function amount(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** A successful request alone does not prove which day's reward was paid. */
export function dailyLoginClaimResult(value: unknown, expectedRewardDate: unknown): DailyLoginClaimResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'unconfirmed' };
  const response = value as Record<string, unknown>;
  if (!Object.hasOwn(response, 'ok') || response.ok !== true || !Object.hasOwn(response, 'reward')
    || !response.reward || typeof response.reward !== 'object' || Array.isArray(response.reward)) return { status: 'unconfirmed' };
  const reward = response.reward as Record<string, unknown>;
  if (!['reward_date', 'claimed_at', 'credit_reward', 'crystal_reward'].every(key => Object.hasOwn(reward, key))
    || !rewardDate(reward.reward_date) || typeof reward.claimed_at !== 'string' || !Number.isFinite(Date.parse(reward.claimed_at))) return { status: 'unconfirmed' };
  const credits = amount(reward.credit_reward), crystals = amount(reward.crystal_reward);
  if (credits === null || crystals === null || credits + crystals === 0) return { status: 'unconfirmed' };
  if (rewardDate(expectedRewardDate) && reward.reward_date !== expectedRewardDate) return { status: 'day_changed', rewardDate: reward.reward_date };
  return { status: 'received', rewardDate: reward.reward_date, credits, crystals };
}
