import { isRewardPeriodExpired } from './daily-login-claim';

export type MissionReadyCounts = Record<'daily' | 'weekly' | 'achievements' | 'season', number>;

type Quest = { progress?: unknown; target?: unknown; claimed_at?: unknown };
export type MissionReadinessSnapshot = {
  dailyLogin?: { today?: { claimed_at?: unknown } | null } | null;
  dailyQuests?: readonly Quest[] | null;
  weeklyQuests?: readonly Quest[] | null;
  questPeriods?: {
    daily?: { resetsAt?: unknown } | null;
    weekly?: { resetsAt?: unknown } | null;
  } | null;
  achievementCatalog?: readonly { key: string }[] | null;
  achievements?: readonly { achievement_key: string; claimed_at?: unknown }[] | null;
  season?: {
    starts_at?: unknown;
    ends_at?: unknown;
    points?: unknown;
    claims?: readonly { level?: unknown }[] | null;
    rewards?: readonly { level?: unknown; points?: unknown }[] | null;
  } | null;
};

function nonnegative(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function date(value: unknown): number {
  if (typeof value === 'string' && value.trim()) return Date.parse(value);
  return value instanceof Date ? value.getTime() : NaN;
}

function readyQuests(quests: readonly Quest[] | null | undefined) {
  return (quests ?? []).filter(quest => {
    const progress = nonnegative(quest.progress), target = nonnegative(quest.target);
    return !quest.claimed_at && progress !== null && target !== null && target > 0 && progress >= target;
  }).length;
}

/** A badge describes this snapshot, never a new reward after its known period ends. */
export function missionReadiness(game: MissionReadinessSnapshot | null | undefined, now: number): {
  counts: MissionReadyCounts;
  nextChangeAt: number | null;
} {
  const counts: MissionReadyCounts = { daily: 0, weekly: 0, achievements: 0, season: 0 };
  if (!game) return { counts, nextChangeAt: null };

  const dailyReset = game.questPeriods?.daily?.resetsAt;
  const weeklyReset = game.questPeriods?.weekly?.resetsAt;
  if (!isRewardPeriodExpired(dailyReset, now)) {
    counts.daily = readyQuests(game.dailyQuests) + (game.dailyLogin?.today && !game.dailyLogin.today.claimed_at ? 1 : 0);
  }
  if (!isRewardPeriodExpired(weeklyReset, now)) counts.weekly = readyQuests(game.weeklyQuests);

  const achievementStatus = new Map((game.achievements ?? []).map(row => [row.achievement_key, row]));
  counts.achievements = (game.achievementCatalog ?? []).filter(achievement => {
    const status = achievementStatus.get(achievement.key);
    return status && !status.claimed_at;
  }).length;

  const start = date(game.season?.starts_at), end = date(game.season?.ends_at);
  const validSeason = Number.isFinite(start) && Number.isFinite(end) && end > start;
  if (validSeason && Number.isFinite(now) && now >= start && now < end) {
    const points = nonnegative(game.season?.points);
    const claimed = new Set((game.season?.claims ?? []).map(claim => nonnegative(claim.level)));
    counts.season = (game.season?.rewards ?? []).filter(reward => {
      const level = nonnegative(reward.level), required = nonnegative(reward.points);
      return level !== null && Number.isSafeInteger(level) && level > 0 && !claimed.has(level)
        && points !== null && required !== null && points >= required;
    }).length;
  }

  // Unknown deadlines retain server authority. Only known boundaries can schedule a change.
  const boundaries = [
    typeof dailyReset === 'string' ? Date.parse(dailyReset) : NaN,
    typeof weeklyReset === 'string' ? Date.parse(weeklyReset) : NaN,
    ...(validSeason ? [start, end] : []),
  ].filter(boundary => Number.isFinite(now) && Number.isFinite(boundary) && boundary > now);
  return { counts, nextChangeAt: boundaries.length ? Math.min(...boundaries) : null };
}
