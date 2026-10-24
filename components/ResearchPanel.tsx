'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { BUILDINGS } from '@/lib/game/config';
import type { ResearchConfig } from '@/lib/game/research';
import type { FoundryRecipeKey } from '@/lib/game/foundry';
import { durationText as duration } from '@/lib/game/format';
import { researchRouteOutcome } from '@/lib/game/research-outcome';
import { ResourceShortage } from '@/components/ResourceShortage';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { ResearchPlanner } from '@/components/ResearchPlanner';
import { MechanicGuide } from '@/components/MechanicGuide';
import { SectionTabs } from '@/components/SectionTabs';
import '@/app/research.css';

type ResearchItem = ResearchConfig & {
  unlockedByHq: boolean;
  unlockedByLab: boolean;
  prereqsMet: boolean;
  status: string;
};

type Props = {
  research: {
    enabled: boolean;
    labLevel: number;
    labStatus: 'missing' | 'building' | 'upgrading' | 'active';
    active: { research_key: string; started_at: string; completes_at: string } | null;
    completed: string[];
    catalog: ResearchItem[];
  };
  resources: Record<string, unknown>;
  hqLevel: number;
  scienceRate: number;
  offlineCapHours: number;
  busy: boolean;
  onStart: (key: string) => Promise<void>;
  onBuildLab: () => void;
  onBuild: (type: string, name: string) => void;
  onRefresh: () => void;
  focusResearchKey?: string | null;
  focusResearchVersion?: number;
  onProduction?: (recipe: FoundryRecipeKey) => void;
  plannedResearchKey?: string | null;
  onPlanChange: (key: string | null) => void;
  onInspectResearch: (key: string) => void;
  onUpgradeHq: () => void;
  onUpgradeLab: () => void;
  onShowProduction: () => void;
  onOpenFeature?: (feature: 'market' | 'expeditions' | 'decor') => void;
};

const BRANCHES = [
  { key: 'resources', name: 'Ресурсы', title: 'Ресурсы', icon: 'ore', description: 'Больше руды и энергии. Новые технологии открывают мощные добывающие здания.' },
  { key: 'production', name: 'Производство', title: 'Производство и хранение', icon: 'parts', description: 'Открывай рецепты под запасы колонии, повышай выход деталей и расширяй склад.' },
  { key: 'exploration', name: 'Экспедиции', title: 'Экспедиции', icon: 'rocket', description: 'Открывай маршруты, получай больше научных данных и отправляй аппараты параллельно.' },
  { key: 'infrastructure', name: 'Колония', title: 'Город и связи', icon: 'city', description: 'Открывай торговлю с игроками и новые предметы благоустройства для комфорта города.' },
] as const;
type Branch = typeof BRANCHES[number]['key'];

function number(value: unknown) { return Number(value ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }
function costText(cost: Record<string, number | undefined>) {
  return Object.entries(cost).filter(([, amount]) => Number(amount) > 0)
    .map(([resource, amount], index) => <span key={resource}>{index > 0 && ' · '}<GameAmount resource={resource}>{number(amount)}</GameAmount></span>);
}

function technologyIcon(item: ResearchConfig) {
  if (item.branch === 'infrastructure') return item.key === 'trade_network' ? 'market' : 'comfort';
  if (item.branch === 'production') return item.key === 'compact_storage' ? 'building' : 'parts';
  if (item.branch === 'exploration') return 'rocket';
  if (item.branch === 'resources') return item.key === 'solar_lattice' || item.key === 'photovoltaic_arrays' ? 'energy' : 'ore';
  return 'research';
}

export function ResearchPanel(props: Props) {
  const panelId = useId();
  const [branch, setBranch] = useState<Branch>('resources');
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; text: string; error: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const submitGuard = useRef(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const focusedCardRef = useRef<HTMLElement>(null);
  const currentResearchRef = useRef<HTMLDivElement>(null);
  const researchFocusPending = useRef(false);
  const { research } = props;
  const completed = new Set([...research.completed, ...research.catalog.filter(item => item.status === 'completed').map(item => item.key)]);
  const locked = props.busy || submittingKey !== null;
  const offlineCapHours = Number.isFinite(props.offlineCapHours) && props.offlineCapHours > 0 ? props.offlineCapHours : null;
  const activeConfig = research.catalog.find((item) => item.key === research.active?.research_key);
  const activeEndsAt = research.active ? new Date(research.active.completes_at).getTime() : 0;
  const activeStartsAt = research.active ? new Date(research.active.started_at).getTime() : 0;
  const activeReady = !!research.active && now >= activeEndsAt;
  const progress = research.active ? Math.max(0, Math.min(100, (now - activeStartsAt) / Math.max(1, activeEndsAt - activeStartsAt) * 100)) : 0;
  const selectedBranch = BRANCHES.find((item) => item.key === branch)!;
  const focusedBranch = research.catalog.find((item) => item.key === props.focusResearchKey)?.branch;

  useEffect(() => {
    researchFocusPending.current = !!props.focusResearchKey;
    if (focusedBranch && focusedBranch !== 'foundation') setBranch(focusedBranch);
  }, [props.focusResearchKey, props.focusResearchVersion, focusedBranch]);

  useEffect(() => {
    if (researchFocusPending.current && props.focusResearchKey && focusedCardRef.current) {
      researchFocusPending.current = false;
      focusedCardRef.current.focus({ preventScroll: true });
      focusedCardRef.current.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }, [props.focusResearchKey, props.focusResearchVersion, branch]);

  useEffect(() => {
    if (!research.active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [research.active?.research_key, research.active?.completes_at]);

  useEffect(() => {
    if (feedback?.error) feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [feedback]);

  function isCompleted(item: ResearchItem) { return completed.has(item.key) || item.status === 'completed'; }
  function researchCost(item: ResearchItem): Record<string, number> {
    return { science: item.science, ...Object.fromEntries(Object.entries(item.cost).map(([key, value]) => [key, Number(value)])) };
  }
  function canAfford(item: ResearchItem) {
    return Object.entries(researchCost(item)).every(([resource, required]) => Number(props.resources[resource] ?? 0) >= required);
  }
  function canStart(item: ResearchItem) {
    return !locked && research.enabled && research.labStatus === 'active' && !research.active && !isCompleted(item)
      && item.status !== 'researching' && item.unlockedByHq && item.unlockedByLab && item.prereqsMet && canAfford(item);
  }

  function showCurrentResearch() {
    currentResearchRef.current?.focus({ preventScroll: true });
    currentResearchRef.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  async function start(item: ResearchItem) {
    if (submitGuard.current || !canStart(item)) return;
    submitGuard.current = true;
    setSubmittingKey(item.key);
    setFeedback(null);
    try {
      await props.onStart(item.key);
      setFeedback({ key: item.key, text: `«${item.name}» запущено. Исследование продолжится, когда игра закрыта.`, error: false });
    } catch (error) {
      setFeedback({ key: item.key, text: error instanceof Error ? error.message : 'Не удалось начать исследование. Попробуй ещё раз.', error: true });
    } finally {
      submitGuard.current = false;
      setSubmittingKey(null);
    }
  }

  function renderTechnology(item: ResearchItem) {
    const done = isCompleted(item);
    const researching = item.status === 'researching' || research.active?.research_key === item.key;
    const readyToCheck = researching && research.active?.research_key === item.key && activeReady;
    const unlockedBuilding = item.unlockBuilding ? BUILDINGS[item.unlockBuilding] : undefined;
    const routeOutcome = done ? researchRouteOutcome(item.key) : null;
    const requirements = [
      { label: `Центр колонии ур. ${item.unlockHq}`, met: item.unlockedByHq },
      { label: `Исследовательский центр ур. ${item.labLevel}`, met: item.unlockedByLab },
      ...item.prereqs.map((key) => ({ label: research.catalog.find((other) => other.key === key)?.name ?? key, met: completed.has(key) })),
    ];
    const requirementsMet = item.unlockedByHq && item.unlockedByLab && item.prereqsMet;
    const available = !done && !researching && requirementsMet && research.enabled && research.labStatus === 'active' && !research.active && canAfford(item);
    const reason = researching ? 'Исследуется' : !item.unlockedByHq ? `Нужен центр колонии ур. ${item.unlockHq}`
      : research.labStatus === 'missing' ? 'Нужен исследовательский центр'
      : research.labStatus === 'building' ? 'Центр строится'
      : research.labStatus === 'upgrading' ? 'Центр улучшается'
      : !item.unlockedByLab ? `Нужен исследовательский центр ур. ${item.labLevel}`
      : !item.prereqsMet ? 'Нужны предыдущие технологии'
      : research.active ? 'Дождись текущего исследования. Затем запусти эту технологию отдельно — автоматической очереди нет.'
      : !research.enabled ? 'Запуск временно недоступен. Обнови данные.'
      : !canAfford(item) ? 'Не хватает ресурсов'
      : locked ? 'Дождись завершения текущего действия' : '';
    const status = done ? 'Изучено' : researching ? readyToCheck ? 'Готово к проверке' : 'Исследуется' : available ? 'Можно исследовать'
      : requirementsMet && research.enabled && research.labStatus === 'active' && !research.active ? 'Нужно накопить ресурсы'
      : requirementsMet && research.labStatus === 'active' && research.active ? 'Дождись исследования' : 'Недоступно сейчас';
    const nextAction = !item.unlockedByHq ? { label: 'Показать улучшение базы', run: props.onUpgradeHq }
      : research.labStatus === 'missing' ? { label: 'Выбрать место для центра', run: props.onBuildLab }
      : research.labStatus === 'building' || research.labStatus === 'upgrading' ? { label: 'Проверить готовность центра', run: props.onRefresh }
      : !item.unlockedByLab ? { label: 'Показать улучшение центра', run: props.onUpgradeLab }
      : !item.prereqsMet ? null
      : research.active ? { label: activeReady ? 'Обновить результат исследования' : 'К текущему исследованию', run: activeReady ? props.onRefresh : showCurrentResearch }
      : !research.enabled ? { label: 'Обновить данные', run: props.onRefresh } : null;
    const showResourceHelp = requirementsMet && research.labStatus === 'active' && research.enabled && !research.active;
    const scienceMissing = Math.max(0, item.science - Number(props.resources.science ?? 0));
    const scienceWaitHours = props.scienceRate > 0 ? scienceMissing / props.scienceRate : 0;

    return <article key={item.key} tabIndex={-1} data-research-key={item.key} ref={item.key === props.focusResearchKey ? focusedCardRef : undefined} className={`technologyCard ${done ? 'isCompleted' : researching ? 'isResearching' : available ? 'isAvailable' : ''} ${item.key === props.focusResearchKey ? 'isFocused' : ''} ${props.plannedResearchKey === item.key ? 'isPlanned' : ''}`} aria-labelledby={`${panelId}-${item.key}`}>
      <div className="technologyTitle"><span aria-hidden="true"><GameIcon name={technologyIcon(item)} size={23} /></span><div><h4 id={`${panelId}-${item.key}`}>{item.name}</h4><span className={`technologyStatus ${done ? 'isCompleted' : researching ? 'isResearching' : available ? 'isAvailable' : ''}`}>{done && <GameIcon name="check" size={12} />}{status}</span></div></div>
      <p className="technologyEffect">{item.effectText}</p>
      {!done && <button type="button" className="miniButton technologyPlanButton" disabled={locked} aria-pressed={props.plannedResearchKey === item.key} onClick={() => props.onPlanChange(item.key)}><GameIcon name="missions" size={14} />{props.plannedResearchKey === item.key ? 'Текущая цель' : 'Выбрать целью'}</button>}
      {!done && <>
        <p className="technologyDescription">{item.description}</p>
        <ul className="technologyRequirements" aria-label="Требования исследования">{requirements.map((requirement) => <li key={requirement.label} className={requirement.met ? 'isMet' : ''}><span aria-hidden="true">{requirement.met ? <GameIcon name="check" size={11} /> : '○'}</span> {requirement.label}<span className="researchSrOnly">{requirement.met ? ' — выполнено' : ' — требуется'}</span></li>)}</ul>
        {item.prereqs.some(key => !completed.has(key)) && <div className="technologyPrereqLinks">{item.prereqs.filter(key => !completed.has(key)).map(key => <button type="button" className="miniButton" key={key} disabled={locked} onClick={() => props.onInspectResearch(key)}>К технологии «{research.catalog.find(other => other.key === key)?.name ?? key}»<GameIcon name="arrow" size={13} /></button>)}</div>}
        {researching && <div className="technologyNextStep">
          <p>{readyToCheck ? 'Время вышло. Проверь результат, чтобы получить подтверждение и применить бонус.' : 'Исследование уже оплачено и продолжается при закрытой игре. Следующую технологию нужно запускать отдельно.'}</p>
          <button type="button" className="miniButton" disabled={locked} onClick={readyToCheck || !research.active ? props.onRefresh : showCurrentResearch}>{readyToCheck ? 'Обновить результат исследования' : research.active ? 'К текущему исследованию' : 'Проверить исследование'}<GameIcon name="arrow" size={13} /></button>
        </div>}
        {!researching && <>
          <div className="technologyCost"><span><span className="technologyCostLabel">Стоимость запуска</span>{costText(researchCost(item))}</span><span><GameIcon name="clock" size={13} /> {duration(item.timeSec)}</span></div>
          <button type="button" className={`action ${canStart(item) ? 'researchStart' : 'secondary'}`} disabled={!canStart(item)} aria-describedby={`${panelId}-${item.key}-availability`} onClick={() => void start(item)}>{submittingKey === item.key ? 'Запускаем…' : 'Запустить исследование'}</button>
          <div id={`${panelId}-${item.key}-availability`} aria-live="polite">
            {reason && reason !== 'Не хватает ресурсов' && <p className="technologyBlocker">{reason}</p>}
            <ResourceShortage cost={researchCost(item)} resources={props.resources} />
          </div>
          {nextAction && <div className="technologyNextStep"><button type="button" className="miniButton" disabled={locked} aria-describedby={`${panelId}-${item.key}-availability`} onClick={nextAction.run}>{nextAction.label}<GameIcon name="arrow" size={13} /></button></div>}
          {showResourceHelp && <>
            {(Number(item.cost.parts ?? 0) > Number(props.resources.parts ?? 0) || scienceMissing > 0 && props.scienceRate <= 0) && <div className="technologyResourceActions">
              {Number(item.cost.parts ?? 0) > Number(props.resources.parts ?? 0) && <button type="button" className="miniButton" disabled={locked} onClick={props.onShowProduction}><GameIcon name="parts" size={14} />К производству деталей</button>}
              {scienceMissing > 0 && props.scienceRate <= 0 && <button type="button" className="miniButton" disabled={locked} onClick={props.onUpgradeLab}><GameIcon name="science" size={14} />Показать исследовательский центр</button>}
            </div>}
            {scienceMissing > 0 && props.scienceRate <= 0 && <p className="technologyScienceWait">Наука пока не производится. Проверь состояние исследовательского центра.</p>}
            {scienceWaitHours > 0 && <p className="technologyScienceWait">При текущей выработке нужная наука накопится за {duration(scienceWaitHours * 3600)} активного накопления. Без будущих улучшений и расходов.{offlineCapHours !== null && scienceWaitHours > offlineCapHours ? ` За одно отсутствие учитывается до ${number(offlineCapHours)} ч. — затем открой колонию, чтобы продолжить накопление.` : ''}</p>}
          </>}
        </>}
      </>}
      {done && unlockedBuilding && item.unlockBuilding && <>
        {props.hqLevel < unlockedBuilding.unlockHq && <p className="technologyBlocker">Для постройки «{unlockedBuilding.name}» нужен центр колонии ур. {unlockedBuilding.unlockHq}. Технология уже изучена.</p>}
        <button type="button" className="action secondary technologyBuild" disabled={locked} onClick={props.hqLevel < unlockedBuilding.unlockHq ? props.onUpgradeHq : () => props.onBuild(item.unlockBuilding!, unlockedBuilding.name)}>{props.hqLevel < unlockedBuilding.unlockHq ? 'Показать улучшение базы' : `К постройке: ${unlockedBuilding.name}`}</button>
      </>}
      {done && item.unlockRecipe && props.onProduction && <button type="button" className="action secondary technologyBuild" disabled={locked} onClick={() => props.onProduction?.(item.unlockRecipe!)}>Открыть рецепт в производстве</button>}
      {done && item.unlockFeature && props.onOpenFeature && <button type="button" className="action secondary technologyBuild" disabled={locked} onClick={() => props.onOpenFeature?.(item.unlockFeature!)}>{item.unlockFeature === 'market' ? 'Открыть рынок' : item.unlockFeature === 'expeditions' ? 'Открыть экспедиции' : 'Перейти к благоустройству'}</button>}
      {routeOutcome && <><p className="technologyBlocker">{routeOutcome.requirementsText}</p>{props.onOpenFeature && <button type="button" className="action secondary technologyBuild" disabled={locked} onClick={() => props.onOpenFeature?.('expeditions')}>К маршрутам<GameIcon name="arrow" size={15} /></button>}</>}
      {feedback?.key === item.key && <div ref={feedbackRef} className={`notice researchFeedback ${feedback.error ? 'error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</div>}
    </article>;
  }

  return <section className="card researchPanel" aria-labelledby={`${panelId}-heading`}>
    <div className="researchPanelHeading"><div><h2 id={`${panelId}-heading`}><GameIcon name="research" size={22} /> Исследования</h2><p>Усиливай базу и открывай новые возможности.</p></div><span className="researchScienceRate"><GameAmount resource="science">+{number(props.scienceRate)}</GameAmount>/ч</span></div>
    <div className="researchOverview"><span>Наука: <strong><GameAmount resource="science">{number(props.resources.science)}</GameAmount></strong></span><span>Изучено: <strong>{research.catalog.filter(isCompleted).length} / {research.catalog.length}</strong></span></div>
    {research.catalog.some(isCompleted) && <details className="researchApplied"><summary>Что уже работает в колонии</summary><ul>{research.catalog.filter(isCompleted).map((item) => <li key={item.key}><strong><GameIcon name={technologyIcon(item)} size={14} /> {item.name}</strong><span>{item.effectText}</span></li>)}</ul></details>}

    {research.active && <div ref={currentResearchRef} tabIndex={-1} className="researchCurrent" aria-labelledby={`${panelId}-current`}>
      <span className="researchCurrentLabel">{activeReady ? 'Исследование готово' : 'Сейчас исследуется'}</span>
      <h3 id={`${panelId}-current`}><GameIcon name={activeConfig ? technologyIcon(activeConfig) : 'research'} size={18} /> {activeConfig?.name ?? research.active.research_key}</h3>
      {activeConfig && <p>{activeConfig.effectText}</p>}
      <div className="researchCurrentFoot"><span>{activeReady ? 'Обнови результат, чтобы применить технологию.' : `Осталось ${duration((activeEndsAt - now) / 1000)}`}</span>{activeReady && <button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить</button>}</div>
      <div className="researchProgress" role="progressbar" aria-label="Прогресс исследования" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }} /></div>
    </div>}

    {research.labStatus !== 'active' && <div className="researchLabNotice" role="status">
      <strong>{research.labStatus === 'missing' ? 'Нужен исследовательский центр' : research.labStatus === 'building' ? 'Исследовательский центр строится' : 'Исследовательский центр улучшается'}</strong>
      <p>{research.labStatus === 'missing' ? 'С уровня 2 центра колонии доступен исследовательский центр. Он производит науку для технологий. Цель можно выбрать уже сейчас.' : research.labStatus === 'building' ? 'После завершения центр начнёт производить науку. Пока выбери следующую технологию.' : 'Новые исследования станут доступны после улучшения. Уже запущенное исследование продолжается.'}</p>
      {research.labStatus === 'missing' && <button type="button" className="action secondary" disabled={locked} onClick={props.hqLevel < 2 ? props.onUpgradeHq : props.onBuildLab}>{props.hqLevel < 2 ? 'Показать улучшение базы' : 'Построить исследовательский центр'}</button>}
      {research.labStatus !== 'missing' && <button type="button" className="action secondary" disabled={locked} onClick={props.onRefresh}>Проверить готовность центра</button>}
    </div>}

    <ResearchPlanner catalog={research.catalog} completed={[...completed]} active={research.active}
      targetKey={props.plannedResearchKey ?? null} onTargetChange={props.onPlanChange}
      hqLevel={props.hqLevel} labLevel={research.labLevel} labStatus={research.labStatus} enabled={research.enabled}
      resources={props.resources} scienceRate={props.scienceRate} offlineCapHours={props.offlineCapHours} busy={locked}
      onResearch={props.onInspectResearch} onUpgradeHq={props.onUpgradeHq} onBuildLab={props.onBuildLab}
      onUpgradeLab={props.onUpgradeLab} onProduction={props.onShowProduction} onRefresh={props.onRefresh}
      onExpeditions={props.onOpenFeature ? () => props.onOpenFeature?.('expeditions') : undefined} />
    {research.catalog.filter(item => item.branch === 'foundation').every(isCompleted)
      ? <details className="researchFoundation" open={research.catalog.some(item => item.branch === 'foundation' && item.key === props.focusResearchKey)}><summary><GameIcon name="check" size={14} /> Основа развития изучена</summary>{research.catalog.filter(item => item.branch === 'foundation').map(renderTechnology)}</details>
      : <div className="researchFoundation"><h3>Основа развития</h3>{research.catalog.filter(item => item.branch === 'foundation').map(renderTechnology)}</div>}
    <SectionTabs label="Ветки исследований" items={BRANCHES.map(item => ({ key: item.key, label: item.name, icon: item.icon }))} value={branch} onChange={key => setBranch(key as Branch)} />
    <div className="researchBranch" aria-labelledby={`${panelId}-branch`}>
      <h3 id={`${panelId}-branch`}>{selectedBranch.title}</h3><p className="researchBranchDescription">{selectedBranch.description}</p>
      <div className="technologyList">{research.catalog.filter((item) => item.branch === branch).map(renderTechnology)}</div>
    </div>
    <MechanicGuide steps={[
      'Выбери цель бесплатно: план покажет нужные технологии и ближайший шаг.',
      'Открой карточку и запусти исследование. Наука и ресурсы списываются один раз при запуске; одновременно изучается одна технология.',
      `После завершения бонус применяется к колонии, а открытые постройки и рецепты выбираются отдельно. ${offlineCapHours !== null ? `Наука копится без открытой игры до ${number(offlineCapHours)} ч. за одно отсутствие.` : 'Наука копится и при закрытой игре; за одно отсутствие действует лимит накопления.'}`,
    ]} />
  </section>;
}
