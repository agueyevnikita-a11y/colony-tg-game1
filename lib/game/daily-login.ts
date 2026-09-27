export const DAILY_LOGIN_REWARDS = [
  { day: 1, credits: 200, crystals: 0 },
  { day: 2, credits: 300, crystals: 0 },
  { day: 3, credits: 400, crystals: 2 },
  { day: 4, credits: 500, crystals: 0 },
  { day: 5, credits: 600, crystals: 3 },
  { day: 6, credits: 800, crystals: 0 },
  { day: 7, credits: 1000, crystals: 5 },
] as const;

export function rewardForStreak(streak: number) {
  const cycleDay = ((Math.max(1, streak) - 1) % 7) + 1;
  return DAILY_LOGIN_REWARDS[cycleDay - 1];
}
