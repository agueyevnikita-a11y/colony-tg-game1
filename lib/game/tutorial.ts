export type TutorialAction = 'claim' | 'build_foundry' | 'production' | 'build_trade_hub' | 'contracts' | 'upgrade_hq';

export type TutorialStep = {
  key: string;
  title: string;
  description: string;
  actionTab: 'city' | 'build' | 'missions';
  action: TutorialAction;
  actionLabel: string;
  why: string;
  hint: string;
  targetBuilding?: 'foundry' | 'trade_hub' | 'hq';
  reward: { ore?: number; energy?: number; parts?: number; credits?: number; crystals?: number; cosmeticId?: string };
};

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    key: 'welcome',
    title: 'Твоя первая колония',
    description: 'Развивай город и производство: добывай руду и энергию, превращай их в детали, строй здания и открывай исследования. Торговля приносит кредиты для дальнейшего роста.',
    actionTab: 'city',
    action: 'claim',
    actionLabel: 'Забрать резерв',
    why: 'Стартовый резерв поможет построить первый литейный цех и наладить выпуск деталей.',
    hint: 'Нажми «Начать развитие». Следующий шаг поможет выбрать место для литейного цеха.',
    reward: { credits: 100, ore: 50 },
  },
  {
    key: 'build_foundry',
    title: 'Построй литейный цех',
    description: 'Литейный цех превращает руду и энергию в детали. Построй его и дождись окончания строительства.',
    actionTab: 'build',
    action: 'build_foundry',
    actionLabel: 'Выбрать место для цеха',
    targetBuilding: 'foundry',
    why: 'Детали нужны для новых построек и улучшения центра управления.',
    hint: 'Выбери свободную клетку на карте, сравни связи с шахтой и энергетикой, затем нажми «Построить здесь». Ресурсы спишутся после подтверждения.',
    reward: { energy: 60, credits: 100 },
  },
  {
    key: 'first_smelt',
    title: 'Первая плавка',
    description: 'Запусти один цикл плавки. Готовые детали поступят на склад после завершения цикла.',
    actionTab: 'city',
    action: 'production',
    actionLabel: 'Открыть производство',
    targetBuilding: 'foundry',
    why: 'Так ты получишь первые детали для развития колонии. Сравнивай расход ресурсов и время разных режимов.',
    hint: 'В «Городе» найди «Производство», выбери свой цех, оставь стандартный сплав и один цикл, затем нажми «Запустить».',
    reward: { parts: 15, credits: 100 },
  },
  {
    key: 'build_trade_hub',
    title: 'Построй торговый узел',
    description: 'Построй торговый узел и дождись его готовности. Он откроет контракты, которые обменивают ресурсы на кредиты. Рынок игроков откроется позже через исследование «Межколониальная торговля».',
    actionTab: 'build',
    action: 'build_trade_hub',
    actionLabel: 'Выбрать место для узла',
    targetBuilding: 'trade_hub',
    why: 'Торговля превращает излишки ресурсов в кредиты для новых построек.',
    hint: 'Проверь стоимость и нажми свободную клетку на карте: строительство начнётся сразу. После завершения забери награду за шаг.',
    reward: { credits: 200 },
  },
  {
    key: 'first_contract',
    title: 'Первый контракт',
    description: 'Выполни один контракт: передай указанное количество руды или деталей и получи кредиты.',
    actionTab: 'city',
    action: 'contracts',
    actionLabel: 'Открыть контракты',
    why: 'Кредиты оплачивают строительство и исследования. Сохраняй часть ресурсов для ближайшего улучшения города.',
    hint: 'В «Городе» найди контракты, сравни требуемые ресурсы с запасами и нажми «Выполнить» у подходящего заказа.',
    reward: { ore: 350, parts: 20, crystals: 8, credits: 250 },
  },
  {
    key: 'hq2',
    title: 'Открой путь к исследованиям',
    description: 'Улучши центр управления до уровня 2 и дождись окончания работ. После этого можно построить исследовательский центр.',
    actionTab: 'city',
    action: 'upgrade_hq',
    actionLabel: 'Улучшить центр управления',
    targetBuilding: 'hq',
    why: 'Исследования увеличивают добычу и вместимость склада, улучшают производство и открывают новые здания.',
    hint: 'Нажми на центр управления на карте и выбери улучшение. Проверь стоимость рядом с кнопкой и дождись уровня 2.',
    reward: { crystals: 20, cosmeticId: 'title_cadet' },
  },
];

type TutorialConditionState = { hq_level?: number | string | null };
type TutorialConditionBuilding = { type: string; level?: number | string | null; status: string };
type TutorialConditionStats = { foundry_jobs_started?: number | string | null; contracts_completed?: number | string | null };

/** Stable conditions shared by the server and tests of existing player progress. */
export function tutorialConditionMet(stepIndex: number, state: TutorialConditionState | null | undefined, buildings: readonly TutorialConditionBuilding[], stats?: TutorialConditionStats | null) {
  switch (stepIndex) {
    case 0: return true;
    case 1: return buildings.some((building) => building.type === 'foundry' && Number(building.level) >= 1 && building.status === 'active');
    case 2: return Number(stats?.foundry_jobs_started ?? 0) >= 1;
    case 3: return buildings.some((building) => building.type === 'trade_hub' && Number(building.level) >= 1 && building.status === 'active');
    case 4: return Number(stats?.contracts_completed ?? 0) >= 1;
    case 5: return Number(state?.hq_level ?? 1) >= 2;
    default: return false;
  }
}
