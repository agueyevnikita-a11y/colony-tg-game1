export const SUPPLY_PROJECT_REQUIRED_HQ = 3;
export const SUPPLY_PROJECT_RESOURCES = ['ore', 'energy', 'parts'] as const;
export type SupplyProjectResource = typeof SUPPLY_PROJECT_RESOURCES[number];
export type SupplyProjectKey = 'cargo_route' | 'polar_lab' | 'dawn_district';
export type SupplyRequirements = Record<SupplyProjectResource, number>;
export type SupplyProjectReward = { credits: number; science: number; crystals: number; cosmeticIds: string[] };
export type SupplyProjectStage = { name: string; requirements: SupplyRequirements; reward: SupplyProjectReward };
export type SupplyProjectDefinition = {
  id: SupplyProjectKey; version: number; name: string; description: string; icon: string; stages: SupplyProjectStage[];
};

export const SUPPLY_PROJECTS: readonly SupplyProjectDefinition[] = [
  {
    id: 'cargo_route', version: 1, name: 'Лунный грузовой маршрут', icon: 'contracts',
    description: 'Снабди первый регулярный конвой. Кредиты за этапы помогут расширить колонию.',
    stages: [
      { name: 'Подготовка грузовой площадки', requirements: { ore: 300, parts: 70, energy: 100 }, reward: { credits: 700, science: 0, crystals: 0, cosmeticIds: [] } },
      { name: 'Оборудование перевалочного узла', requirements: { ore: 500, parts: 140, energy: 200 }, reward: { credits: 1300, science: 20, crystals: 0, cosmeticIds: [] } },
      { name: 'Первый лунный конвой', requirements: { ore: 800, parts: 210, energy: 300 }, reward: { credits: 2200, science: 40, crystals: 15, cosmeticIds: ['title_cargo_dispatcher'] } },
    ],
  },
  {
    id: 'polar_lab', version: 1, name: 'Полярная лаборатория', icon: 'science',
    description: 'Доставь оборудование к полярным залежам. Наука за этапы приблизит новые технологии.',
    stages: [
      { name: 'Разведочный лагерь', requirements: { ore: 200, parts: 70, energy: 150 }, reward: { credits: 150, science: 60, crystals: 0, cosmeticIds: [] } },
      { name: 'Изолированный научный модуль', requirements: { ore: 400, parts: 140, energy: 300 }, reward: { credits: 300, science: 120, crystals: 0, cosmeticIds: [] } },
      { name: 'Запуск полярной станции', requirements: { ore: 600, parts: 210, energy: 450 }, reward: { credits: 500, science: 220, crystals: 15, cosmeticIds: ['title_polar_engineer'] } },
    ],
  },
  {
    id: 'dawn_district', version: 1, name: 'Жилой район «Рассвет»', icon: 'city',
    description: 'Снабди жилой район «Рассвет» оборудованием. Получи кредиты, науку и памятный титул.',
    stages: [
      { name: 'Защищённое основание', requirements: { ore: 400, parts: 105, energy: 100 }, reward: { credits: 500, science: 20, crystals: 0, cosmeticIds: [] } },
      { name: 'Жилые и служебные модули', requirements: { ore: 600, parts: 210, energy: 200 }, reward: { credits: 1000, science: 60, crystals: 0, cosmeticIds: [] } },
      { name: 'Открытие района', requirements: { ore: 1000, parts: 315, energy: 300 }, reward: { credits: 1700, science: 120, crystals: 25, cosmeticIds: ['title_dawn_founder'] } },
    ],
  },
];

export type SupplyProjectState = SupplyProjectDefinition & {
  stageIndex: number; delivered: SupplyRequirements; remaining: SupplyRequirements;
  ready: boolean; completed: boolean; started: boolean; completedAt: string | null;
};
export type SupplyProjectsState = {
  available: boolean; unlocked: boolean; requiredHq: number;
  lockReason: 'hq' | 'logistics' | 'migration' | null;
  logistics: { status: string; completesAt: string | null } | null;
  projects: SupplyProjectState[];
};
export type SupplyProjectRequest = {
  projectKey: SupplyProjectKey; requestId: string; definitionVersion: number; expectedStage: number;
} & ({ action: 'deliver'; resource: SupplyProjectResource; amount: number } | { action: 'claim' });

export function remainingSupplyRequirements(requirements: SupplyRequirements, delivered: SupplyRequirements): SupplyRequirements {
  return Object.fromEntries(SUPPLY_PROJECT_RESOURCES.map(resource => {
    if (!Number.isSafeInteger(requirements[resource]) || requirements[resource] < 0
      || !Number.isSafeInteger(delivered[resource]) || delivered[resource] < 0) throw new Error('Некорректный объём поставки');
    return [resource, Math.max(0, requirements[resource] - delivered[resource])];
  })) as SupplyRequirements;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseSupplyProjectRequest(input: unknown): SupplyProjectRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Выбери действие проекта снабжения');
  const body = input as Record<string, unknown>;
  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) throw new Error('Некорректный номер поставки');
  if (!SUPPLY_PROJECTS.some(project => project.id === body.projectKey)) throw new Error('Проект снабжения не найден');
  if (typeof body.definitionVersion !== 'number' || !Number.isSafeInteger(body.definitionVersion) || body.definitionVersion < 1) throw new Error('Обнови условия проекта снабжения');
  if (typeof body.expectedStage !== 'number' || !Number.isInteger(body.expectedStage) || body.expectedStage < 0 || body.expectedStage > 2) throw new Error('Обнови этап проекта снабжения');
  const base = { projectKey: body.projectKey as SupplyProjectKey, requestId: body.requestId.toLowerCase(),
    definitionVersion: body.definitionVersion, expectedStage: body.expectedStage };
  if (body.action === 'claim') return { ...base, action: 'claim' };
  if (body.action !== 'deliver') throw new Error('Неизвестное действие проекта снабжения');
  if (!SUPPLY_PROJECT_RESOURCES.includes(body.resource as SupplyProjectResource)) throw new Error('Выбери руду, энергию или детали для поставки');
  if (typeof body.amount !== 'number' || !Number.isInteger(body.amount) || body.amount < 1 || body.amount > 1_000_000) throw new Error('Поставка — целое число от 1 до 1 000 000');
  return { ...base, action: 'deliver', resource: body.resource as SupplyProjectResource, amount: body.amount };
}
