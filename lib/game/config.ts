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
  | 'deep_mine'
  | 'solar_array'
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
  unlockResearch?: string;
  description?: string;
  baseBuildCost: ResourceCost;
  baseBuildTimeSec: number;
  maxLevel: number;
  passive?: { resource: 'ore' | 'energy' | 'credits'; perHour: number };
};

export const BUILDINGS: Record<BuildingType, BuildingConfig> = {
  hq: {
    name: 'Центр управления', emoji: '🏛️', unlockHq: 1,
    description: 'Определяет уровень базы. Улучшай его, чтобы открывать новые здания, исследования и расширять территорию.',
    baseBuildCost: { ore: 400, parts: 50, credits: 250 }, baseBuildTimeSec: 120, maxLevel: 10,
  },
  mine: {
    name: 'Шахта', emoji: '⛏️', unlockHq: 1,
    description: 'Добывает руду для строительства и плавки. Соседний литейный цех может выбрать связь для экономии руды.',
    baseBuildCost: { ore: 120, credits: 100 }, baseBuildTimeSec: 15, maxLevel: 20,
    passive: { resource: 'ore', perHour: 120 },
  },
  solar: {
    name: 'Электростанция', emoji: '⚡', unlockHq: 1,
    description: 'Производит энергию для плавки и экспедиций. Соседний литейный цех может выбрать связь для экономии энергии.',
    baseBuildCost: { ore: 100, credits: 80 }, baseBuildTimeSec: 15, maxLevel: 20,
    passive: { resource: 'energy', perHour: 100 },
  },
  deep_mine: {
    name: 'Глубинная шахта', emoji: '🛢️', unlockHq: 3, unlockResearch: 'deep_drilling',
    description: '300 руды/ч на первом уровне — в 2,5 раза больше обычной шахты с одной клетки. Даёт связь литейному цеху.',
    baseBuildCost: { ore: 900, parts: 180, credits: 1600 }, baseBuildTimeSec: 600, maxLevel: 12,
    passive: { resource: 'ore', perHour: 300 },
  },
  solar_array: {
    name: 'Солнечный массив', emoji: '🌞', unlockHq: 3, unlockResearch: 'photovoltaic_arrays',
    description: '250 энергии/ч на первом уровне — в 2,5 раза больше обычной электростанции с одной клетки. Даёт связь литейному цеху.',
    baseBuildCost: { ore: 800, parts: 160, credits: 1400 }, baseBuildTimeSec: 600, maxLevel: 12,
    passive: { resource: 'energy', perHour: 250 },
  },
  warehouse: {
    name: 'Склад', emoji: '📦', unlockHq: 1,
    description: 'Увеличивает запас руды, энергии и деталей. Строй и улучшай склады, когда ресурсы перестают помещаться.',
    baseBuildCost: { ore: 150, credits: 100 }, baseBuildTimeSec: 20, maxLevel: 15,
  },
  foundry: {
    name: 'Литейный цех', emoji: '🏭', unlockHq: 1,
    description: 'Превращает руду и энергию в детали. У каждого цеха своя очередь; рецепт, режим и связь с соседом выбираются в производстве.',
    baseBuildCost: { ore: 180, credits: 120 }, baseBuildTimeSec: 30, maxLevel: 15,
  },
  habitat: {
    name: 'Жилой модуль', emoji: '🏢', unlockHq: 1,
    description: 'Приносит кредиты для строительства и исследований. Доход поступает автоматически, пока тебя нет в игре.',
    baseBuildCost: { ore: 160, credits: 100 }, baseBuildTimeSec: 45, maxLevel: 15,
    passive: { resource: 'credits', perHour: 60 },
  },
  trade_hub: {
    name: 'Торговый узел', emoji: '📈', unlockHq: 1,
    description: 'Открывает контракты и рынок игроков. Обменивай излишки ресурсов на кредиты для развития.',
    baseBuildCost: { ore: 220, parts: 20, credits: 180 }, baseBuildTimeSec: 45, maxLevel: 15,
  },
  research_lab: {
    name: 'Исследовательский центр', emoji: '🧪', unlockHq: 2,
    description: 'Производит науку и открывает исследования. Технологии усиливают добычу и дают доступ к новым зданиям и рецептам.',
    baseBuildCost: { ore: 400, parts: 80, credits: 600 }, baseBuildTimeSec: 300, maxLevel: 15,
  },
  logistics: {
    name: 'Логистический центр', emoji: '🚚', unlockHq: 3,
    description: 'Развивает облик и рейтинг города. Отдельного бонуса к производству пока нет.',
    baseBuildCost: { ore: 600, parts: 120, credits: 800 }, baseBuildTimeSec: 600, maxLevel: 12,
  },
  expedition_center: {
    name: 'Центр экспедиций', emoji: '🚀', unlockHq: 3, unlockResearch: 'expedition_protocols',
    description: 'Открывает экспедиции за ресурсами, наукой и артефактами. Отправляй аппараты в разделе развития.',
    baseBuildCost: { ore: 800, parts: 180, credits: 1200 }, baseBuildTimeSec: 900, maxLevel: 12,
  },
  alliance_hub: {
    name: 'Штаб альянса', emoji: '🏳️', unlockHq: 4,
    description: 'Представительское здание для города и его рейтинга. Вступление в альянс доступно отдельно в разделе «Связи».',
    baseBuildCost: { ore: 1200, parts: 250, credits: 1800 }, baseBuildTimeSec: 1200, maxLevel: 10,
  },
  observatory: {
    name: 'Обсерватория', emoji: '🔭', unlockHq: 5,
    description: 'Архитектурный объект для развитой колонии: повышает рейтинг города. Науку производит исследовательский центр.',
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
