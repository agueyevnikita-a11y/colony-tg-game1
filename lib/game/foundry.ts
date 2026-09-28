export type FoundryMode = 'economy' | 'standard' | 'rush';
export type FoundryLink = 'none' | 'ore' | 'energy';
export type FoundryBuilding = { id: string; type: string; status: string; level: number; x: number; y: number };
export type FoundryJob = {
  id: string; building_id: string; started_at: string; completes_at: string;
  parts_reward: number; ore_spent: number; energy_spent: number;
};

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
  if (neighbors.some((other) => other.type === 'mine')) links.push('ore');
  if (neighbors.some((other) => other.type === 'solar')) links.push('energy');
  return links;
}

export function quoteFoundry({ level, mode, link, cycles, partsMultiplier = 1 }: {
  level: number; mode: FoundryMode; link: FoundryLink; cycles: number; partsMultiplier?: number;
}) {
  const config = FOUNDRY_MODES.find((item) => item.id === mode);
  if (!config || !['none', 'ore', 'energy'].includes(link)) throw new Error('Неизвестный режим или связь цеха');
  if (!Number.isInteger(level) || level < 1 || level > 15) throw new Error('Некорректный уровень цеха');
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > foundryQueueCapacity(level)) throw new Error('Некорректное количество циклов');
  if (!Number.isFinite(partsMultiplier) || partsMultiplier <= 0) throw new Error('Некорректный бонус производства');
  const cycleOre = Math.ceil(config.ore * (link === 'ore' ? 0.85 : 1));
  const cycleEnergy = Math.ceil(config.energy * (link === 'energy' ? 0.8 : 1));
  const cycleSeconds = Math.max(30, Math.ceil(config.seconds / (1 + (level - 1) * 0.12)));
  const cycleParts = Math.floor(35 * (1 + (level - 1) * 0.08) * partsMultiplier);
  return { ore: cycleOre * cycles, energy: cycleEnergy * cycles, parts: cycleParts * cycles,
    seconds: cycleSeconds * cycles, cycleSeconds, cycleParts };
}

export function parseFoundryOrder(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный заказ');
  const body = value as Record<string, unknown>;
  const mode = body.mode === undefined ? 'standard' : body.mode;
  const link = body.link === undefined ? 'none' : body.link;
  const cycles = body.cycles === undefined ? 1 : body.cycles;
  if (!FOUNDRY_MODES.some((item) => item.id === mode)) throw new Error('Неизвестный режим плавки');
  if (!['none', 'ore', 'energy'].includes(link as string)) throw new Error('Неизвестная производственная связь');
  if (typeof cycles !== 'number' || !Number.isInteger(cycles) || cycles < 1 || cycles > 12) throw new Error('Выберите от 1 до 12 циклов');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const key of ['buildingId', 'requestId']) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || !uuid.test(body[key] as string))) {
      throw new Error(key === 'buildingId' ? 'Некорректный цех' : 'Некорректный номер заказа');
    }
  }
  return { buildingId: body.buildingId as string | undefined, requestId: body.requestId as string | undefined,
    mode: mode as FoundryMode, link: link as FoundryLink, cycles };
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
