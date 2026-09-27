import { DEFAULT_OFFLINE_CAP_HOURS, PREMIUM_OFFLINE_CAP_HOURS, type ResourceCost } from './config';

export type ResearchKey =
  | 'basic_theory'
  | 'extraction_ai'
  | 'solar_lattice'
  | 'compact_storage'
  | 'thermal_recovery'
  | 'deep_navigation'
  | 'signal_analysis'
  | 'autonomous_drones'
  | 'archive_network'
  | 'deep_space_protocol';

export type ResearchConfig = {
  key: ResearchKey;
  name: string;
  emoji: string;
  description: string;
  unlockHq: number;
  labLevel: number;
  science: number;
  cost: ResourceCost;
  timeSec: number;
  prereqs: ResearchKey[];
  effectText: string;
};

export const RESEARCH_TREE: ResearchConfig[] = [
  {
    key: 'basic_theory', name: 'Прикладная ксенология', emoji: '🧬',
    description: 'Базовые методы анализа неизвестных сигналов и материалов.',
    unlockHq: 2, labLevel: 1, science: 80, cost: { credits: 600 }, timeSec: 600, prereqs: [],
    effectText: '+10% к генерации очков науки',
  },
  {
    key: 'extraction_ai', name: 'Адаптивная добыча', emoji: '⛏️',
    description: 'Алгоритмы распределения буровых циклов по наиболее перспективным зонам.',
    unlockHq: 2, labLevel: 1, science: 160, cost: { credits: 1200, parts: 40 }, timeSec: 1200, prereqs: ['basic_theory'],
    effectText: '+7% к производству руды',
  },
  {
    key: 'solar_lattice', name: 'Солнечная решётка', emoji: '☀️',
    description: 'Синхронизация энергетических модулей и снижение потерь преобразования.',
    unlockHq: 2, labLevel: 1, science: 160, cost: { credits: 1200, parts: 40 }, timeSec: 1200, prereqs: ['basic_theory'],
    effectText: '+7% к производству энергии',
  },
  {
    key: 'compact_storage', name: 'Компактное хранение', emoji: '📦',
    description: 'Новая компоновка складских ячеек и автоматизированная укладка грузов.',
    unlockHq: 3, labLevel: 2, science: 220, cost: { credits: 1600, parts: 80 }, timeSec: 1800, prereqs: ['basic_theory'],
    effectText: '+10% ко вместимости складов',
  },
  {
    key: 'thermal_recovery', name: 'Рекуперация расплава', emoji: '🔥',
    description: 'Возврат тепла и вторичная переработка отходов литейного цикла.',
    unlockHq: 3, labLevel: 2, science: 260, cost: { credits: 2200, parts: 120 }, timeSec: 2700, prereqs: ['basic_theory'],
    effectText: '+10% к выходу деталей из плавки',
  },
  {
    key: 'deep_navigation', name: 'Глубокая навигация', emoji: '🧭',
    description: 'Расчёт безопасных маршрутов за пределы локальной орбиты колонии.',
    unlockHq: 3, labLevel: 2, science: 300, cost: { credits: 2500, parts: 120 }, timeSec: 3600, prereqs: ['basic_theory'],
    effectText: 'Открывает экспедицию «Орбитальные руины»',
  },
  {
    key: 'signal_analysis', name: 'Спектральный анализ', emoji: '📡',
    description: 'Выделение слабых закономерностей в шуме и неизвестных передачах.',
    unlockHq: 4, labLevel: 3, science: 450, cost: { credits: 4200, parts: 180 }, timeSec: 5400, prereqs: ['basic_theory'],
    effectText: '+15% науки из экспедиций',
  },
  {
    key: 'autonomous_drones', name: 'Автономные дроны', emoji: '🤖',
    description: 'Независимые исследовательские аппараты для параллельных вылетов.',
    unlockHq: 4, labLevel: 3, science: 520, cost: { credits: 5500, parts: 260 }, timeSec: 7200, prereqs: ['deep_navigation'],
    effectText: '+1 слот экспедиций',
  },
  {
    key: 'archive_network', name: 'Распределённый архив', emoji: '🗄️',
    description: 'Сеть автономных архивов продолжает сбор данных во время отсутствия оператора.',
    unlockHq: 4, labLevel: 3, science: 600, cost: { credits: 5000, parts: 240 }, timeSec: 7200, prereqs: ['compact_storage'],
    effectText: '+2 часа к лимиту офлайн-производства',
  },
  {
    key: 'deep_space_protocol', name: 'Протокол дальнего сигнала', emoji: '🌌',
    description: 'Комплекс навигации и дешифрования для работы с глубоким космосом.',
    unlockHq: 5, labLevel: 4, science: 900, cost: { credits: 9000, parts: 500 }, timeSec: 14400, prereqs: ['deep_navigation', 'signal_analysis'],
    effectText: 'Открывает экспедицию «Дальний сигнал»',
  },
];

export function researchByKey(key: string) {
  return RESEARCH_TREE.find((x) => x.key === key) ?? null;
}

export function sciencePerHour(labLevels: number[], completed: Set<string>) {
  const base = labLevels.reduce((sum, level) => sum + Math.floor(18 * Math.pow(1.38, Math.max(0, level - 1))), 0);
  return Math.floor(base * (completed.has('basic_theory') ? 1.10 : 1));
}

export function offlineCapHours(premium: boolean, completed: Set<string>) {
  return (premium ? PREMIUM_OFFLINE_CAP_HOURS : DEFAULT_OFFLINE_CAP_HOURS) + (completed.has('archive_network') ? 2 : 0);
}

export function productionMultipliers(completed: Set<string>) {
  return {
    ore: completed.has('extraction_ai') ? 1.07 : 1,
    energy: completed.has('solar_lattice') ? 1.07 : 1,
    storage: completed.has('compact_storage') ? 1.10 : 1,
    foundryParts: completed.has('thermal_recovery') ? 1.10 : 1,
    expeditionScience: completed.has('signal_analysis') ? 1.15 : 1,
  };
}
