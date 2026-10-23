'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { BUILDINGS } from '@/lib/game/config';
import { durationText } from '@/lib/game/format';
import type { ResearchConfig } from '@/lib/game/research';
import { buildResearchPlan } from '@/lib/game/research-plan';
import { TUTORIAL_STEPS } from '@/lib/game/tutorial';
import { goalBudget, type GoalCost } from '@/lib/game/goal-budget';
import type { SupplyProjectState } from '@/lib/game/supply-projects';
import '@/app/onboarding.css';
import '@/app/colony-guide.css';

type Props = {
  tutorial: any;
  buildings: any[];
  busy: boolean;
  onAction: (action: string) => void;
  onClaim: () => Promise<void>;
  onRefresh: () => void;
  onHelp?: () => void;
  research?: {
    catalog: ResearchConfig[];
    completed: string[];
    active: { research_key: string; completes_at: string } | null;
    labLevel: number;
    labStatus: string;
  };
  plannedResearchKey?: string | null;
  focus?: 'research' | 'supplies';
  onFocusChange?: (focus: 'research' | 'supplies') => void;
  development?: {
    resources: Record<string, unknown>; caps?: Record<string, unknown>; escrow?: Record<string, unknown>;
    jobs?: readonly { building_id: string; parts_reward: unknown }[];
    supplyGoal?: SupplyProjectState | null; supplyUnlocked?: boolean;
  };
};

function Amounts({ value }: { value: GoalCost }) {
  return <>{Object.entries(value).map(([resource, value]) => <GameAmount key={resource} resource={resource}>{Number(value).toLocaleString('ru-RU')}</GameAmount>)}</>;
}
function GoalNeeds({ budget, partial, onAction }: { budget: ReturnType<typeof goalBudget>; partial?: boolean; onAction: (action: string) => void }) {
  const missing = Object.keys(budget.missing).length > 0;
  return <div className="colonyGoalBudget">
    <div><span>{partial ? 'Осталось доставить' : 'Стоимость ближайшего шага'}</span><strong><Amounts value={budget.cost} /></strong></div>
    {missing ? <div className="colonyGoalMissing"><span>{partial ? 'Ещё накопить или произвести' : 'Не хватает'}</span><strong><Amounts value={budget.missing} /></strong></div> : <p>Ресурсов хватает. Остальные требования проверь в карточке действия.</p>}
    {missing && <details className="colonyGoalResources"><summary>Где взять ресурсы<GameIcon name="arrow" size={14} /></summary>
    {(budget.missing.parts ?? 0) > 0 && <div className="colonyGoalProduction">
      {budget.queuedParts > 0 && <p>В оплаченных очередях: <GameAmount resource="parts">{budget.queuedParts.toLocaleString('ru-RU')}</GameAmount>. Это будущие детали; выдача требует свободного места.</p>}
      <p>{budget.partsToProduce > 0 ? <>Дополнительно произвести: <GameAmount resource="parts">{budget.partsToProduce.toLocaleString('ru-RU')}</GameAmount>.</> : 'Оплаченные циклы покрывают нехватку деталей. Новую партию для этой цели запускать не нужно.'}</p>
      <button type="button" className="miniButton" onClick={() => onAction('production')}>{budget.partsToProduce > 0 ? 'Рассчитать производство' : 'Проверить оплаченные циклы'}<GameIcon name="arrow" size={14} /></button>
    </div>}
    {Object.keys(budget.capacityMissing).length > 0 && <p className="colonyGoalStorage">С учётом резерва продаж на складе не помещается ещё <Amounts value={budget.capacityMissing} />. Проверь склад или свои ордера перед накоплением.</p>}
    {(budget.missing.credits ?? 0) > 0 && <button type="button" className="miniButton" onClick={() => onAction('contracts')}>Кредиты за контракты<GameIcon name="arrow" size={14} /></button>}
    {(budget.missing.ore ?? 0) > 0 || (budget.missing.energy ?? 0) > 0 ? <p>Руда и энергия поступают от работающих добывающих зданий. Если сырья не хватает, развивай добычу; ускорение цеха само по себе сырья не добавит.</p> : null}
    {(budget.missing.science ?? 0) > 0 && <p>Наука производится исследовательскими центрами. Проекты снабжения и экспедиции дают дополнительную науку по своим условиям.</p>}
    </details>}
  </div>;
}

const FALLBACKS: Record<string, { action: string; label: string; why: string; hint: string; building?: string }> = {
  welcome: { action: 'city', label: 'Показать город', why: 'Стартовый резерв поможет запустить первое производство.', hint: 'Забери резерв, затем выберем место для литейного цеха.' },
  build_foundry: { action: 'build_foundry', label: 'Показать литейный цех', why: 'Детали нужны для улучшения базы. Цех превращает в них руду и энергию.', hint: 'Выбери свободную клетку, сравни связи с соседями и нажми «Построить здесь».', building: 'foundry' },
  first_smelt: { action: 'production', label: 'Показать производство', why: 'Первая партия деталей откроет путь к улучшениям и новым зданиям.', hint: 'В панели производства выбери цех и запусти один цикл плавки.', building: 'foundry' },
  build_trade_hub: { action: 'build_trade_hub', label: 'Показать торговый узел', why: 'Торговля превращает лишние ресурсы в кредиты для развития.', hint: 'Выбери место для торгового узла на карте.', building: 'trade_hub' },
  first_contract: { action: 'contracts', label: 'Показать контракты', why: 'Контракты дают колонии первые доходы от продажи ресурсов.', hint: 'Выбери доступный NPC-контракт и обменяй указанные ресурсы на кредиты.', building: 'trade_hub' },
  hq2: { action: 'upgrade_hq', label: 'Показать улучшение центра', why: 'Следующий уровень центра колонии открывает исследовательский центр и технологии.', hint: 'Открой центр колонии на карте и начни улучшение.', building: 'hq' },
};

function text(value: unknown, fallback: string) { return typeof value === 'string' && value.trim() ? value : fallback; }
function remainingTime(endsAt: unknown, now: number) {
  const end = new Date(String(endsAt ?? '')).getTime();
  if (!Number.isFinite(end)) return 'Проверь готовность, чтобы обновить город.';
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  if (!seconds) return 'Время вышло. Проверь готовность здания.';
  return `Осталось ${durationText(seconds)}`;
}
export function ColonyGuide({ tutorial, buildings, busy, onAction, onClaim, onRefresh, onHelp, research, plannedResearchKey, focus = 'research', onFocusChange, development }: Props) {
  const id = useId();
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const submitGuard = useRef(false);
  const rawTotal = Number(tutorial?.total);
  const total = Number.isFinite(rawTotal) && rawTotal >= 1 ? Math.floor(rawTotal) : TUTORIAL_STEPS.length;
  const rawStep = Number(tutorial?.step);
  const step = Number.isFinite(rawStep) ? Math.max(0, Math.min(total, Math.floor(rawStep))) : 0;
  const completed = !!tutorial?.completed || step >= total;
  const current = tutorial?.current ?? TUTORIAL_STEPS[step] ?? null;
  const fallback = FALLBACKS[current?.key] ?? { action: 'city', label: 'Показать следующий шаг', why: 'Развивай производство и открывай новые возможности колонии.', hint: 'Следуй подсказке и возвращайся за наградой.' };
  const activeBuilding = fallback.building && buildings.some((building) => building.type === fallback.building && building.status === 'active' && Number(building.level) >= (fallback.building === 'hq' ? 2 : 1));
  const pending = !completed && !activeBuilding && fallback.building ? buildings.find((building) => building.type === fallback.building && ['building', 'upgrading'].includes(building.status)) : null;
  const canClaim = !completed && !!tutorial?.current?.conditionMet;
  const locked = busy || submitting;
  const hq = buildings.find((building) => building.type === 'hq');
  const hqLevel = Number(hq?.level ?? 1);
  const labs = buildings.filter((building) => building.type === 'research_lab').sort((a, b) => Number(b.level) - Number(a.level));
  const lab = labs.find((building) => building.status === 'active') ?? labs[0];
  const labStatus = research?.labStatus ?? lab?.status ?? 'missing';
  const labLevel = Number(research?.labLevel ?? (lab?.status === 'active' ? lab.level : 0));
  const currentResearch = research?.active;
  const labPending = completed && (labStatus === 'building' || labStatus === 'upgrading') ? lab : null;
  const logistics = buildings.find(building => building.type === 'logistics' && building.status === 'active') ?? buildings.find(building => building.type === 'logistics');
  const expeditionCenter = buildings.find(building => building.type === 'expedition_center' && building.status === 'active') ?? buildings.find(building => building.type === 'expedition_center');
  const otherBuildingPending = ['building', 'upgrading'].includes(logistics?.status ?? '') || ['building', 'upgrading'].includes(expeditionCenter?.status ?? '');

  useEffect(() => {
    if (!pending && !(completed && (currentResearch || labPending || hq?.status === 'upgrading' || otherBuildingPending))) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending?.id, pending?.completes_at, completed, currentResearch?.research_key, currentResearch?.completes_at, labPending?.id, labPending?.completes_at, hq?.status, hq?.completes_at, otherBuildingPending, logistics?.id, logistics?.completes_at, expeditionCenter?.id, expeditionCenter?.completes_at]);

  useEffect(() => { setFeedback((previous) => previous?.error ? null : previous); }, [step]);

  async function claim() {
    if (locked || submitGuard.current || !canClaim) return;
    submitGuard.current = true;
    setSubmitting(true);
    setFeedback(null);
    try {
      await onClaim();
      setFeedback({ text: 'Награда получена. Можно двигаться дальше.', error: false });
    } catch (cause) {
      setFeedback({ text: cause instanceof Error ? cause.message : 'Не удалось получить награду. Попробуй ещё раз.', error: true });
    } finally {
      submitGuard.current = false;
      setSubmitting(false);
    }
  }

  if (!tutorial) return null;

  const catalog = Array.isArray(research?.catalog) ? research.catalog : [];
  const completedKeys = Array.isArray(research?.completed) ? research.completed : [];
  const completedSet = new Set(completedKeys);
  const activeTechnology = catalog.find((item) => item.key === currentResearch?.research_key);
  const suggestedKey = ['basic_theory', 'expedition_protocols', 'deep_navigation', 'thermal_recovery', 'extraction_ai', 'deep_drilling']
    .find(key => catalog.some(item => item.key === key) && !completedSet.has(key))
    ?? catalog.find(item => !completedSet.has(item.key))?.key;
  const targetKey = plannedResearchKey ?? suggestedKey;
  const plan = targetKey && !completedSet.has(targetKey)
    ? buildResearchPlan(targetKey, catalog, completedKeys, currentResearch?.research_key) : null;
  const allResearched = catalog.length > 0 && catalog.every((item) => completedSet.has(item.key));
  let nextEyebrow = 'Следующая цель';
  let nextAction = 'research';
  let nextLabel = 'Показать исследования';
  let nextTitle = 'Выбери направление развития';
  let nextWhy = 'Исследования усиливают добычу и открывают новые здания и рецепты плавки.';
  let nextHint = plannedResearchKey && completedSet.has(plannedResearchKey)
    ? 'Выбранная цель уже изучена. Выбери следующую технологию в исследованиях.'
    : 'Посмотри ветки исследований и выбери, что сейчас полезнее твоей колонии.';
  let nextRefresh = false;
  const nextWaiting: { title: string; endsAt: unknown; kind: 'building' | 'research' }[] = [];

  if (hqLevel < BUILDINGS.research_lab.unlockHq) {
    nextTitle = 'Открой научное развитие';
    nextWhy = `База уровня ${BUILDINGS.research_lab.unlockHq} открывает исследовательский центр и первые технологии.`;
    nextAction = 'upgrade_hq';
    nextLabel = 'Показать центр колонии';
    nextHint = 'Сверь стоимость улучшения с запасами колонии.';
    if (hq?.status === 'upgrading') {
      nextHint = 'Улучшение уже запущено. После завершения можно будет построить исследовательский центр.';
      nextWaiting.push({ title: 'Центр колонии улучшается', endsAt: hq.completes_at, kind: 'building' });
    }
  } else if (currentResearch) {
    const ready = new Date(currentResearch.completes_at).getTime() <= now;
    nextRefresh = ready;
    nextEyebrow = ready ? 'Готово к проверке' : 'Сейчас исследуется';
    nextTitle = activeTechnology?.name ?? 'Исследование колонии';
    nextWhy = activeTechnology?.effectText ?? 'После завершения обнови колонию, чтобы увидеть результат.';
    nextHint = labPending ? `Центр ${labPending.status === 'building' ? 'строится' : 'улучшается'}, а запущенное исследование продолжает выполняться.` : 'Технология выполняется и при закрытой игре.';
    nextAction = activeTechnology ? `research:${activeTechnology.key}` : 'research';
    nextLabel = ready ? 'Обновить результат' : 'К исследованию';
    nextWaiting.push({ title: 'Готовность технологии', endsAt: currentResearch.completes_at, kind: 'research' });
    if (labPending) nextWaiting.push({ title: labPending.status === 'upgrading' ? 'Центр улучшается' : 'Центр строится', endsAt: labPending.completes_at, kind: 'building' });
  } else if (allResearched) {
    const project = development?.supplyGoal;
    nextTitle = project && !project.completed ? 'Снабжай колонию' : 'Развивай город и производство';
    nextWhy = project && !project.completed ? project.description : 'Все технологии изучены. Улучшай здания, сравнивай рецепты и налаживай выпуск деталей.';
    nextHint = project && !project.completed ? 'В цели «Снабжение» видны оставшиеся ресурсы, оплаченные циклы и награда этапа.' : 'Проверь, хватает ли добычи и места на складе для следующей партии.';
    nextAction = project && !project.completed ? 'supplies' : 'production';
    nextLabel = project && !project.completed ? 'К проекту' : 'Показать производство';
  } else if (labStatus === 'missing' || (!lab && !research)) {
    nextTitle = 'Построй исследовательский центр';
    nextWhy = 'Центр производит науку. Технологии помогут получать больше ресурсов с каждой клетки и развивать производство.';
    nextHint = 'Выбери свободную клетку в городе для нового центра.';
    nextAction = 'build_lab';
    nextLabel = 'Выбрать место';
  } else if (labStatus === 'building' || labStatus === 'upgrading') {
    nextEyebrow = 'Научное развитие';
    nextTitle = labStatus === 'building' ? 'Исследовательский центр строится' : 'Исследовательский центр улучшается';
    nextWhy = labStatus === 'building' ? 'После готовности центр начнёт производить науку и откроет исследования.' : 'После улучшения станут доступны технологии, которым нужен новый уровень центра.';
    nextHint = 'Пока идут работы, можно выбрать следующую цель и посмотреть её требования.';
    if (lab) nextWaiting.push({ title: labStatus === 'building' ? 'Строительство идёт…' : 'Улучшение идёт…', endsAt: lab.completes_at, kind: 'building' });
    if (plan?.next) nextAction = `research:${plan.next.key}`;
  } else if (plannedResearchKey && completedSet.has(plannedResearchKey)) {
    const target = catalog.find(item => item.key === plannedResearchKey);
    nextEyebrow = 'Цель достигнута';
    nextTitle = target?.name ?? 'Технология открыта';
    nextWhy = target?.effectText ?? 'Бонус технологии уже действует в колонии.';
    nextHint = target?.unlockBuilding ? 'Открой карточку технологии, чтобы выбрать постройку нового здания.' : target?.unlockRecipe ? 'Открой карточку технологии и перейди к новому рецепту плавки.' : target?.unlockFeature ? 'Открой карточку технологии и перейди к новой возможности колонии.' : 'Можно выбрать новую цель в плане развития.';
    nextAction = `research:${plannedResearchKey}`;
    nextLabel = target?.unlockBuilding || target?.unlockRecipe || target?.unlockFeature ? 'Использовать технологию' : 'Сменить цель';
  } else if (!plannedResearchKey && completedSet.has('basic_theory') && hqLevel >= 3 && development?.supplyGoal && logistics?.status !== 'active') {
    nextTitle = logistics ? 'Логистика готовится к работе' : 'Дай производству долгосрочную цель';
    nextWhy = 'Логистический центр открывает проекты: поставляй произведённые ресурсы и получай кредиты, науку и титулы по этапам.';
    nextHint = logistics ? 'Поставки начнутся после завершения работ. Уже принятые поставки сохраняются.' : 'Это один из вариантов развития. Другую цель можно выбрать в исследованиях.';
    nextAction = logistics ? 'supplies' : 'build_logistics';
    nextLabel = logistics ? 'Проверить логистику' : 'К логистическому центру';
    if (logistics) nextWaiting.push({ title: 'Логистический центр', endsAt: logistics.completes_at, kind: 'building' });
  } else if (!plannedResearchKey && completedSet.has('basic_theory') && development?.supplyGoal && !development.supplyGoal.completed && logistics?.status === 'active') {
    nextTitle = 'Выпусти ресурсы для проекта';
    nextWhy = development.supplyGoal.description;
    nextHint = 'Выбери «Снабжение» выше: увидишь, сколько ещё доставить и какая часть деталей уже оплачена в очередях.';
    nextAction = 'supplies'; nextLabel = 'Выбрать этап';
  } else if (!plannedResearchKey && completedSet.has('expedition_protocols') && expeditionCenter?.status !== 'active') {
    nextTitle = expeditionCenter ? 'Центр экспедиций готовится' : 'Используй экспедиционные протоколы';
    nextWhy = 'Работающий центр позволяет отправлять аппараты за ресурсами, наукой и артефактами. Открытая технология сама не строит здание.';
    nextHint = 'Сначала проверь строительство центра, затем выбери маршрут. Запуск экспедиции оплачивается отдельно.';
    nextAction = expeditionCenter ? 'expeditions' : 'build_expedition_center'; nextLabel = expeditionCenter ? 'К экспедициям' : 'К центру экспедиций';
    if (expeditionCenter) nextWaiting.push({ title: 'Центр экспедиций', endsAt: expeditionCenter.completes_at, kind: 'building' });
  } else if (plan?.next) {
    nextEyebrow = plannedResearchKey ? 'План развития' : 'Вариант развития';
    nextTitle = `Следующая цель: ${plan.target.name}`;
    nextWhy = plan.target.effectText;
    nextHint = hqLevel < plan.next.unlockHq ? `Следующий шаг — «${plan.next.name}». Для него нужна база уровня ${plan.next.unlockHq}.`
      : labLevel < plan.next.labLevel ? `Следующий шаг — «${plan.next.name}». Нужен исследовательский центр уровня ${plan.next.labLevel}.`
      : plan.next.key === plan.target.key ? 'Предыдущие технологии изучены. Посмотри стоимость и запусти исследование, когда хватит ресурсов.'
      : `Сначала изучи «${plan.next.name}». Это следующий шаг на пути к выбранной цели.`;
    nextAction = `research:${plan.next.key}`;
    nextLabel = 'К следующему шагу';
    if (hqLevel < plan.next.unlockHq) {
      nextTitle = `Улучши базу до уровня ${plan.next.unlockHq}`;
      nextAction = 'upgrade_hq';
      nextLabel = 'К улучшению базы';
      if (hq?.status === 'upgrading') nextWaiting.push({ title: 'Центр колонии улучшается', endsAt: hq.completes_at, kind: 'building' });
    } else if (labLevel < plan.next.labLevel) {
      nextTitle = `Улучши исследовательский центр до уровня ${plan.next.labLevel}`;
      nextAction = 'upgrade_lab';
      nextLabel = 'К улучшению центра';
    }
  } else if (!plannedResearchKey && labStatus === 'active' && !completedSet.has('basic_theory')) {
    const foundation = catalog.find((item) => item.key === 'basic_theory');
    if (foundation) {
      nextTitle = `Изучи «${foundation.name}»`;
      nextWhy = `${foundation.effectText}. Эта технология открывает путь к остальным исследованиям.`;
      nextHint = 'Открой карточку первой технологии: там указаны стоимость и время. Наука копится в исследовательском центре.';
      nextAction = 'research:basic_theory';
      nextLabel = 'К первой технологии';
    }
  }

  if (completed) {
    const supplyGoal = development?.supplyGoal;
    const focusControl = supplyGoal && onFocusChange && <div className="colonyGoalFocus" role="group" aria-label="Цель развития колонии">
      <button type="button" aria-pressed={focus === 'research'} onClick={() => onFocusChange('research')}><GameIcon name="research" size={16} />Развитие</button>
      <button type="button" aria-pressed={focus === 'supplies'} onClick={() => onFocusChange('supplies')}><GameIcon name="contracts" size={16} />Снабжение</button>
    </div>;
    if (focus === 'supplies' && supplyGoal && development) {
      const stage = supplyGoal.completed ? null : supplyGoal.stages[supplyGoal.stageIndex];
      const budget = goalBudget({ cost: supplyGoal.remaining, ...development, buildings, partialDelivery: true });
      const preparingParts = !budget.deliverable && (budget.missing.parts ?? 0) > 0 && development.supplyUnlocked !== false;
      return <section className="card colonyGuide colonyGuideComplete colonyNextStep" aria-labelledby={`${id}-title`}>
        {focusControl}
        <div className="colonyNextStepMain"><div className="colonyNextStepHeading"><span className="onboardingEyebrow">{supplyGoal.name} · {supplyGoal.completed ? 'Завершён' : `Этап ${supplyGoal.stageIndex + 1}/${supplyGoal.stages.length}`}</span><h2 id={`${id}-title`}>{supplyGoal.completed ? 'Выбери следующую цель колонии' : supplyGoal.ready ? 'Награда этапа готова' : stage?.name ?? 'Продолжи проект снабжения'}</h2></div>
          <button type="button" className="action secondary colonyNextStepAction" disabled={locked} onClick={() => onAction(preparingParts && !supplyGoal.ready && !supplyGoal.completed ? 'production' : 'supplies')}>{supplyGoal.completed ? 'Выбрать проект' : supplyGoal.ready ? 'К награде этапа' : preparingParts ? 'К производству' : 'К поставке'}<GameIcon name="arrow" size={16} /></button>
        </div>
        <p className="colonyNextStepWhy">{supplyGoal.completed ? 'Все этапы этого проекта закрыты. Можно выбрать другой проект или вернуться к технологиям.' : supplyGoal.description}</p>
        {stage && <div className="colonyGoalReward"><span>Награда этапа</span><strong>{(['credits', 'science', 'crystals'] as const).filter(resource => stage.reward[resource] > 0).map(resource => <GameAmount key={resource} resource={resource}>{stage.reward[resource].toLocaleString('ru-RU')}</GameAmount>)}{stage.reward.cosmeticIds.length > 0 && <span><GameIcon name="trophy" size={14} />Памятный титул</span>}</strong></div>}
        {!supplyGoal.completed && !supplyGoal.ready && <><GoalNeeds budget={budget} partial onAction={onAction} /><p className="colonyGoalHint">Поставки принимаются частями; доставленное сохранится без срока.</p>{development.supplyUnlocked === false && <p className="colonyGoalStorage">Новые поставки ждут работающий логистический центр и центр колонии ур. 3. Уже готовая награда доступна в проекте.</p>}</>}
      </section>;
    }
    const waiting = nextWaiting[0];
    const waitingReady = waiting && new Date(String(waiting.endsAt)).getTime() <= now;
    const refreshAction = nextRefresh || (waiting?.kind === 'building' && waitingReady);
    const actionLabel = !nextRefresh && refreshAction ? 'Проверить готовность' : nextLabel;
    let nextCost: GoalCost | null = null;
    if (!waiting) {
      if (nextAction === 'build_lab') nextCost = BUILDINGS.research_lab.baseBuildCost;
      else if (nextAction === 'build_logistics') nextCost = BUILDINGS.logistics.baseBuildCost;
      else if (nextAction === 'build_expedition_center') nextCost = BUILDINGS.expedition_center.baseBuildCost;
      else if (nextAction === 'upgrade_hq' && hq?.status === 'active') nextCost = hq.nextUpgrade?.cost ?? null;
      else if (nextAction === 'upgrade_lab' && lab?.status === 'active') nextCost = lab.nextUpgrade?.cost ?? null;
      else if (nextAction.startsWith('research:')) {
        const next = catalog.find(item => item.key === nextAction.slice('research:'.length));
        if (next && !completedSet.has(next.key)) nextCost = { science: next.science, ...next.cost };
      }
    }
    return <section className="card colonyGuide colonyGuideComplete colonyNextStep" aria-labelledby={`${id}-title`}>
      {focusControl}
      <div className="colonyNextStepMain">
        <div className="colonyNextStepHeading"><span className="onboardingEyebrow">{nextEyebrow}</span><h2 id={`${id}-title`}>{nextTitle}</h2>
          {waiting && <span className="colonyNextStepTimer" role="timer" aria-live="off" aria-label={`${waiting.title}: ${waitingReady ? 'Готово к проверке' : remainingTime(waiting.endsAt, now)}`}><GameIcon name={waiting.kind === 'research' ? 'research' : 'clock'} size={14} />{waitingReady ? 'Готово к проверке' : remainingTime(waiting.endsAt, now)}</span>}
        </div>
        <button className="action secondary colonyNextStepAction" type="button" disabled={locked} onClick={refreshAction ? onRefresh : () => onAction(nextAction)}>{actionLabel}<GameIcon name={refreshAction ? 'refresh' : 'arrow'} size={16} /></button>
      </div>
      <p className="colonyNextStepWhy">{nextWhy}</p>
      {nextCost && development && <GoalNeeds budget={goalBudget({ cost: nextCost, ...development, buildings })} onAction={onAction} />}
      <details className="colonyNextStepDetails"><summary>План действий</summary><p className="colonyGuideHint">{nextHint}</p>
        {nextWaiting.slice(1).map((item, index) => <p className="colonyNextStepExtraTimer" key={`${item.kind}-${index}`}><GameIcon name="clock" size={14} />{item.title}: {remainingTime(item.endsAt, now)}</p>)}
      </details>
    </section>;
  }
  const rewards = Object.entries(current?.reward ?? {}).filter(([resource, amount]) => resource !== 'cosmeticId' && typeof amount === 'number' && amount > 0);
  const labels: Record<string, string> = { ore: 'руды', energy: 'энергии', parts: 'деталей', credits: 'кредитов', crystals: 'кристаллов', science: 'науки' };

  return <section className="card colonyGuide" aria-labelledby={`${id}-title`} aria-busy={submitting}>
    <div className="colonyGuideTop"><span className="onboardingEyebrow">Первые шаги</span><div><span className="colonyGuideCount" aria-label={`Шаг ${step + 1} из ${total}`}>{step + 1} / {total}</span>{onHelp && <button className="colonyGuideHelp" type="button" onClick={onHelp} aria-label="Как играть в COLONY"><GameIcon name="help" size={20} /></button>}</div></div>
    <h2 id={`${id}-title`}>{text(current?.title, 'Развивай колонию')}</h2>
    <p className="colonyGuideWhy">{text(current?.why, fallback.why)}</p>
    {!canClaim && <p className="colonyGuideHint">{text(current?.hint, FALLBACKS[current?.key]?.hint ?? text(current?.description, fallback.hint))}</p>}
    {pending && !canClaim && <div className="colonyGuidePending"><GameIcon name="clock" size={19} /><div><strong>{pending.status === 'upgrading' ? 'Улучшение идёт…' : 'Строительство идёт…'}</strong><span role="timer" aria-live="off">{remainingTime(pending.completes_at, now)}</span></div><button className="miniButton" type="button" disabled={locked} onClick={onRefresh}>Проверить</button></div>}
    <div className="colonyGuideRewards"><span>{canClaim ? 'Готово. Твоя награда:' : 'Награда за шаг:'}</span><div>{rewards.map(([resource, amount]) => <span key={resource} title={labels[resource] ?? resource} aria-label={`${amount} ${labels[resource] ?? resource}`}><GameIcon name={resource} size={15} />{Number(amount).toLocaleString('ru-RU')}</span>)}{current?.reward?.cosmeticId && <span><GameIcon name="star" size={15} />Предмет оформления</span>}</div></div>
    <div className="colonyGuideActions">
      {canClaim ? <button className="action colonyGuideClaim" type="button" disabled={locked} onClick={() => void claim()}>{submitting ? 'Получаем награду…' : step === 0 ? 'Начать развитие' : 'Забрать награду и продолжить'}<GameIcon name={step === 0 ? 'arrow' : 'check'} size={18} /></button>
          : <button className="action secondary" type="button" disabled={locked} onClick={() => onAction(pending ? 'city' : text(current?.action, fallback.action))}>{pending ? 'Показать на карте' : text(current?.actionLabel, fallback.label)}<GameIcon name="arrow" size={17} /></button>}
    </div>
    {feedback && <div className={`notice onboardingFeedback${feedback.error ? ' error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</div>}
  </section>;
}
