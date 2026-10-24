export type ProgressDestination = 'build' | 'production' | 'contracts' | 'expeditions' | 'city' | 'research' | 'market' | 'friends' | 'decor' | 'artifacts';

export type ProgressGoal = {
  stat: string | null;
  destination: ProgressDestination;
  label: string;
  icon: string;
  purpose: string;
  countHint: string;
};

const GOALS: Record<string, ProgressGoal> = {
  buildings_started: { stat: 'buildings_started', destination: 'build', label: 'К постройкам', icon: 'build', purpose: 'Здания расширяют возможности колонии: добычу, хранение и доступ к новым механикам.', countHint: 'Засчитывается начало оплаченного строительства или улучшения здания. Декор и перемещение зданий не считаются.' },
  foundry_jobs_started: { stat: 'foundry_jobs_started', destination: 'production', label: 'К производству', icon: 'parts', purpose: 'Цех превращает руду и энергию в детали для строительства, исследований и поставок.', countHint: 'Каждый оплаченный цикл партии считается отдельной плавкой. Ждать выдачи деталей не нужно.' },
  contracts_completed: { stat: 'contracts_completed', destination: 'contracts', label: 'К контрактам', icon: 'market', purpose: 'Контракты обменивают запасы колонии на кредиты для дальнейшего развития.', countHint: 'Засчитывается выполнение обычного контракта. Этапы поставок и сделки на рынке игроков не считаются контрактами.' },
  market_trades_bought: { stat: 'market_trades_bought', destination: 'market', label: 'К рынку игроков', icon: 'market', purpose: 'На рынке можно купить недостающие ресурсы у других игроков и продолжить развитие.', countHint: 'Считаются успешные покупки на рынке игроков: одна сделка — один зачёт независимо от объёма. Продажи и создание заявок не подходят.' },
  market_trades_sold: { stat: 'market_trades_sold', destination: 'market', label: 'К рынку игроков', icon: 'market', purpose: 'Продажа излишков другим игрокам приносит кредиты для развития колонии.', countHint: 'Зачёт происходит, когда другой игрок покупает ресурсы из твоей заявки. Само создание заявки не считается продажей.' },
  research_completed: { stat: 'research_completed', destination: 'research', label: 'К исследованиям', icon: 'research', purpose: 'Технологии открывают здания и рецепты, повышают эффективность добычи и производства.', countHint: 'Засчитывается завершённая технология. Запуск и оплата исследования сами по себе ещё не дают зачёт.' },
  expeditions_started: { stat: 'expeditions_started', destination: 'expeditions', label: 'К экспедициям', icon: 'rocket', purpose: 'Маршруты за пределами базы приносят науку, ресурсы и шанс найти артефакт.', countHint: 'Засчитывается успешная отправка аппарата. Получение результата — отдельное действие.' },
  expeditions_completed: { stat: 'expeditions_completed', destination: 'expeditions', label: 'К экспедициям', icon: 'rocket', purpose: 'Результаты экспедиций дают науку для технологий, ресурсы и шанс пополнить коллекцию.', countHint: 'Зачёт — после получения результата экспедиции. Дождаться возвращения аппарата недостаточно.' },
  artifacts_found: { stat: 'artifacts_found', destination: 'artifacts', label: 'К коллекции находок', icon: 'artifact_lens', purpose: 'Коллекция подсказывает, каких артефактов не хватает и на каких маршрутах их искать.', countHint: 'Находки засчитываются при получении результата экспедиции. Здесь учитываются и повторные артефакты.' },
  unique_artifacts_found: { stat: 'unique_artifacts_found', destination: 'artifacts', label: 'К коллекции находок', icon: 'artifact_lens', purpose: 'Четыре разных артефакта открывают достижение с постоянной рамкой для колонии.', countHint: 'Считается только первый найденный артефакт каждого вида. Повторная находка не приближает сбор всех видов.' },
  max_comfort: { stat: 'max_comfort', destination: 'decor', label: 'К лунному декору', icon: 'comfort', purpose: 'Размещённый лунный декор повышает комфорт города и открывает награды за его развитие.', countHint: 'Сохраняется наибольший достигнутый комфорт: удаление декора не отнимает прогресс. Оформление из магазина очков комфорта не даёт.' },
  qualified_referrals: { stat: 'qualified_referrals', destination: 'friends', label: 'К приглашению друзей', icon: 'network', purpose: 'Приглашай друзей по своей ссылке: развитие их колоний приносит реферальные награды.', countHint: 'Друг засчитывается, когда улучшит центр своей колонии до уровня 3. Одного перехода по ссылке недостаточно.' },
};

const SESSION: ProgressGoal = { stat: null, destination: 'city', label: 'В колонию', icon: 'city', purpose: 'Регулярно проверяй колонию: забирай готовые результаты и выбирай следующий шаг развития.', countHint: 'Засчитывается первый вход в игровой день по времени сервера. Если вход не появился в прогрессе, обнови колонию.' };

const EVENT_STATS: Record<string, string> = {
  build_started: 'buildings_started', foundry_started: 'foundry_jobs_started', contract_completed: 'contracts_completed',
  qualified_referral: 'qualified_referrals', market_trade_bought: 'market_trades_bought', market_trade_sold: 'market_trades_sold',
  research_completed: 'research_completed', expedition_started: 'expeditions_started', expedition_completed: 'expeditions_completed',
  artifact_found: 'artifacts_found', unique_artifact_found: 'unique_artifacts_found',
};

/** Only known events navigate: a new or malformed event must not suggest an unrelated action. */
export function progressGoalForEvent(event?: string): ProgressGoal | null {
  if (event === 'daily_session') return SESSION;
  if (event === 'market_order_created') return { stat: null, destination: 'market', label: 'К рынку игроков', icon: 'market', purpose: 'Выставляй излишки ресурсов на продажу другим игрокам.', countHint: 'Засчитывается успешное создание заявки. Это ещё не означает, что ресурсы проданы.' };
  return event && Object.hasOwn(EVENT_STATS, event) ? progressGoalForStat(EVENT_STATS[event]) : null;
}

export function progressGoalForStat(stat?: string): ProgressGoal | null {
  return stat && Object.hasOwn(GOALS, stat) ? GOALS[stat] : null;
}

type AchievementGoalRow = { key: string; title: string; stat: string; target: number; progress: number; status?: { claimed_at?: unknown } | null };

/** Nearest still-unfinished milestone in the same mechanic; ready rewards require a separate claim. */
export function nearestAchievement<T extends AchievementGoalRow>(rows: readonly T[], stat: string): T | null {
  if (!progressGoalForStat(stat)) return null;
  let nearest: T | null = null;
  for (const row of rows) {
    if (row.stat !== stat || row.status || !Number.isFinite(row.target) || row.target <= 0 || !Number.isFinite(row.progress) || row.progress < 0 || row.progress >= row.target) continue;
    if (!nearest || row.progress / row.target > nearest.progress / nearest.target) nearest = row;
  }
  return nearest;
}
