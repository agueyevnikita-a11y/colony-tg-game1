export type DecorType = 'road' | 'tree' | 'lamp' | 'park' | 'statue' | 'bench' | 'flowerbed' | 'fountain' | 'plaza';

export type DecorConfig = {
  name: string;
  emoji: string;
  description: string;
  credits: number;
  unlockHq: number;
  unlockResearch?: string;
  comfort: number;
};

export type DecorCatalogItem = DecorConfig & { type: DecorType; researchRequirementName?: string | null };

export const DECOR_CATALOG: Record<DecorType, DecorConfig> = {
  road: { name: 'Дорога', emoji: '🛣️', description: 'Соединяет районы в единый городской маршрут. Здания работают и без дорог.', credits: 50, unlockHq: 1, comfort: 4 },
  tree: { name: 'Зелёный модуль', emoji: '🌳', description: 'Первый зелёный уголок среди заводов и буровых установок.', credits: 100, unlockHq: 1, comfort: 6 },
  lamp: { name: 'Световой модуль', emoji: '💡', description: 'Мягкий свет для вечерних улиц колонии.', credits: 140, unlockHq: 2, comfort: 6 },
  park: { name: 'Парк', emoji: '🌲', description: 'Небольшой сад для отдыха жителей после смены.', credits: 400, unlockHq: 3, comfort: 12 },
  statue: { name: 'Монумент колонии', emoji: '🗿', description: 'Памятный знак общих достижений колонистов.', credits: 1000, unlockHq: 4, comfort: 10 },
  bench: { name: 'Площадка отдыха', emoji: '🪑', description: 'Место встречи соседей и короткого отдыха между сменами.', credits: 180, unlockHq: 2, comfort: 8 },
  flowerbed: { name: 'Цветник', emoji: '🌿', description: 'Адаптированные растения добавляют цвета суровому инопланетному городу.', credits: 220, unlockHq: 2, unlockResearch: 'urban_ecology', comfort: 8 },
  fountain: { name: 'Водный сад', emoji: '⛲', description: 'Замкнутый водный контур и зелень создают тихое место для прогулок.', credits: 650, unlockHq: 3, unlockResearch: 'public_spaces', comfort: 14 },
  plaza: { name: 'Площадь колонии', emoji: '🏙️', description: 'Общественное пространство для встреч и праздников колонистов.', credits: 900, unlockHq: 3, unlockResearch: 'public_spaces', comfort: 14 },
};

export function decorByType(type: unknown): DecorConfig | null {
  return typeof type === 'string' && Object.hasOwn(DECOR_CATALOG, type) ? DECOR_CATALOG[type as DecorType] : null;
}

export function decorRequirements(config: DecorConfig, hqLevel: number, completedResearch: readonly string[]) {
  const hqMet = Number.isFinite(hqLevel) && hqLevel >= config.unlockHq;
  const researchMet = !config.unlockResearch || completedResearch.includes(config.unlockResearch);
  return { hqMet, researchMet, unlocked: hqMet && researchMet };
}

export function decorCoordinates(rawX: unknown, rawY: unknown, size: number) {
  if (typeof rawX !== 'number' || typeof rawY !== 'number' || !Number.isInteger(rawX) || !Number.isInteger(rawY)) {
    throw new Error('Выбери целую клетку на карте');
  }
  if (!Number.isInteger(size) || size < 1 || rawX < 0 || rawY < 0 || rawX >= size || rawY >= size) {
    throw new Error('Клетка за границей территории');
  }
  return { x: rawX, y: rawY };
}
