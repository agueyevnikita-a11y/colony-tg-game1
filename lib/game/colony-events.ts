import type { BuildingType } from './config';
import { TUTORIAL_STEPS } from './tutorial';

export type ColonyEventResource = 'ore' | 'energy' | 'parts' | 'credits' | 'science';
export type ColonyEventAmounts = Partial<Record<ColonyEventResource, number>>;

export type ColonyEventChoice = {
  id: string;
  title: string;
  description: string;
  cost: ColonyEventAmounts;
  reward: ColonyEventAmounts;
  resultText: string;
  requiredResearch?: string;
};

export type ColonyEventDefinition = {
  key: string;
  title: string;
  description: string;
  buildingType: BuildingType;
  choices: ColonyEventChoice[];
};

export const COLONY_EVENT_COOLDOWN_SEC = 43_200;

function automaticChoice(resultText: string): ColonyEventChoice {
  return {
    id: 'delegate',
    title: 'Доверить автоматике',
    description: 'Штатные системы справятся без затрат. Получи небольшой доход за плановые работы.',
    cost: {},
    reward: { credits: 90 },
    resultText,
  };
}

export const COLONY_EVENTS: ColonyEventDefinition[] = [
  {
    key: 'rich_vein',
    title: 'Богатая жила',
    description: 'Сканеры шахты нашли плотный пласт руды. Штатная добыча продолжается: можно выделить энергию на дополнительную выработку, изучить образцы или оставить работу автоматике.',
    buildingType: 'mine',
    choices: [
      {
        id: 'extract',
        title: 'Добыть дополнительную руду',
        description: 'Потрать энергию на отдельный проход буровой установки.',
        cost: { energy: 100 },
        reward: { ore: 300 },
        resultText: 'Дополнительный проход завершён. Руда доставлена на склад, штатная добыча идёт своим ходом.',
      },
      {
        id: 'analyze',
        title: 'Изучить состав жилы',
        description: 'Выдели руду и энергию на анализ образцов. Результат пополнит запас науки.',
        cost: { ore: 80, energy: 60 },
        reward: { science: 18 },
        resultText: 'Образцы изучены. Данные о составе жилы пополнили запас науки для исследований.',
      },
      automaticChoice('Автоматика провела плановую выработку. Колония получила доход, добыча не прерывалась.'),
    ],
  },
  {
    key: 'converter_drift',
    title: 'Настройка преобразователя',
    description: 'Электростанция обнаружила отклонение в показаниях преобразователя. Резервная автоматика поддерживает обычную выработку. Можно провести точную настройку или изучить данные.',
    buildingType: 'solar',
    choices: [
      {
        id: 'recalibrate',
        title: 'Настроить преобразователь',
        description: 'Используй детали для калибровки и получи разовую порцию энергии.',
        cost: { parts: 12 },
        reward: { energy: 280 },
        resultText: 'Калибровка завершена. Разовая порция энергии сохранена на складе; обычная выработка не изменилась.',
      },
      {
        id: 'analyze',
        title: 'Изучить показания',
        description: 'Выдели энергию для серии измерений и получи науку.',
        cost: { energy: 100 },
        reward: { science: 20 },
        resultText: 'Серия измерений завершена. Данные пополнили запас науки для исследований.',
      },
      automaticChoice('Резервная автоматика выполнила штатную настройку. Колония получила доход, выработка не прерывалась.'),
    ],
  },
  {
    key: 'cooling_loop',
    title: 'Тепло литейного цеха',
    description: 'Датчики цеха собрали новые данные о контуре охлаждения. Штатная система сохраняет рабочий режим. Можно изучить измерения или использовать технологию рекуперации для отдельной плавки.',
    buildingType: 'foundry',
    choices: [
      {
        id: 'study',
        title: 'Изучить контур охлаждения',
        description: 'Используй детали для проверки датчиков и получи науку.',
        cost: { parts: 10 },
        reward: { science: 18 },
        resultText: 'Датчики проверены. Схема тепловых потоков пополнила запас науки для исследований.',
      },
      {
        id: 'recycle',
        title: 'Провести отдельную плавку',
        description: 'Примени рекуперацию тепла: потрать руду и энергию, чтобы сразу получить детали.',
        cost: { ore: 60, energy: 100 },
        reward: { parts: 40 },
        requiredResearch: 'thermal_recovery',
        resultText: 'Отдельная плавка с рекуперацией завершена. Детали доставлены на склад, очередь цеха не изменилась.',
      },
      automaticChoice('Штатная система выполнила обслуживание контура. Колония получила доход, работа цеха не прерывалась.'),
    ],
  },
  {
    key: 'sensor_noise',
    title: 'Необычный сигнал',
    description: 'Исследовательский центр заметил необычный сигнал в архиве датчиков. Штатные системы продолжают работу. Можно проверить приборы, заказать моделирование или поручить разбор автоматике.',
    buildingType: 'research_lab',
    choices: [
      {
        id: 'calibrate',
        title: 'Проверить датчики',
        description: 'Используй детали для точной проверки и получи науку.',
        cost: { parts: 8 },
        reward: { science: 20 },
        resultText: 'Датчики проверены. Полезные наблюдения пополнили запас науки для исследований.',
      },
      {
        id: 'simulate',
        title: 'Заказать моделирование',
        description: 'Оплати вычисления, чтобы получить больше науки из собранных данных.',
        cost: { credits: 160 },
        reward: { science: 30 },
        resultText: 'Моделирование завершено. Результаты пополнили запас науки для исследований.',
      },
      automaticChoice('Автоматика разобрала сигнал и упорядочила архив. Колония получила доход, исследования не прерывались.'),
    ],
  },
];

const RESOURCES: readonly ColonyEventResource[] = ['ore', 'energy', 'parts', 'credits', 'science'];
const STORED_RESOURCES = ['ore', 'energy', 'parts'] as const;

function nonNegativeNumber(value: unknown): number {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function colonyEventsUnlocked(hqLevel: number, tutorialStep: number): boolean {
  return Number.isFinite(hqLevel) && hqLevel >= 2
    && Number.isFinite(tutorialStep) && tutorialStep >= TUTORIAL_STEPS.length;
}

export function eligibleColonyEvents(buildings: readonly { type: string; status: string }[]): ColonyEventDefinition[] {
  const activeTypes = new Set(buildings.filter((building) => building.status === 'active').map((building) => building.type));
  return COLONY_EVENTS.filter((event) => activeTypes.has(event.buildingType));
}

/** Capacities exclude space reserved for resources held in market escrow. */
export function evaluateColonyChoice(
  choice: ColonyEventChoice,
  resources: Record<string, unknown>,
  capacities: Partial<Record<'ore' | 'energy' | 'parts', number>>,
  completedResearch: readonly string[] = [],
): {
  shortages: ColonyEventAmounts;
  storageShortages: ColonyEventAmounts;
  requiredResearch: string | null;
  canResolve: boolean;
} {
  const shortages: ColonyEventAmounts = {};
  const storageShortages: ColonyEventAmounts = {};
  let validAmounts = true;
  for (const resource of RESOURCES) {
    const rawCost = choice.cost[resource];
    const rawReward = choice.reward[resource];
    if ((rawCost !== undefined && (!Number.isFinite(rawCost) || rawCost < 0))
      || (rawReward !== undefined && (!Number.isFinite(rawReward) || rawReward < 0))) validAmounts = false;
    const cost = nonNegativeNumber(rawCost);
    const available = nonNegativeNumber(resources[resource]);
    if (available < cost) shortages[resource] = cost - available;
  }
  for (const resource of STORED_RESOURCES) {
    const reward = nonNegativeNumber(choice.reward[resource]);
    // Existing excess must never prevent a choice that adds none of this resource.
    if (reward === 0) continue;
    const afterCost = Math.max(0, nonNegativeNumber(resources[resource]) - nonNegativeNumber(choice.cost[resource]));
    const capacity = nonNegativeNumber(capacities[resource]);
    const missingSpace = afterCost + reward - capacity;
    if (missingSpace > 0) storageShortages[resource] = missingSpace;
  }
  const requiredResearch = choice.requiredResearch && !completedResearch.includes(choice.requiredResearch)
    ? choice.requiredResearch : null;
  return {
    shortages,
    storageShortages,
    requiredResearch,
    canResolve: validAmounts && requiredResearch === null
      && Object.keys(shortages).length === 0 && Object.keys(storageShortages).length === 0,
  };
}
