export type DecorType = 'road' | 'tree' | 'lamp' | 'park' | 'statue';

export const DECOR_CATALOG: Record<DecorType, { name: string; emoji: string; credits: number; unlockHq: number }> = {
  road: { name: 'Дорога', emoji: '🛣️', credits: 50, unlockHq: 1 },
  tree: { name: 'Зелёный модуль', emoji: '🌳', credits: 100, unlockHq: 1 },
  lamp: { name: 'Световой модуль', emoji: '💡', credits: 140, unlockHq: 2 },
  park: { name: 'Парк', emoji: '🌲', credits: 400, unlockHq: 3 },
  statue: { name: 'Монумент колонии', emoji: '🗿', credits: 1000, unlockHq: 4 },
};
