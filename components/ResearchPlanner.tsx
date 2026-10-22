'use client';

import { useEffect, useId, useState } from 'react';
import { BuildingArt } from '@/components/BuildingArt';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import type { ResearchConfig } from '@/lib/game/research';
import { buildResearchPlan, researchBlocker } from '@/lib/game/research-plan';
import '@/app/research-plan.css';

type Props = {
  catalog: ResearchConfig[];
  completed: string[];
  active: { research_key: string; completes_at: string } | null;
  targetKey: string | null;
  onTargetChange: (key: string | null) => void;
  hqLevel: number;
  labLevel: number;
  labStatus: string;
  resources: Record<string, unknown>;
  scienceRate: number;
  busy: boolean;
  onResearch: (key: string) => void;
  onUpgradeHq: () => void;
  onBuildLab: () => void;
  onUpgradeLab: () => void;
  onProduction: () => void;
  onRefresh: () => void;
};

const GOAL_GROUPS = [
  { key: 'resources', name: 'Добыча', icon: 'ore' },
  { key: 'production', name: 'Производство', icon: 'parts' },
  { key: 'infrastructure', name: 'Город и связи', icon: 'city' },
  { key: 'exploration', name: 'Экспедиции', icon: 'rocket' },
] as const;
type GoalGroup = typeof GOAL_GROUPS[number]['key'];
const GOALS = [
  { key: 'deep_drilling', name: 'Глубинная шахта', building: 'deep_mine', group: 'resources' },
  { key: 'photovoltaic_arrays', name: 'Солнечный массив', building: 'solar_array', group: 'resources' },
  { key: 'precision_casting', name: 'Точное литьё', icon: 'parts', group: 'production' },
  { key: 'industrial_casting', name: 'Поточное литьё', icon: 'parts', group: 'production' },
  { key: 'compact_storage', name: 'Больше места на складе', icon: 'building', group: 'production' },
  { key: 'trade_network', name: 'Рынок игроков', icon: 'market', group: 'infrastructure' },
  { key: 'urban_ecology', name: 'Гидропонный модуль', icon: 'flowerbed', group: 'infrastructure' },
  { key: 'public_spaces', name: 'Комфорт лунной базы', icon: 'comfort', group: 'infrastructure' },
  { key: 'expedition_protocols', name: 'Первые экспедиции', building: 'expedition_center', group: 'exploration' },
  { key: 'autonomous_drones', name: 'Больше экспедиций', icon: 'rocket', group: 'exploration' },
  { key: 'deep_space_protocol', name: 'Дальний сигнал', icon: 'signal', group: 'exploration' },
] as const;

function number(value: number) { return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }
function duration(seconds: number) {
  const minutes = Math.max(1, Math.ceil(Math.max(0, seconds) / 60));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} ч.${minutes % 60 ? ` ${minutes % 60} мин.` : ''}` : `${minutes} мин.`;
}
function iconFor(item: ResearchConfig) {
  if (item.branch === 'infrastructure') return item.key === 'trade_network' ? 'market' : 'comfort';
  if (item.branch === 'exploration') return 'rocket';
  if (item.branch === 'production') return 'parts';
  if (item.branch === 'resources') return item.key === 'solar_lattice' || item.key === 'photovoltaic_arrays' ? 'energy' : 'ore';
  return 'research';
}
function costEntries(cost: Record<string, number>) {
  return Object.entries(cost).filter(([, amount]) => Number(amount) > 0);
}

export function ResearchPlanner(props: Props) {
  const id = useId();
  const [now, setNow] = useState(() => Date.now());
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [goalGroup, setGoalGroup] = useState<GoalGroup>('resources');
  const completed = new Set(props.completed);
  const plan = props.targetKey ? buildResearchPlan(props.targetKey, props.catalog, props.completed, props.active?.research_key) : null;
  const next = plan?.next ?? null;
  const blocker = next ? researchBlocker(next, {
    hqLevel: props.hqLevel, labLevel: props.labLevel, labStatus: props.labStatus,
    activeKey: props.active?.research_key, completed: props.completed, resources: props.resources,
  }) : null;
  const activeEndsAt = props.active ? new Date(props.active.completes_at).getTime() : 0;
  const activeReady = !!props.active && Number.isFinite(activeEndsAt) && activeEndsAt <= now;
  const activeName = props.catalog.find((item) => item.key === props.active?.research_key)?.name ?? 'текущая технология';
  const goals = GOALS.filter((goal) => goal.group === goalGroup && props.catalog.some((item) => item.key === goal.key));
  const foundation = props.catalog.find((item) => item.key === 'basic_theory' && !completed.has(item.key));

  useEffect(() => {
    const target = GOALS.find((goal) => goal.key === props.targetKey);
    if (target) setGoalGroup(target.group);
  }, [props.targetKey]);

  useEffect(() => {
    if (!props.active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [props.active?.research_key, props.active?.completes_at]);

  function renderStep(item: ResearchConfig, index: number) {
    const done = completed.has(item.key);
    const active = !done && props.active?.research_key === item.key;
    const isNext = !done && !active && next?.key === item.key;
    const status = done ? 'Изучено' : active ? 'Исследуется' : isNext ? 'Следующий шаг' : 'Впереди';
    return <li key={item.key} data-plan-step={item.key} className={`researchPlanStep ${done ? 'isDone' : active ? 'isActive' : isNext ? 'isNext' : 'isLocked'}`}>
      <span className="researchPlanStepNumber" aria-hidden="true">{done ? <GameIcon name="check" size={13} /> : index + 1}</span>
      <div className="researchPlanStepContent">
        <div className="researchPlanStepTitle"><strong>{item.name}</strong><span>{status}</span></div>
        <p>{item.effectText}</p>
        {!done && !active && <small><GameIcon name="clock" size={12} /> {duration(item.timeSec)} · База ур. {item.unlockHq} · Лаборатория ур. {item.labLevel}</small>}
      </div>
      {item.unlockBuilding ? <BuildingArt type={item.unlockBuilding} className="researchPlanStepArt" />
        : <span className="researchPlanStepIcon"><GameIcon name={iconFor(item)} size={22} /></span>}
    </li>;
  }

  function renderNextAction() {
    if (!plan || !next || !blocker) return null;
    let message = '';
    let actionLabel = '';
    let action = () => props.onResearch(next.key);
    switch (blocker.kind) {
      case 'hq':
        message = `Для «${next.name}» нужна база ур. ${next.unlockHq}. Сейчас база ур. ${props.hqLevel}.`;
        actionLabel = 'Показать улучшение базы'; action = props.onUpgradeHq; break;
      case 'lab_missing':
        message = 'Построй исследовательский центр: он производит науку и позволяет запускать технологии.';
        actionLabel = 'Показать исследовательский центр'; action = props.onBuildLab; break;
      case 'lab_busy':
        message = props.labStatus === 'upgrading' ? 'Исследовательский центр улучшается. Дождись окончания работ.' : 'Исследовательский центр строится. Дождись окончания работ.';
        actionLabel = 'Проверить готовность центра'; action = props.onRefresh; break;
      case 'lab_level':
        message = `Для «${next.name}» нужен исследовательский центр уровня ${next.labLevel}. Сейчас уровень ${props.labLevel}.`;
        actionLabel = 'Показать улучшение центра'; action = props.onUpgradeLab; break;
      case 'prerequisite': {
        const prerequisite = props.catalog.find((item) => item.key === blocker.missingPrereq);
        message = `Сначала изучи «${prerequisite?.name ?? 'предыдущую технологию'}».`;
        actionLabel = 'Показать нужную технологию'; action = () => props.onResearch(blocker.missingPrereq ?? next.key); break;
      }
      case 'researching':
      case 'busy':
        message = activeReady ? `Время исследования «${activeName}» вышло. Обнови результат, чтобы применить технологию.`
          : `Сейчас исследуется «${activeName}».${Number.isFinite(activeEndsAt) && activeEndsAt > now ? ` Осталось ${duration((activeEndsAt - now) / 1000)}.` : ' Дождись завершения.'}`;
        actionLabel = activeReady ? 'Обновить результат исследования' : 'Показать текущее исследование';
        action = activeReady ? props.onRefresh : () => props.onResearch(props.active?.research_key ?? next.key); break;
      case 'resources':
        message = `Для следующего шага «${next.name}» нужно накопить ресурсы.`;
        actionLabel = 'Показать стоимость исследования'; break;
      case 'completed':
        message = 'Эта технология уже изучена. Обнови план, чтобы увидеть следующий шаг.';
        actionLabel = 'Обновить план'; action = props.onRefresh; break;
      case 'ready':
        message = `Требования к «${next.name}» выполнены. Открой карточку технологии, проверь стоимость и запусти исследование.`;
        actionLabel = 'Открыть следующее исследование'; break;
    }
    const shortages = blocker.kind === 'resources' ? blocker.shortages ?? {} : {};
    const scienceMissing = Number(shortages.science ?? 0);
    return <div className="researchPlanNext" aria-labelledby={`${id}-next`}>
      <span className="researchPlanEyebrow" id={`${id}-next`}>Ближайшее действие</span>
      <p>{message}</p>
      {costEntries(shortages).length > 0 && <div className="researchPlanShortages"><span>Не хватает:</span>{costEntries(shortages).map(([resource, amount]) => <GameAmount key={resource} resource={resource}>{number(Math.ceil(amount))}</GameAmount>)}</div>}
      {scienceMissing > 0 && props.scienceRate > 0 && <p className="researchPlanWait">При текущей выработке +{number(props.scienceRate)} науки/ч нехватка науки покроется примерно за {duration(scienceMissing / props.scienceRate * 3600)} накопления. Расчёт без будущих улучшений и расходов.</p>}
      {scienceMissing > 0 && props.scienceRate <= 0 && <p className="researchPlanWait">Наука пока не производится. Проверь готовность исследовательского центра.</p>}
      <div className="researchPlanActions"><button type="button" className="action secondary" disabled={props.busy} onClick={action}>{actionLabel}<GameIcon name="arrow" size={15} /></button>
        {Number(shortages.parts ?? 0) > 0 && <button type="button" className="miniButton" disabled={props.busy} onClick={props.onProduction}><GameIcon name="parts" size={14} /> К производству деталей</button>}
      </div>
    </div>;
  }

  return <section className="researchPlanner" data-research-target={props.targetKey ?? ''} aria-labelledby={`${id}-title`}>
    <div className="researchPlannerHeading"><div><h2 id={`${id}-title`}><GameIcon name="research" size={22} /> План развития</h2><p>{plan ? 'Следуй плану: ближайшее действие подскажет, как приблизиться к цели.' : 'Выбери цель — увидишь нужные технологии и ближайшее действие.'}</p></div>
      {props.targetKey && <div className="researchPlannerControls">
        {plan && <button type="button" className="miniButton researchPlanToggle" disabled={props.busy} aria-expanded={choicesOpen} aria-controls={`${id}-choices`} onClick={() => setChoicesOpen((open) => !open)}>Сменить цель</button>}
        <button type="button" className="miniButton researchPlanReset" disabled={props.busy} onClick={() => { setChoicesOpen(false); props.onTargetChange(null); }}>Сбросить цель</button>
      </div>}
    </div>
    <div id={`${id}-choices`} className="researchPlanChoices" hidden={!!plan && !choicesOpen}>
      {foundation && <button type="button" className="researchPlanFoundation" data-research-goal="basic_theory" disabled={props.busy} onClick={() => { props.onTargetChange('basic_theory'); setChoicesOpen(false); }}><GameIcon name="research" size={22} /><span><strong>Начни с первой технологии</strong><small>{foundation.name} · открывает путь к остальным исследованиям</small></span><GameIcon name="arrow" size={16} /></button>}
      <div className="researchPlanGroups" role="group" aria-label="Направление цели">{GOAL_GROUPS.map((group) => <button type="button" key={group.key} aria-pressed={goalGroup === group.key} disabled={props.busy} onClick={() => setGoalGroup(group.key)}><GameIcon name={group.icon} size={16} />{group.name}</button>)}</div>
      <div className="researchPlanGoals" role="group" aria-label="Цели развития">
        {goals.map((goal) => <button type="button" key={goal.key} data-research-goal={goal.key} className={`researchPlanGoal ${props.targetKey === goal.key ? 'isSelected' : ''}`} aria-pressed={props.targetKey === goal.key} disabled={props.busy} onClick={() => { props.onTargetChange(goal.key); setChoicesOpen(false); }}>
          <span className="researchPlanGoalVisual" aria-hidden="true">{'building' in goal ? <BuildingArt type={goal.building!} /> : <GameIcon name={goal.icon!} size={22} />}</span>
          <span className="researchPlanGoalLabel">{goal.name}</span>{completed.has(goal.key) && <GameIcon name="check" size={12} />}
        </button>)}
      </div>
      <p className="researchPlanSelectionHint">Выбор цели сохраняется на этом устройстве. Исследования запускаются отдельно в карточках технологий.</p>
    </div>

    {!plan ? <div className="researchPlanEmpty"><GameIcon name="arrow" size={18} /><span>{props.targetKey ? 'Эта цель недоступна в текущем дереве. Выбери другую цель.' : 'Например, глубинная шахта увеличит добычу руды с одной клетки.'}</span></div> : <>
      <div className="researchPlanTarget"><div><span className="researchPlanEyebrow">Твоя цель</span><h3>{plan.target.name}</h3><p>{plan.target.effectText}</p></div>
        {plan.target.unlockBuilding && <BuildingArt type={plan.target.unlockBuilding} />}
      </div>
      {!next ? <div className="researchPlanComplete" role="status"><strong><GameIcon name="check" size={19} /> Технология открыта</strong><p>{plan.target.unlockBuilding ? 'Теперь можно перейти к её карточке и выбрать постройку нового здания.' : plan.target.unlockRecipe ? 'Теперь можно перейти к её карточке и открыть рецепт в производстве.' : plan.target.unlockFeature ? 'Открой карточку технологии и перейди к новой возможности колонии.' : 'Бонус технологии уже действует в колонии.'}</p><button type="button" className="action secondary" disabled={props.busy} onClick={() => props.onResearch(plan.target.key)}>Показать технологию<GameIcon name="arrow" size={15} /></button></div>
        : <>
          <div className="researchPlanBudget"><span className="researchPlanEyebrow">Осталось на исследования</span><div>{costEntries(plan.remainingCost).length ? costEntries(plan.remainingCost).map(([resource, amount]) => <GameAmount key={resource} resource={resource}>{number(amount)}</GameAmount>) : <span>Все оставшиеся расходы уже оплачены.</span>}</div><p>Постройки и улучшения базы и лаборатории в сумму не входят.{plan.activeInPlan ? ' Текущее исследование уже оплачено и повторно не считается.' : ''}</p>{plan.remainingTimeSec > 0 && <p><GameIcon name="clock" size={11} /> Чистое время ещё не запущенных исследований: {duration(plan.remainingTimeSec)}. Без накопления ресурсов и улучшений.</p>}</div>
          {renderNextAction()}
        </>}
      {plan.steps.length > 3 ? <details className="researchPlanChain"><summary>Вся цепочка: изучено {plan.completedCount} из {plan.total}</summary><ol>{plan.steps.map(renderStep)}</ol></details>
        : <div className="researchPlanChain"><h3>Цепочка технологий · {plan.completedCount} / {plan.total}</h3><ol>{plan.steps.map(renderStep)}</ol></div>}
    </>}
  </section>;
}
