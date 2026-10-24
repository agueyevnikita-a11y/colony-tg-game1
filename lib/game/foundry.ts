export type FoundryMode = 'economy' | 'standard' | 'rush';
export type FoundryLink = 'none' | 'ore' | 'energy';
export type FoundryRecipeKey = 'standard_alloy' | 'precision_casting' | 'industrial_casting';
export type FoundryRecipe = {
  id: FoundryRecipeKey;
  name: string;
  description: string;
  ore: number;
  energy: number;
  parts: number;
  seconds: number;
  requiredResearch?: string;
};
export type FoundryBuilding = { id: string; type: string; status: string; level: number; x: number; y: number };
export type FoundryJob = {
  id: string; building_id: string; started_at: string; completes_at: string;
  parts_reward: number; ore_spent: number; energy_spent: number;
  recipe_key?: string | null;
};

export const FOUNDRY_RECIPES: FoundryRecipe[] = [
  { id: 'standard_alloy', name: 'Стандартный сплав', description: 'Сбалансированный расход руды и энергии', ore: 100, energy: 40, parts: 35, seconds: 300 },
  { id: 'precision_casting', name: 'Точное литьё', description: 'Экономит руду за счёт энергии и времени', ore: 70, energy: 90, parts: 35, seconds: 420, requiredResearch: 'precision_casting' },
  { id: 'industrial_casting', name: 'Поточное литьё', description: 'Вдвое больше деталей за цикл, меньше энергии на деталь', ore: 240, energy: 60, parts: 70, seconds: 600, requiredResearch: 'industrial_casting' },
];

export function availableFoundryRecipes(completed: Set<string>) {
  return FOUNDRY_RECIPES.filter((recipe) => !recipe.requiredResearch || completed.has(recipe.requiredResearch));
}

export const FOUNDRY_MODES: { id: FoundryMode; name: string; description: string; ore: number; energy: number; seconds: number }[] = [
  { id: 'economy', name: 'Экономный', description: 'Меньше энергии, больше времени', ore: 100, energy: 25, seconds: 600 },
  { id: 'standard', name: 'Обычный', description: 'Привычный расход и скорость', ore: 100, energy: 40, seconds: 300 },
  { id: 'rush', name: 'Быстрый', description: 'Быстрее, но больше энергии', ore: 100, energy: 70, seconds: 150 },
];

export function foundryQueueCapacity(level: number) {
  return Math.min(12, 6 + Math.floor((Math.max(1, Number(level)) - 1) / 5) * 2);
}

/** Buildings are the current player's city. Only side-by-side active suppliers count. */
export function availableFoundryLinks(building: FoundryBuilding, buildings: FoundryBuilding[]): FoundryLink[] {
  const links: FoundryLink[] = ['none'];
  if (building.type !== 'foundry') return links;
  const neighbors = buildings.filter((other) => other.id !== building.id && other.status === 'active'
    && Math.abs(Number(other.x) - Number(building.x)) + Math.abs(Number(other.y) - Number(building.y)) === 1);
  if (neighbors.some((other) => other.type === 'mine' || other.type === 'deep_mine')) links.push('ore');
  if (neighbors.some((other) => other.type === 'solar' || other.type === 'solar_array')) links.push('energy');
  return links;
}

export function quoteFoundry({ level, mode, link, cycles, partsMultiplier = 1, recipe = 'standard_alloy' }: {
  level: number; mode: FoundryMode; link: FoundryLink; cycles: number; partsMultiplier?: number; recipe?: FoundryRecipeKey;
}) {
  const config = FOUNDRY_MODES.find((item) => item.id === mode);
  const recipeConfig = FOUNDRY_RECIPES.find((item) => item.id === recipe);
  if (!config || !['none', 'ore', 'energy'].includes(link)) throw new Error('Неизвестный режим или связь цеха');
  if (!recipeConfig) throw new Error('Неизвестный рецепт плавки');
  if (!Number.isInteger(level) || level < 1 || level > 15) throw new Error('Некорректный уровень цеха');
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > foundryQueueCapacity(level)) throw new Error('Некорректное количество циклов');
  if (!Number.isFinite(partsMultiplier) || partsMultiplier <= 0) throw new Error('Некорректный бонус производства');
  const cycleOre = Math.ceil(recipeConfig.ore * (link === 'ore' ? 0.85 : 1));
  const cycleEnergy = Math.ceil(recipeConfig.energy * (config.energy / 40) * (link === 'energy' ? 0.8 : 1));
  const cycleSeconds = Math.max(30, Math.ceil(recipeConfig.seconds * (config.seconds / 300) / (1 + (level - 1) * 0.12)));
  const cycleParts = Math.floor(recipeConfig.parts * (1 + (level - 1) * 0.08) * partsMultiplier);
  return { ore: cycleOre * cycles, energy: cycleEnergy * cycles, parts: cycleParts * cycles,
    seconds: cycleSeconds * cycles, cycleSeconds, cycleParts };
}

export function parseFoundryOrder(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный заказ');
  const body = value as Record<string, unknown>;
  const mode = body.mode === undefined ? 'standard' : body.mode;
  const recipe = body.recipe === undefined ? 'standard_alloy' : body.recipe;
  const link = body.link === undefined ? 'none' : body.link;
  const cycles = body.cycles === undefined ? 1 : body.cycles;
  if (!FOUNDRY_MODES.some((item) => item.id === mode)) throw new Error('Неизвестный режим плавки');
  if (!FOUNDRY_RECIPES.some((item) => item.id === recipe)) throw new Error('Неизвестный рецепт плавки');
  if (!['none', 'ore', 'energy'].includes(link as string)) throw new Error('Неизвестная производственная связь');
  if (typeof cycles !== 'number' || !Number.isInteger(cycles) || cycles < 1 || cycles > 12) throw new Error('Выберите от 1 до 12 циклов');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const key of ['buildingId', 'requestId']) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || !uuid.test(body[key] as string))) {
      throw new Error(key === 'buildingId' ? 'Некорректный цех' : 'Некорректный номер заказа');
    }
  }
  return { buildingId: body.buildingId as string | undefined, requestId: body.requestId as string | undefined,
    mode: mode as FoundryMode, recipe: recipe as FoundryRecipeKey, link: link as FoundryLink, cycles };
}

/** Keep whole completed cycles in the workshop when the warehouse cannot hold their output. */
export function collectableFoundryJobs<T extends { id: string; parts_reward: number | string }>(jobs: T[], capacity: number) {
  let remaining = Math.max(0, capacity);
  const collected: T[] = [];
  for (const job of jobs) {
    const parts = Number(job.parts_reward);
    if (parts <= remaining) { collected.push(job); remaining -= parts; }
  }
  return collected;
}

/** Snapshot-only guidance: issuance checks all workshops in server order, one whole cycle at a time. */
export function foundryQueueOverview({ buildings, jobs, now, currentParts, partsCapacity }: {
  buildings: readonly FoundryBuilding[]; jobs: readonly FoundryJob[]; now: number;
  currentParts: unknown; partsCapacity?: number;
}) {
  const foundries = buildings.filter(building => building.type === 'foundry');
  const foundryIds = new Set(foundries.map(building => building.id));
  const cityJobs = jobs.filter(job => foundryIds.has(job.building_id));
  const ready = cityJobs.filter(job => Number.isFinite(Date.parse(job.completes_at))
    && Date.parse(job.completes_at) <= now && Number.isFinite(Number(job.parts_reward)) && Number(job.parts_reward) > 0)
    .sort((a, b) => Date.parse(a.completes_at) - Date.parse(b.completes_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const storedParts = typeof currentParts === 'number' || typeof currentParts === 'string' ? Number(currentParts) : NaN;
  const knownStorage = partsCapacity !== undefined && Number.isFinite(partsCapacity) && partsCapacity >= 0
    && Number.isFinite(storedParts) && storedParts >= 0;
  const collectable = knownStorage ? collectableFoundryJobs(ready, partsCapacity - storedParts) : null;
  const collectableIds = collectable ? new Set(collectable.map(job => job.id)) : null;
  const workshops = foundries.map(building => {
    const ownJobs = cityJobs.filter(job => job.building_id === building.id);
    const ownReady = ready.filter(job => job.building_id === building.id);
    const capacity = foundryQueueCapacity(Number(building.level));
    return { id: building.id, occupied: ownJobs.length, capacity, freeSlots: Math.max(0, capacity - ownJobs.length),
      readyCount: ownReady.length, collectableCount: collectableIds ? ownReady.filter(job => collectableIds.has(job.id)).length : null };
  });
  return { workshops, readyCount: ready.length, readyParts: ready.reduce((sum, job) => sum + Number(job.parts_reward), 0),
    collectableCount: collectable?.length ?? null, collectableParts: collectable?.reduce((sum, job) => sum + Number(job.parts_reward), 0) ?? null,
    readyBuildingIds: [...new Set(ready.map(job => job.building_id))] };
}
