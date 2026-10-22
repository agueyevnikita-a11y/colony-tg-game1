import { DEFAULT_OFFLINE_CAP_HOURS, PREMIUM_OFFLINE_CAP_HOURS, type BuildingType, type ResourceCost } from './config';
import type { FoundryRecipeKey } from './foundry';

export type ResearchKey =
  | 'basic_theory'
  | 'extraction_ai'
  | 'solar_lattice'
  | 'deep_drilling'
  | 'photovoltaic_arrays'
  | 'compact_storage'
  | 'thermal_recovery'
  | 'precision_casting'
  | 'industrial_casting'
  | 'deep_navigation'
  | 'signal_analysis'
  | 'autonomous_drones'
  | 'archive_network'
  | 'deep_space_protocol'
  | 'urban_ecology'
  | 'public_spaces'
  | 'trade_network'
  | 'expedition_protocols';

export type ResearchConfig = {
  key: ResearchKey;
  branch: 'foundation' | 'resources' | 'production' | 'exploration' | 'infrastructure';
  unlockFeature?: 'market' | 'expeditions' | 'decor';
  unlockBuilding?: BuildingType;
  unlockRecipe?: FoundryRecipeKey;
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
    key: 'trade_network', branch: 'infrastructure', name: 'Межколониальная торговля', emoji: '',
    description: 'Сеть торговых терминалов связывает колонию с рынком других игроков. Контракты торгового узла доступны и без этой технологии.',
    unlockHq: 2, labLevel: 1, science: 50, cost: { credits: 400 }, timeSec: 300, prereqs: ['basic_theory'],
    effectText: 'Открывает рынок игроков. Для сделок нужен работающий торговый узел.', unlockFeature: 'market',
  },
  {
    key: 'urban_ecology', branch: 'infrastructure', name: 'Замкнутые биосистемы', emoji: '',
    description: 'Герметичные корпуса, искусственный свет и питательные контуры позволяют выращивать растения вдали от Земли.',
    unlockHq: 2, labLevel: 1, science: 60, cost: { credits: 400 }, timeSec: 600, prereqs: ['basic_theory'],
    effectText: 'Открывает гидропонный модуль для комфорта и оформления колонии.', unlockFeature: 'decor',
  },
  {
    key: 'public_spaces', branch: 'infrastructure', name: 'Среда обитания', emoji: '',
    description: 'Замкнутые водные контуры и терминалы связи создают уютную среду для жизни на лунной базе.',
    unlockHq: 3, labLevel: 2, science: 140, cost: { credits: 1000 }, timeSec: 1200, prereqs: ['urban_ecology'],
    effectText: 'Открывает водный рециркулятор и коммуникационный узел для повышения комфорта.', unlockFeature: 'decor',
  },
  {
    key: 'expedition_protocols', branch: 'exploration', name: 'Экспедиционные протоколы', emoji: '',
    description: 'Подготовка исследовательских аппаратов и безопасного возвращения находок в колонию.',
    unlockHq: 3, labLevel: 1, science: 90, cost: { credits: 800 }, timeSec: 600, prereqs: ['basic_theory'],
    effectText: 'Открывает центр экспедиций и отправку аппаратов.', unlockBuilding: 'expedition_center', unlockFeature: 'expeditions',
  },
  {
    key: 'basic_theory', branch: 'foundation', name: 'Прикладная ксенология', emoji: '🧬',
    description: 'Базовые методы анализа неизвестных сигналов и материалов.',
    unlockHq: 2, labLevel: 1, science: 20, cost: { credits: 300 }, timeSec: 300, prereqs: [],
    effectText: '+10% к генерации очков науки',
  },
  {
    key: 'extraction_ai', branch: 'resources', name: 'Адаптивная добыча', emoji: '⛏️',
    description: 'Алгоритмы распределения буровых циклов по наиболее перспективным зонам.',
    unlockHq: 2, labLevel: 1, science: 160, cost: { credits: 1200, parts: 40 }, timeSec: 1200, prereqs: ['basic_theory'],
    effectText: '+7% к производству руды',
  },
  {
    key: 'solar_lattice', branch: 'resources', name: 'Солнечная решётка', emoji: '☀️',
    description: 'Синхронизация энергетических модулей и снижение потерь преобразования.',
    unlockHq: 2, labLevel: 1, science: 160, cost: { credits: 1200, parts: 40 }, timeSec: 1200, prereqs: ['basic_theory'],
    effectText: '+7% к производству энергии',
  },
  {
    key: 'deep_drilling', branch: 'resources', name: 'Глубокое бурение', emoji: '🛢️',
    description: 'Освой глубокие залежи. Новая шахта дороже обычной, зато добывает больше с одной клетки.',
    unlockHq: 3, labLevel: 2, science: 360, cost: { credits: 2800, parts: 160 }, timeSec: 3600, prereqs: ['extraction_ai'],
    effectText: 'Открывает глубинную шахту: базово 300 руды/ч', unlockBuilding: 'deep_mine',
  },
  {
    key: 'photovoltaic_arrays', branch: 'resources', name: 'Фотоэлектрические массивы', emoji: '🌞',
    description: 'Объедини панели в мощную установку. Более дорогая энергетика экономит место в городе.',
    unlockHq: 3, labLevel: 2, science: 360, cost: { credits: 2800, parts: 160 }, timeSec: 3600, prereqs: ['solar_lattice'],
    effectText: 'Открывает солнечный массив: базово 250 энергии/ч', unlockBuilding: 'solar_array',
  },
  {
    key: 'compact_storage', branch: 'production', name: 'Компактное хранение', emoji: '📦',
    description: 'Новая компоновка складских ячеек и автоматизированная укладка грузов.',
    unlockHq: 3, labLevel: 2, science: 220, cost: { credits: 1600, parts: 80 }, timeSec: 1800, prereqs: ['basic_theory'],
    effectText: '+10% ко вместимости складов',
  },
  {
    key: 'thermal_recovery', branch: 'production', name: 'Рекуперация расплава', emoji: '🔥',
    description: 'Возврат тепла и вторичная переработка отходов литейного цикла.',
    unlockHq: 3, labLevel: 2, science: 260, cost: { credits: 2200, parts: 120 }, timeSec: 2700, prereqs: ['basic_theory'],
    effectText: '+10% к выходу деталей из плавки',
  },
  {
    key: 'precision_casting', branch: 'production', name: 'Точное литьё', emoji: '🎯',
    description: 'Более точная обработка сохраняет руду, но требует больше энергии и времени. Полезно при избытке энергии.',
    unlockHq: 3, labLevel: 2, science: 340, cost: { credits: 2600, parts: 160 }, timeSec: 3600, prereqs: ['thermal_recovery'],
    effectText: 'Открывает рецепт: 70 руды + 90 энергии → базово 35 деталей за 7 минут', unlockRecipe: 'precision_casting',
  },
  {
    key: 'industrial_casting', branch: 'production', name: 'Поточное литьё', emoji: '🏗️',
    description: 'Двойной выпуск за одно место в очереди. Больше руды, меньше энергии на деталь — удобно для длинной партии.',
    unlockHq: 3, labLevel: 2, science: 420, cost: { credits: 3400, parts: 200 }, timeSec: 5400, prereqs: ['thermal_recovery', 'extraction_ai'],
    effectText: 'Открывает рецепт: 240 руды + 60 энергии → базово 70 деталей за 10 минут', unlockRecipe: 'industrial_casting',
  },
  {
    key: 'deep_navigation', branch: 'exploration', name: 'Глубокая навигация', emoji: '🧭',
    description: 'Расчёт безопасных маршрутов за пределы локальной орбиты колонии.',
    unlockHq: 3, labLevel: 2, science: 300, cost: { credits: 2500, parts: 120 }, timeSec: 3600, prereqs: ['basic_theory'],
    effectText: 'Открывает экспедицию «Орбитальные руины»',
  },
  {
    key: 'signal_analysis', branch: 'exploration', name: 'Спектральный анализ', emoji: '📡',
    description: 'Выделение слабых закономерностей в шуме и неизвестных передачах.',
    unlockHq: 4, labLevel: 3, science: 450, cost: { credits: 4200, parts: 180 }, timeSec: 5400, prereqs: ['basic_theory'],
    effectText: '+15% науки из экспедиций',
  },
  {
    key: 'autonomous_drones', branch: 'exploration', name: 'Автономные дроны', emoji: '🤖',
    description: 'Независимые исследовательские аппараты для параллельных вылетов.',
    unlockHq: 4, labLevel: 3, science: 520, cost: { credits: 5500, parts: 260 }, timeSec: 7200, prereqs: ['deep_navigation'],
    effectText: '+1 слот экспедиций',
  },
  {
    key: 'archive_network', branch: 'production', name: 'Распределённый архив', emoji: '🗄️',
    description: 'Сеть автономных архивов продолжает сбор данных во время отсутствия оператора.',
    unlockHq: 4, labLevel: 3, science: 600, cost: { credits: 5000, parts: 240 }, timeSec: 7200, prereqs: ['compact_storage'],
    effectText: '+2 часа к лимиту офлайн-производства',
  },
  {
    key: 'deep_space_protocol', branch: 'exploration', name: 'Протокол дальнего сигнала', emoji: '🌌',
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
  // Fractional science is retained by the server's passive carry.
  return base * (completed.has('basic_theory') ? 1.10 : 1);
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
