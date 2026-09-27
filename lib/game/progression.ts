export type ProgressEvent =
  | 'daily_session'
  | 'build_started'
  | 'foundry_started'
  | 'contract_completed'
  | 'qualified_referral'
  | 'market_order_created'
  | 'market_trade_bought'
  | 'market_trade_sold'
  | 'research_completed'
  | 'expedition_started'
  | 'expedition_completed'
  | 'artifact_found'
  | 'unique_artifact_found';

export const DAILY_QUESTS = [
  { key: 'daily_login', title: 'Проверка связи', description: 'Зайди в колонию сегодня', event: 'daily_session' as const, target: 1, crystals: 3, credits: 100 },
  { key: 'daily_build', title: 'Стройка дня', description: 'Начни строительство 1 объекта', event: 'build_started' as const, target: 1, crystals: 6, credits: 250 },
  { key: 'daily_smelt', title: 'Горячий металл', description: 'Запусти 2 плавки', event: 'foundry_started' as const, target: 2, crystals: 6, credits: 200 },
  { key: 'daily_expedition', title: 'За горизонт', description: 'Заверши 1 экспедицию', event: 'expedition_completed' as const, target: 1, crystals: 2, credits: 150 },
] as const;

export const WEEKLY_QUESTS = [
  { key: 'weekly_build', title: 'Большая стройка', description: 'Начни 7 строительств', event: 'build_started' as const, target: 7, crystals: 25, credits: 1200 },
  { key: 'weekly_smelt', title: 'Промышленная неделя', description: 'Запусти 10 плавок', event: 'foundry_started' as const, target: 10, crystals: 25, credits: 900 },
  { key: 'weekly_contracts', title: 'Деловые связи', description: 'Выполни 3 NPC-контракта', event: 'contract_completed' as const, target: 3, crystals: 25, credits: 1500 },
  { key: 'weekly_expeditions', title: 'Исследовательская программа', description: 'Заверши 5 экспедиций', event: 'expedition_completed' as const, target: 5, crystals: 15, credits: 1000 },
] as const;

export type AchievementReward = {
  crystals?: number;
  cosmeticId?: string;
  cosmeticDays?: number;
};

export const ACHIEVEMENTS = [
  { key: 'builder_10', title: 'Прораб', description: 'Начни 10 строительств', stat: 'buildings_started', target: 10, reward: { crystals: 25 } },
  { key: 'builder_100', title: 'Архитектор', description: 'Начни 100 строительств', stat: 'buildings_started', target: 100, reward: { cosmeticId: 'theme_neon', cosmeticDays: 7 } },
  { key: 'builder_10000', title: 'Город без конца', description: 'Начни 10 000 строительств', stat: 'buildings_started', target: 10000, reward: { cosmeticId: 'theme_neon' } },
  { key: 'smelter_25', title: 'Металлург', description: 'Запусти 25 плавок', stat: 'foundry_jobs_started', target: 25, reward: { crystals: 40 } },
  { key: 'trader_10', title: 'Контрактник', description: 'Выполни 10 контрактов', stat: 'contracts_completed', target: 10, reward: { cosmeticId: 'frame_orbit', cosmeticDays: 14 } },
  { key: 'trader_100', title: 'Торговый магнат', description: 'Выполни 100 контрактов', stat: 'contracts_completed', target: 100, reward: { cosmeticId: 'frame_orbit' } },
  { key: 'network_1', title: 'Первый сигнал', description: 'Пригласи 1 игрока, который достигнет HQ3', stat: 'qualified_referrals', target: 1, reward: { cosmeticId: 'effect_signal', cosmeticDays: 7 } },
  { key: 'network_5', title: 'Связной', description: '5 квалифицированных приглашённых', stat: 'qualified_referrals', target: 5, reward: { cosmeticId: 'title_connector' } },
  { key: 'network_50', title: 'Архитектор сети', description: '50 квалифицированных приглашённых', stat: 'qualified_referrals', target: 50, reward: { cosmeticId: 'frame_connector' } },
  { key: 'market_25', title: 'Биржевик', description: 'Совершить 25 покупок на P2P-рынке', stat: 'market_trades_bought', target: 25, reward: { cosmeticId: 'frame_exchange', cosmeticDays: 7 } },
  { key: 'market_250', title: 'Мастер биржи', description: 'Совершить 250 покупок на P2P-рынке', stat: 'market_trades_bought', target: 250, reward: { cosmeticId: 'frame_exchange' } },

  { key: 'research_3', title: 'Научный метод', description: 'Заверши 3 исследования', stat: 'research_completed', target: 3, reward: { crystals: 30 } },
  { key: 'research_10', title: 'Главный исследователь', description: 'Заверши все 10 исследований', stat: 'research_completed', target: 10, reward: { cosmeticId: 'frame_researcher' } },
  { key: 'expedition_5', title: 'Разведчик', description: 'Заверши 5 экспедиций', stat: 'expeditions_completed', target: 5, reward: { crystals: 25 } },
  { key: 'expedition_25', title: 'За горизонтом', description: 'Заверши 25 экспедиций', stat: 'expeditions_completed', target: 25, reward: { cosmeticId: 'weather_aurora', cosmeticDays: 7 } },
  { key: 'expedition_100', title: 'Пилигрим', description: 'Заверши 100 экспедиций', stat: 'expeditions_completed', target: 100, reward: { cosmeticId: 'weather_aurora' } },
  { key: 'artifact_4', title: 'Коллекционер неизвестного', description: 'Найди все 4 вида артефактов', stat: 'unique_artifacts_found', target: 4, reward: { cosmeticId: 'frame_pathfinder' } },
] as const;

export const REFERRAL_MILESTONES = [
  { target: 3, crystals: 20 },
  { target: 10, cosmeticId: 'frame_connector', cosmeticDays: 30 },
  { target: 25, cosmeticId: 'monument_network' },
  { target: 50, cosmeticId: 'frame_connector' },
  { target: 100, cosmeticId: 'relay_legend' },
] as const;
