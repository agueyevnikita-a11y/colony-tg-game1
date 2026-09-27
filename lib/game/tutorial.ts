export type TutorialStep = {
  key: string;
  title: string;
  description: string;
  actionTab: 'city' | 'build' | 'missions';
  reward: { ore?: number; energy?: number; parts?: number; credits?: number; crystals?: number; cosmeticId?: string };
};

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    key: 'welcome',
    title: 'Командование принято',
    description: 'Забери стартовый резерв и осмотрись в колонии.',
    actionTab: 'city',
    reward: { credits: 100, ore: 50 },
  },
  {
    key: 'build_foundry',
    title: 'Собственная металлургия',
    description: 'Построй литейный цех. Он превращает руду и энергию в детали.',
    actionTab: 'build',
    reward: { energy: 60, credits: 100 },
  },
  {
    key: 'first_smelt',
    title: 'Первая плавка',
    description: 'Запусти хотя бы одну плавку в литейном цехе.',
    actionTab: 'build',
    reward: { parts: 15, credits: 100 },
  },
  {
    key: 'build_trade_hub',
    title: 'Выход на рынок',
    description: 'Построй торговый узел, чтобы открыть контракты и P2P-биржу.',
    actionTab: 'build',
    reward: { credits: 200 },
  },
  {
    key: 'first_contract',
    title: 'Первый контракт',
    description: 'Выполни один NPC-контракт и получи первую торговую прибыль.',
    actionTab: 'city',
    reward: { ore: 350, parts: 20, crystals: 8, credits: 250 },
  },
  {
    key: 'hq2',
    title: 'Колония растёт',
    description: 'Улучши Центр управления до HQ2 и открой научное развитие.',
    actionTab: 'build',
    reward: { crystals: 20, cosmeticId: 'title_cadet' },
  },
];
