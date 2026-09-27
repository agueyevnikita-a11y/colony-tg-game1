export type ResourceCost = {
  ore?: number;
  energy?: number;
  parts?: number;
  credits?: number;
};

export type BuildingType =
  | 'hq'
  | 'mine'
  | 'solar'
  | 'warehouse'
  | 'foundry'
  | 'habitat'
  | 'trade_hub'
  | 'research_lab'
  | 'logistics'
  | 'expedition_center'
  | 'alliance_hub'
  | 'observatory';

export type BuildingConfig = {
  name: string;
  emoji: string;
  unlockHq: number;
  baseBuildCost: ResourceCost;
  baseBuildTimeSec: number;
  maxLevel: number;
  passive?: { resource: 'ore' | 'energy' | 'credits'; perHour: number };
};

export const BUILDINGS: Record<BuildingType, BuildingConfig> = {
  hq: {
    name: 'Центр управления', emoji: '🏛️', unlockHq: 1,
    baseBuildCost: { ore: 400, parts: 50, credits: 250 }, baseBuildTimeSec: 120, maxLevel: 10,
  },
  mine: {
    name: 'Шахта', emoji: '⛏️', unlockHq: 1,
    baseBuildCost: { ore: 120, credits: 100 }, baseBuildTimeSec: 15, maxLevel: 20,
    passive: { resource: 'ore', perHour: 120 },
  },
  solar: {
    name: 'Электростанция', emoji: '⚡', unlockHq: 1,
    baseBuildCost: { ore: 100, credits: 80 }, baseBuildTimeSec: 15, maxLevel: 20,
    passive: { resource: 'energy', perHour: 100 },
  },
  warehouse: {
    name: 'Склад', emoji: '📦', unlockHq: 1,
    baseBuildCost: { ore: 150, credits: 100 }, baseBuildTimeSec: 20, maxLevel: 15,
  },
  foundry: {
    name: 'Литейный цех', emoji: '🏭', unlockHq: 1,
    baseBuildCost: { ore: 180, credits: 120 }, baseBuildTimeSec: 30, maxLevel: 15,
  },
  habitat: {
    name: 'Жилой модуль', emoji: '🏢', unlockHq: 1,
    baseBuildCost: { ore: 160, credits: 100 }, baseBuildTimeSec: 45, maxLevel: 15,
    passive: { resource: 'credits', perHour: 60 },
  },
  trade_hub: {
    name: 'Торговый узел', emoji: '📈', unlockHq: 1,
    baseBuildCost: { ore: 220, parts: 20, credits: 180 }, baseBuildTimeSec: 45, maxLevel: 15,
  },
  research_lab: {
    name: 'Исследовательский центр', emoji: '🧪', unlockHq: 2,
    baseBuildCost: { ore: 400, parts: 80, credits: 600 }, baseBuildTimeSec: 300, maxLevel: 15,
  },
  logistics: {
    name: 'Логистический центр', emoji: '🚚', unlockHq: 3,
    baseBuildCost: { ore: 600, parts: 120, credits: 800 }, baseBuildTimeSec: 600, maxLevel: 12,
  },
  expedition_center: {
    name: 'Центр экспедиций', emoji: '🚀', unlockHq: 3,
    baseBuildCost: { ore: 800, parts: 180, credits: 1200 }, baseBuildTimeSec: 900, maxLevel: 12,
  },
  alliance_hub: {
    name: 'Штаб альянса', emoji: '🏳️', unlockHq: 4,
    baseBuildCost: { ore: 1200, parts: 250, credits: 1800 }, baseBuildTimeSec: 1200, maxLevel: 10,
  },
  observatory: {
    name: 'Обсерватория', emoji: '🔭', unlockHq: 5,
    baseBuildCost: { ore: 1800, parts: 450, credits: 3000 }, baseBuildTimeSec: 1800, maxLevel: 10,
  },
};

export const HQ_UPGRADES: Record<number, { cost: ResourceCost; timeSec: number }> = {
  2: { cost: { ore: 400, parts: 50, credits: 250 }, timeSec: 120 },
  3: { cost: { ore: 1000, parts: 180, credits: 800 }, timeSec: 600 },
  4: { cost: { ore: 2500, parts: 500, credits: 2500 }, timeSec: 1800 },
  5: { cost: { ore: 6000, parts: 1200, credits: 7000 }, timeSec: 7200 },
  6: { cost: { ore: 16000, parts: 3000, credits: 18000 }, timeSec: 21600 },
};

export const PRODUCTS = {
  premium_30d: { title: 'COLONY Premium — 30 дней', stars: 199, kind: 'premium', days: 30 },
  theme_neon: { title: 'Тема города: Неон', stars: 149, kind: 'cosmetic', cosmeticId: 'theme_neon' },
  weather_aurora: { title: 'Эффект: Северное сияние', stars: 99, kind: 'cosmetic', cosmeticId: 'weather_aurora' },
  frame_orbit: { title: 'Рамка: Орбита', stars: 79, kind: 'cosmetic', cosmeticId: 'frame_orbit' },
  founder_pack: { title: 'Founder Pack', stars: 499, kind: 'bundle' },
} as const;

export const CRYSTAL_PREMIUM_PRICE = 1200;
export const DEFAULT_OFFLINE_CAP_HOURS = 8;
export const PREMIUM_OFFLINE_CAP_HOURS = 10;
export const PREMIUM_PRODUCTION_MULTIPLIER = 1.05;
export const PREMIUM_BUILD_SPEED_MULTIPLIER = 0.95;


export function cityGridSize(hqLevel: number) {
  if (hqLevel >= 5) return 8;
  if (hqLevel >= 3) return 7;
  return 6;
}
