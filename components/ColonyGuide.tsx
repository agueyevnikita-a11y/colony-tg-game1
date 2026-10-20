'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GameIcon } from '@/components/GameIcon';
import { BUILDINGS } from '@/lib/game/config';
import type { ResearchConfig } from '@/lib/game/research';
import { buildResearchPlan } from '@/lib/game/research-plan';
import { TUTORIAL_STEPS } from '@/lib/game/tutorial';
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
};

const FALLBACKS: Record<string, { action: string; label: string; why: string; hint: string; building?: string }> = {
  welcome: { action: 'city', label: 'Показать город', why: 'Стартовый резерв поможет запустить первое производство.', hint: 'Забери резерв, затем выберем место для литейного цеха.' },
  build_foundry: { action: 'build_foundry', label: 'Показать литейный цех', why: 'Детали нужны для улучшения базы. Цех превращает в них руду и энергию.', hint: 'Выбери свободную клетку. Соседство с шахтой или электростанцией поможет экономить ресурсы.', building: 'foundry' },
  first_smelt: { action: 'production', label: 'Показать производство', why: 'Первая партия деталей откроет путь к улучшениям и новым зданиям.', hint: 'В панели производства выбери цех и запусти один цикл плавки.', building: 'foundry' },
  build_trade_hub: { action: 'build_trade_hub', label: 'Показать торговый узел', why: 'Торговля превращает лишние ресурсы в кредиты для развития.', hint: 'Выбери место для торгового узла на карте.', building: 'trade_hub' },
  first_contract: { action: 'contracts', label: 'Показать контракты', why: 'Контракты дают колонии первые доходы от продажи ресурсов.', hint: 'Выбери доступный NPC-контракт и обменяй указанные ресурсы на кредиты.', building: 'trade_hub' },
  hq2: { action: 'upgrade_hq', label: 'Показать улучшение HQ', why: 'Следующий уровень управления открывает исследовательский центр и технологии.', hint: 'Открой Центр управления на карте и начни улучшение.', building: 'hq' },
};

function text(value: unknown, fallback: string) { return typeof value === 'string' && value.trim() ? value : fallback; }
function remainingTime(endsAt: unknown, now: number) {
  const end = new Date(String(endsAt ?? '')).getTime();
  if (!Number.isFinite(end)) return 'Проверь готовность, чтобы обновить город.';
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  if (!seconds) return 'Время вышло. Проверь готовность здания.';
  const roundedMinutes = Math.ceil(seconds / 60);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return hours ? `Осталось ${hours} ч.${minutes ? ` ${minutes} мин.` : ''}` : seconds >= 60 ? `Осталось ${Math.ceil(seconds / 60)} мин.` : `Осталось ${seconds} сек.`;
}
export function ColonyGuide({ tutorial, buildings, busy, onAction, onClaim, onRefresh, onHelp, research, plannedResearchKey }: Props) {
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

  useEffect(() => {
    if (!pending && !(completed && (currentResearch || labPending || hq?.status === 'upgrading'))) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending?.id, pending?.completes_at, completed, currentResearch?.research_key, currentResearch?.completes_at, labPending?.id, labPending?.completes_at, hq?.status, hq?.completes_at]);

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
  const plan = plannedResearchKey && !completedSet.has(plannedResearchKey)
    ? buildResearchPlan(plannedResearchKey, catalog, completedKeys, currentResearch?.research_key) : null;
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
    nextLabel = 'Показать Центр управления';
    nextHint = 'Сверь стоимость улучшения с запасами колонии.';
    if (hq?.status === 'upgrading') {
      nextHint = 'Улучшение уже запущено. После завершения можно будет построить исследовательский центр.';
      nextWaiting.push({ title: 'Центр управления улучшается', endsAt: hq.completes_at, kind: 'building' });
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
    nextTitle = 'Развивай город и производство';
    nextWhy = 'Все технологии изучены. Улучшай здания, сравнивай рецепты и налаживай выпуск деталей.';
    nextHint = 'Проверь, хватает ли добычи и места на складе для следующей партии.';
    nextAction = 'production';
    nextLabel = 'Показать производство';
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
  } else if (plan?.next) {
    nextEyebrow = 'План развития';
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
      if (hq?.status === 'upgrading') nextWaiting.push({ title: 'Центр управления улучшается', endsAt: hq.completes_at, kind: 'building' });
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
    const waiting = nextWaiting[0];
    const waitingReady = waiting && new Date(String(waiting.endsAt)).getTime() <= now;
    const refreshAction = nextRefresh || (waiting?.kind === 'building' && waitingReady);
    const actionLabel = !nextRefresh && refreshAction ? 'Проверить готовность' : nextLabel;
    return <section className="card colonyGuide colonyGuideComplete colonyNextStep" aria-labelledby={`${id}-title`}>
      <div className="colonyNextStepMain">
        <div className="colonyNextStepHeading"><span className="onboardingEyebrow">{nextEyebrow}</span><h2 id={`${id}-title`}>{nextTitle}</h2>
          {waiting && <span className="colonyNextStepTimer" role="timer" aria-live="off" aria-label={`${waiting.title}: ${remainingTime(waiting.endsAt, now)}`}><GameIcon name={waiting.kind === 'research' ? 'research' : 'clock'} size={14} />{waitingReady ? 'Готово к проверке' : remainingTime(waiting.endsAt, now)}</span>}
        </div>
        <button className="action secondary colonyNextStepAction" type="button" disabled={locked} onClick={refreshAction ? onRefresh : () => onAction(nextAction)}>{actionLabel}<GameIcon name={refreshAction ? 'refresh' : 'arrow'} size={16} /></button>
      </div>
      <details className="colonyNextStepDetails"><summary>Зачем это нужно</summary><p className="colonyGuideWhy">{nextWhy}</p><p className="colonyGuideHint">{nextHint}</p>
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
