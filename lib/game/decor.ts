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
  road: { name: 'Сервисный настил', emoji: '', description: 'Металлические панели с сигнальными огнями намечают маршруты между модулями. Соединять ими здания необязательно.', credits: 50, unlockHq: 1, comfort: 4 },
  tree: { name: 'Биокапсула', emoji: '', description: 'Герметичная капсула с растениями напоминает колонистам о Земле. Прозрачная оболочка защищает зелень от лунного вакуума.', credits: 100, unlockHq: 1, comfort: 6 },
  lamp: { name: 'Навигационный маяк', emoji: '', description: 'Световой ориентир на металлической опоре обозначает жилой сектор среди лунного реголита.', credits: 140, unlockHq: 2, comfort: 6 },
  park: { name: 'Купольный сад', emoji: '', description: 'Сад под герметичным куполом с собственной атмосферой. Здесь колонисты отдыхают среди зелени после смены.', credits: 400, unlockHq: 3, comfort: 12 },
  statue: { name: 'Монумент первопроходцев', emoji: '', description: 'Памятный знак тем, кто основал колонию. Металлический обелиск и сигнальный кристалл отмечают общий путь поселенцев.', credits: 1000, unlockHq: 4, comfort: 10 },
  bench: { name: 'Модуль отдыха', emoji: '', description: 'Небольшая герметичная капсула для отдыха после смены. Через обзорные окна видны лунная поверхность и огни базы.', credits: 180, unlockHq: 2, comfort: 8 },
  flowerbed: { name: 'Гидропонный модуль', emoji: '', description: 'Закрытый биомодуль с растениями под искусственным светом. Питательный раствор циркулирует внутри корпуса.', credits: 220, unlockHq: 2, unlockResearch: 'urban_ecology', comfort: 8 },
  fountain: { name: 'Водный рециркулятор', emoji: '', description: 'Вода движется по замкнутому контуру за прозрачными панелями. Мягкая подсветка подчёркивает течение в герметичных резервуарах.', credits: 650, unlockHq: 3, unlockResearch: 'public_spaces', comfort: 14 },
  plaza: { name: 'Коммуникационный узел', emoji: '', description: 'Декоративный терминал с антенной и световым экраном напоминает о связи с другими поселениями и домом.', credits: 900, unlockHq: 3, unlockResearch: 'public_spaces', comfort: 14 },
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
