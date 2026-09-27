export type AllianceResource = 'ore' | 'energy' | 'parts';

export const ALLIANCE_CREATE_HQ = 3;
export const ALLIANCE_JOIN_HQ = 2;
export const ALLIANCE_CREATE_COST = 5000;
export const ALLIANCE_MEMBER_LIMIT = 30;
export const ALLIANCE_REJOIN_COOLDOWN_HOURS = 24;
export const ALLIANCE_OFFICER_LIMIT = 5;
export const ALLIANCE_PROJECT_RESTART_COOLDOWN_HOURS = 6;

export type AllianceDailyEvent = 'build_started' | 'foundry_started' | 'contract_completed';
export const ALLIANCE_DAILY_GOALS = [
  { key: 'team_build', title: 'Общий каркас', description: 'Начните 8 строительств или улучшений всем альянсом', event: 'build_started' as const, target: 8, rewardCrystals: 4, rewardCredits: 300 },
  { key: 'team_foundry', title: 'Промышленная смена', description: 'Запустите 12 плавок всем альянсом', event: 'foundry_started' as const, target: 12, rewardCrystals: 4, rewardCredits: 300 },
  { key: 'team_contracts', title: 'Торговый коридор', description: 'Выполните 6 NPC-контрактов всем альянсом', event: 'contract_completed' as const, target: 6, rewardCrystals: 5, rewardCredits: 500 },
] as const;

export type AllianceProjectStage = {
  stage: number;
  title: string;
  description: string;
  target: Record<AllianceResource, number>;
  minimumContributionPoints: number;
  rewardCosmeticId: string;
  rewardDays?: number;
};

export const ORBITAL_RELAY_PROJECT = {
  key: 'orbital_relay',
  title: 'Орбитальный ретранслятор',
  description: 'Первый коллективный мегапроект альянса. Три этапа строительства без Stars и прямых боевых бонусов.',
  stages: [
    {
      stage: 1,
      title: 'Фундамент',
      description: 'Подготовить материалы и энергоконтур наземного комплекса.',
      target: { ore: 30000, energy: 12000, parts: 1500 },
      minimumContributionPoints: 120,
      rewardCosmeticId: 'effect_alliance_signal',
      rewardDays: 7,
    },
    {
      stage: 2,
      title: 'Антенное поле',
      description: 'Собрать основные конструктивные и радиоэлектронные элементы.',
      target: { ore: 65000, energy: 28000, parts: 4500 },
      minimumContributionPoints: 350,
      rewardCosmeticId: 'frame_alliance_relay',
      rewardDays: 14,
    },
    {
      stage: 3,
      title: 'Первый сигнал',
      description: 'Завершить орбитальный сегмент и ввести ретранслятор в строй.',
      target: { ore: 120000, energy: 50000, parts: 9000 },
      minimumContributionPoints: 900,
      rewardCosmeticId: 'monument_alliance_relay',
    },
  ] satisfies AllianceProjectStage[],
} as const;


export function projectCycleMultiplier(cycle: number) {
  return 1 + Math.max(0, cycle - 1) * 0.35;
}

export function projectStageForCycle(stage: number, cycle: number): AllianceProjectStage | null {
  const base = ORBITAL_RELAY_PROJECT.stages.find((x) => x.stage === stage);
  if (!base) return null;
  const multiplier = projectCycleMultiplier(cycle);
  const contributionMultiplier = 1 + Math.max(0, cycle - 1) * 0.2;
  return {
    ...base,
    target: {
      ore: Math.ceil(base.target.ore * multiplier),
      energy: Math.ceil(base.target.energy * multiplier),
      parts: Math.ceil(base.target.parts * multiplier),
    },
    minimumContributionPoints: Math.ceil(base.minimumContributionPoints * contributionMultiplier),
  };
}

export function projectPrestigeReward(cycle: number) {
  return 500 + Math.max(1, cycle) * 250;
}

export const ALLIANCE_RESOURCE_POINTS: Record<AllianceResource, number> = {
  ore: 0.1,
  energy: 0.2,
  parts: 1,
};

export function contributionPoints(resource: AllianceResource, amount: number) {
  return Math.max(1, Math.floor(amount * ALLIANCE_RESOURCE_POINTS[resource]));
}

export function allianceCode(name: string, salt: string) {
  const base = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 3)
    .toUpperCase() || 'COL';
  const suffix = salt.replace(/-/g, '').slice(-5).toUpperCase();
  return `${base}${suffix}`.slice(0, 8);
}
