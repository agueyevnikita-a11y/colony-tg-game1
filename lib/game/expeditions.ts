import type { ResourceCost } from './config';

export type ExpeditionKey = 'local_survey' | 'orbital_ruins' | 'deep_signal';

export type ExpeditionConfig = {
  key: ExpeditionKey;
  name: string;
  emoji: string;
  description: string;
  unlockHq: number;
  requiredResearch?: string;
  durationSec: number;
  cost: ResourceCost;
  eventChance: number;
  artifactChance: number;
  reward: {
    ore?: [number, number];
    credits?: [number, number];
    science?: [number, number];
    crystalsChance?: number;
    crystals?: [number, number];
  };
};

export const EXPEDITIONS: ExpeditionConfig[] = [
  {
    key: 'local_survey', name: 'Локальная разведка', emoji: '🛰️',
    description: 'Короткий вылет по ближайшим секторам. Низкий риск, быстрый возврат.',
    unlockHq: 3, durationSec: 900, cost: { energy: 150 }, eventChance: 0.25, artifactChance: 0.05,
    reward: { ore: [120, 260], credits: [250, 600], science: [15, 30], crystalsChance: 0.05, crystals: [1, 2] },
  },
  {
    key: 'orbital_ruins', name: 'Орбитальные руины', emoji: '🛸',
    description: 'Исследование разрушенных станций и старых орбитальных объектов.',
    unlockHq: 3, requiredResearch: 'deep_navigation', durationSec: 3600, cost: { energy: 400, parts: 15 }, eventChance: 0.45, artifactChance: 0.16,
    reward: { ore: [260, 520], credits: [800, 1700], science: [45, 80], crystalsChance: 0.18, crystals: [1, 3] },
  },
  {
    key: 'deep_signal', name: 'Дальний сигнал', emoji: '🌌',
    description: 'Долгая экспедиция к источнику аномального сигнала за пределами обычных маршрутов.',
    unlockHq: 5, requiredResearch: 'deep_space_protocol', durationSec: 14400, cost: { energy: 900, parts: 60 }, eventChance: 0.62, artifactChance: 0.34,
    reward: { ore: [450, 900], credits: [1900, 3800], science: [100, 175], crystalsChance: 0.32, crystals: [2, 6] },
  },
];

export const ARTIFACTS = [
  { id: 'signal_fragment', name: 'Фрагмент сигнала', emoji: '📶', rarity: 'common', description: 'Кристаллическая структура с повторяющейся информационной последовательностью.' },
  { id: 'alloy_core', name: 'Неизвестный сплав', emoji: '🔩', rarity: 'uncommon', description: 'Композит, не совпадающий с материалами колонии.' },
  { id: 'stellar_map', name: 'Звёздная карта', emoji: '🗺️', rarity: 'rare', description: 'Фрагмент навигационной схемы с неизвестной системой координат.' },
  { id: 'quantum_lens', name: 'Квантовая линза', emoji: '🔮', rarity: 'epic', description: 'Оптический узел, свойства которого пока невозможно полностью объяснить.' },
] as const;

export const EXPEDITION_EVENTS = {
  distress_beacon: {
    title: 'Сигнал бедствия', emoji: '🆘', description: 'Автоматика обнаружила старый аварийный маяк. Рядом есть повреждённый модуль.',
    choices: [
      { id: 'assist', title: 'Стабилизировать модуль', description: 'Потратить ⚡80 и забрать максимум данных.', cost: { energy: 80 }, reward: { science: 35, credits: 150 } },
      { id: 'salvage', title: 'Снять полезное оборудование', description: 'Не рисковать энергией и забрать ликвидные компоненты.', cost: {}, reward: { credits: 450 } },
    ],
  },
  magnetic_storm: {
    title: 'Магнитная буря', emoji: '🌩️', description: 'Маршрут пересекает область сильных электромагнитных возмущений.',
    choices: [
      { id: 'study', title: 'Остаться для измерений', description: 'Потратить ⚙️20 деталей на защиту датчиков.', cost: { parts: 20 }, reward: { science: 55 } },
      { id: 'detour', title: 'Обойти фронт', description: 'Безопасный маршрут приносит меньше данных, но позволяет сохранить оборудование.', cost: {}, reward: { credits: 280 } },
    ],
  },
  ancient_probe: {
    title: 'Неизвестный зонд', emoji: '👁️', description: 'Экспедиция обнаружила отключённый автоматический аппарат неизвестного происхождения.',
    choices: [
      { id: 'decode', title: 'Считать память', description: 'Попытаться восстановить данные без демонтажа.', cost: {}, reward: { science: 75 } },
      { id: 'recover', title: 'Извлечь ядро', description: 'Потратить ⚙️30 деталей на безопасный демонтаж.', cost: { parts: 30 }, reward: { credits: 500, artifactId: 'signal_fragment' } },
    ],
  },
} as const;

export function expeditionByKey(key: string) {
  return EXPEDITIONS.find((x) => x.key === key) ?? null;
}

export function expeditionSlots(centerLevel: number, completedResearch: Set<string>) {
  const buildingBonus = centerLevel >= 6 ? 1 : 0;
  const researchBonus = completedResearch.has('autonomous_drones') ? 1 : 0;
  return Math.min(3, 1 + buildingBonus + researchBonus);
}
