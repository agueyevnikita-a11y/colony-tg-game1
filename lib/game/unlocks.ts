export const FEATURE_RESEARCH = {
  market: { researchKey: 'trade_network', name: 'Межколониальная торговля', title: 'Рынок игроков', icon: 'market', description: 'Обменивай ресурсы с другими колониями. Контракты торгового узла доступны отдельно.' },
  expeditions: { researchKey: 'expedition_protocols', name: 'Экспедиционные протоколы', title: 'Экспедиции', icon: 'rocket', description: 'Отправляй аппараты за ресурсами, научными данными и артефактами.' },
} as const;

export type ColonyFeature = keyof typeof FEATURE_RESEARCH;

export function colonyUnlocks(completed: Iterable<string>, legacy: Iterable<string> = []) {
  const research = new Set(completed), retained = new Set(legacy);
  return Object.fromEntries(Object.entries(FEATURE_RESEARCH).map(([feature, config]) => [feature, {
    ...config, unlocked: research.has(config.researchKey) || retained.has(feature), legacy: retained.has(feature),
  }])) as { [K in ColonyFeature]: typeof FEATURE_RESEARCH[K] & { unlocked: boolean; legacy: boolean } };
}
