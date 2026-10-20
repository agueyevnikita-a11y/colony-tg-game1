export const REFERRAL_QUALIFICATION_HQ = 3;
export const REFERRAL_BONUS = { credits: 500, crystals: 10 } as const;

/** Telegram signs the start parameter; still accept only our canonical ID form. */
export function referralTelegramId(startParam: string | undefined, ownTelegramId: number): number | null {
  const match = /^ref_([1-9]\d*)$/.exec(startParam ?? '');
  if (!match || match[0] !== startParam) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 && id !== ownTelegramId ? id : null;
}

export function referralBonusForCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Некорректное число приглашений');
  const credits = count * REFERRAL_BONUS.credits;
  const crystals = count * REFERRAL_BONUS.crystals;
  if (!Number.isSafeInteger(credits) || !Number.isSafeInteger(crystals)) throw new Error('Слишком большое число приглашений');
  return { credits, crystals };
}

export type ReferralRoadmapStatus = 'locked' | 'available' | 'received' | 'pending';

export function referralRoadmapStatus(input: {
  count: number; target: number; received: boolean; requiresClaim: boolean; unlocked?: boolean;
}): ReferralRoadmapStatus {
  if (input.received) return 'received';
  if (input.requiresClaim && input.unlocked) return 'available';
  if (input.count < input.target) return 'locked';
  return 'pending';
}

export type ReferralFriend = {
  telegramId: number;
  name: string;
  hqLevel: number;
  qualifiedAt: string | null;
  bonusClaimed: boolean;
};

export type ReferralRoadmapEntry = {
  target: number;
  name: string;
  rewardText: string;
  status: ReferralRoadmapStatus;
  achievementKey?: string;
};

export type ReferralProgram = {
  enabled: boolean;
  qualificationHq: number;
  reward: { credits: number; crystals: number };
  totalInvited: number;
  qualifiedInvited: number;
  pendingCount: number;
  pendingReward: { credits: number; crystals: number };
  receivedCount: number;
  receivedReward: { credits: number; crystals: number };
  invitedBy: { name: string; hqLevel: number; qualified: boolean; bonusClaimed: boolean } | null;
  friends: ReferralFriend[];
  roadmap: ReferralRoadmapEntry[];
};
