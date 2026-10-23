'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  FOUNDRY_MODES, FOUNDRY_RECIPES, availableFoundryLinks, foundryQueueCapacity, quoteFoundry,
  type FoundryBuilding, type FoundryJob, type FoundryLink, type FoundryMode, type FoundryRecipeKey,
} from '@/lib/game/foundry';
import { ResourceShortage } from '@/components/ResourceShortage';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { supplyProductionPlan } from '@/lib/game/supply-production';
import { durationText as duration } from '@/lib/game/format';
import '@/app/production.css';

type Props = {
  buildings: FoundryBuilding[];
  jobs: FoundryJob[];
  resources: Record<string, unknown>;
  partsMultiplier: number;
  partsCapacity?: number;
  busy: boolean;
  selectedBuildingId?: string | null;
  selectedRecipe?: FoundryRecipeKey;
  requestedLink?: { buildingId: string; link: FoundryLink; request: number } | null;
  unlockedRecipes?: string[];
  recipesEnabled?: boolean;
  onStart: (body: { buildingId: string; recipe: FoundryRecipeKey; mode: FoundryMode; link: FoundryLink; cycles: number }) => Promise<boolean>;
  onBuild: () => void;
  onSelectBuilding?: (id: string) => void;
  onFoundryChange?: (id: string) => void;
  onChangeSelection?: () => void;
  onRefresh?: () => void;
  onResearch?: (researchKey: string) => void;
  feedback?: ReactNode;
  supplyGoal?: { projectKey: string; name: string; stageName: string; requiredParts: number; ready: boolean; completed: boolean };
  onSupplyProjects?: () => void;
};

const number = (value: number) => value.toLocaleString('ru-RU');
function finishTime(value: number, now: number) {
  return new Date(value).toLocaleString('ru-RU', {
    ...(new Date(value).toDateString() !== new Date(now).toDateString() ? { day: 'numeric', month: 'short' } : {}),
    hour: '2-digit', minute: '2-digit',
  });
}
const LINK_LABEL: Record<FoundryLink, string> = { none: 'Без связи', ore: 'Руда −15%', energy: 'Энергия −20%' };
const RECIPE_HINT: Record<FoundryRecipeKey, string> = {
  standard_alloy: 'Универсальный рецепт для повседневной плавки.',
  precision_casting: 'Бережёт руду, но требует больше энергии и времени.',
  industrial_casting: 'Меньше энергии на деталь, больше руды и предоплаты. Крупная партия занимает одно место в очереди.',
};
const RECIPE_RESEARCH_NAME: Record<string, string> = {
  precision_casting: 'Точное литьё', industrial_casting: 'Поточное литьё',
};

export function ProductionPanel(props: Props) {
  const panelId = useId();
  const foundries = props.buildings.filter((building) => building.type === 'foundry');
  const [selectedId, setSelectedId] = useState('');
  const [recipe, setRecipe] = useState<FoundryRecipeKey>('standard_alloy');
  const [mode, setMode] = useState<FoundryMode>('standard');
  const [link, setLink] = useState<FoundryLink>('none');
  const [cycles, setCycles] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const submittingRef = useRef(false);
  const recipePickerRef = useRef<HTMLDetailsElement>(null);
  const recipeSummaryRef = useRef<HTMLElement>(null);
  const selected = foundries.find((building) => building.id === selectedId)
    ?? foundries.find((building) => building.status === 'active') ?? foundries[0];
  const requestedFoundryId = foundries.find((building) => building.id === props.selectedBuildingId)?.id;
  const requestedRecipeUnlocked = props.selectedRecipe === 'standard_alloy' || (props.recipesEnabled !== false && Boolean(props.unlockedRecipes?.includes(props.selectedRecipe ?? '')));

  useEffect(() => {
    if (requestedFoundryId) {
      setSelectedId(requestedFoundryId);
      if (requestedFoundryId !== selected?.id) setCycles(1);
    }
  }, [requestedFoundryId]);
  useEffect(() => {
    if (props.selectedRecipe && requestedRecipeUnlocked) setRecipe(props.selectedRecipe);
  }, [props.selectedRecipe, requestedRecipeUnlocked]);
  useEffect(() => {
    const intent = props.requestedLink;
    if (!intent) return;
    const foundry = props.buildings.find(building => building.id === intent.buildingId && building.type === 'foundry' && building.status === 'active');
    if (!foundry) return;
    setSelectedId(foundry.id);
    setRecipe('standard_alloy'); setMode('standard'); setCycles(1);
    setLink(availableFoundryLinks(foundry, props.buildings).includes(intent.link) ? intent.link : 'none');
    setLocalError('');
    // Each explicit map choice has a new request, including repeated choices for the same workshop.
  }, [props.requestedLink?.request]);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), props.jobs.length ? 1000 : 5000);
    return () => window.clearInterval(timer);
  }, [props.jobs.length]);

  const selectedJobs = props.jobs.filter((job) => job.building_id === selected?.id)
    .sort((a, b) => new Date(a.completes_at).getTime() - new Date(b.completes_at).getTime());
  const links = selected ? availableFoundryLinks(selected, props.buildings) : ['none' as const];
  const effectiveLink = links.includes(link) ? link : 'none';
  const selectedLevel = Math.max(1, Number(selected?.level ?? 1));
  const capacity = foundryQueueCapacity(selectedLevel);
  const freeSlots = Math.max(0, capacity - selectedJobs.length);
  const effectiveCycles = Math.min(cycles, Math.max(1, freeSlots));
  const unlockedRecipes = props.unlockedRecipes ?? ['standard_alloy'];
  const recipeUnlocked = (key: FoundryRecipeKey) => key === 'standard_alloy' || (props.recipesEnabled !== false && unlockedRecipes.includes(key));
  const effectiveRecipe = recipeUnlocked(recipe) ? recipe : 'standard_alloy';
  const selectedRecipe = FOUNDRY_RECIPES.find((item) => item.id === effectiveRecipe) ?? FOUNDRY_RECIPES[0];
  const quote = quoteFoundry({ level: selectedLevel, recipe: effectiveRecipe, mode, link: effectiveLink, cycles: effectiveCycles, partsMultiplier: props.partsMultiplier });
  const insufficient = Number(props.resources.ore ?? 0) < quote.ore || Number(props.resources.energy ?? 0) < quote.energy;
  const queueEnd = Math.max(now, ...selectedJobs.map((job) => new Date(job.completes_at).getTime()));
  const batchEnd = queueEnd + quote.seconds * 1000;
  const isActive = selected?.status === 'active';
  const locked = props.busy || submitting;
  const readyJobs = selectedJobs.filter((job) => new Date(job.completes_at).getTime() <= now);
  const storageBlocked = readyJobs.length > 0 && props.partsCapacity !== undefined
    && Number(props.resources.parts ?? 0) + Math.min(...readyJobs.map((job) => Number(job.parts_reward))) > props.partsCapacity;
  const storageWillOverflow = props.partsCapacity !== undefined && Number(props.resources.parts ?? 0)
    + props.jobs.reduce((sum, job) => sum + Number(job.parts_reward), 0) + quote.parts > props.partsCapacity;
  const supplyPlan = props.supplyGoal ? supplyProductionPlan({ requiredParts: props.supplyGoal.requiredParts,
    currentParts: Math.max(0, Math.floor(Number(props.resources.parts ?? 0))),
    queuedParts: props.jobs.reduce((sum, job) => sum + Number(job.parts_reward), 0),
    cycleParts: quote.cycleParts, freeSlots }) : null;

  function clearFeedback() { setLocalError(''); props.onChangeSelection?.(); }

  async function start() {
    if (!selected || !isActive || locked || submittingRef.current || insufficient || !freeSlots) return;
    submittingRef.current = true;
    setSubmitting(true);
    setLocalError('');
    try {
      await props.onStart({ buildingId: selected.id, recipe: effectiveRecipe, mode, link: effectiveLink, cycles: effectiveCycles });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось запустить плавку. Попробуй ещё раз.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return <section className="card productionPanel" aria-labelledby={`${panelId}-title`}>
    <div className="cardTitleRow">
      <div><h2 id={`${panelId}-title`}><GameIcon name="foundry" size={22} /> Производство</h2><p>Превращай руду и энергию в детали.</p></div>
      {foundries.length > 0 && <span className="productionBadge">{foundries.length} {foundries.length === 1 ? 'цех' : foundries.length < 5 ? 'цеха' : 'цехов'}</span>}
    </div>

    {props.supplyGoal && supplyPlan && <div className="productionSupplyGoal" data-production-supply-goal>
      <div className="productionSupplyHeading"><GameIcon name="target" size={20} /><div><strong>{props.supplyGoal.name}</strong><small>{props.supplyGoal.stageName}</small></div>{props.onSupplyProjects && <button type="button" className="miniButton" disabled={locked} onClick={props.onSupplyProjects}>К поставкам</button>}</div>
      {props.supplyGoal.completed ? <p>Проект завершён. Итоги и полученные награды доступны в поставках.</p>
        : props.supplyGoal.ready ? <p>Все ресурсы доставлены. Забери награду этапа в проектах снабжения.</p>
          : supplyPlan.requiredParts === 0 ? <p>Детали этого этапа уже доставлены. Проверь оставшиеся поставки руды и энергии.</p> : <>
            <div className="productionSupplyNumbers"><span>Для поставки <GameAmount resource="parts">{number(supplyPlan.requiredParts)}</GameAmount></span><span>На складе <GameAmount resource="parts">{number(supplyPlan.stockParts)}</GameAmount></span><span>В очередях <GameAmount resource="parts">{number(supplyPlan.queuedParts)}</GameAmount></span><strong>Не хватает <GameAmount resource="parts">{number(supplyPlan.missingParts)}</GameAmount></strong></div>
            {supplyPlan.missingParts === 0 ? <p>{supplyPlan.stockParts >= supplyPlan.requiredParts ? 'Деталей на складе хватит для этой поставки.' : 'После выдачи всех уже оплаченных очередей деталей хватит. Проверь готовность и свободное место на складе.'}</p>
              : !selected || !isActive ? <p>Расчёт партии станет доступен в работающем литейном цехе.</p>
                : !freeSlots ? <p>Очередь этого цеха заполнена. Освободи место или выбери другой работающий цех.</p>
                  : <><button type="button" className="miniButton productionSupplyApply" disabled={locked || supplyPlan.suggestedCycles <= 0} onClick={() => { setCycles(supplyPlan.suggestedCycles); clearFeedback(); }}>Подставить {supplyPlan.suggestedCycles} {supplyPlan.suggestedCycles === 1 ? 'цикл' : supplyPlan.suggestedCycles < 5 ? 'цикла' : 'циклов'} · <GameAmount resource="parts">{number(supplyPlan.batchParts)}</GameAmount></button>
                    <p>{supplyPlan.remainingAfterBatch > 0 ? `После этой партии останется произвести ${number(supplyPlan.remainingAfterBatch)} деталей. ` : supplyPlan.surplusParts > 0 ? `Излишек ${number(supplyPlan.surplusParts)} деталей останется у тебя. ` : ''}Расчёт учитывает все очереди и выбранный рецепт. Подстановка только меняет число циклов — запуск ниже отдельной кнопкой.</p></>}
          </>}
    </div>}

    {!selected ? <>
      <p>Построй литейный цех рядом с шахтой или электростанцией, чтобы снизить расход ресурсов.</p>
      <button type="button" className="action" disabled={locked} onClick={props.onBuild}>Построить литейный цех</button>
    </> : <>
      <div className="productionWorkshopRow"><label className="productionSelect" htmlFor={`${panelId}-foundry`}>Управление цехом
        <select id={`${panelId}-foundry`} value={selected.id} disabled={locked} onChange={(event) => {
          setSelectedId(event.target.value); setCycles(1); setLink('none'); clearFeedback();
          props.onFoundryChange?.(event.target.value);
        }}>
          {foundries.map((building) => <option key={building.id} value={building.id}>
            Цех ({building.x + 1}, {building.y + 1}) · ур. {building.level}{building.status === 'active' ? '' : building.status === 'upgrading' ? ' · улучшается' : ' · строится'}
          </option>)}
        </select>
      </label>
      {props.onSelectBuilding && <button type="button" className="miniButton" disabled={locked} onClick={() => props.onSelectBuilding?.(selected.id)}><GameIcon name="map" size={14} /> На карте</button>}</div>

      {!isActive && <div className="notice productionStatus" role="status">{selected.status === 'upgrading'
        ? 'Цех улучшается. Новые плавки станут доступны после улучшения; уже запущенные продолжаются.'
        : 'Цех строится. После завершения здесь можно будет запустить плавку.'}</div>}

      {isActive && <>
        <fieldset className="productionField" disabled={locked}>
          <legend>Рецепт</legend>
          {props.recipesEnabled === false && <p className="notice productionStatus" role="status">Новые рецепты временно недоступны. Стандартный сплав работает.</p>}
          <details className="productionRecipePicker" ref={recipePickerRef}>
            <summary ref={recipeSummaryRef}>
              <GameIcon name="foundry" size={30} />
              <span className="productionRecipeSummaryBody"><strong>{selectedRecipe.name}</strong><small><GameAmount resource="parts">{number(quote.cycleParts)}</GameAmount> за цикл <span>·</span><GameIcon name="clock" size={13} />{duration(quote.cycleSeconds)}</small></span>
              <span className="productionRecipeChange">Сменить<GameIcon name="arrow" size={13} /></span>
            </summary>
          <div className="productionRecipes">
            {FOUNDRY_RECIPES.map((item) => {
              const unlocked = recipeUnlocked(item.id);
              const recipeQuote = quoteFoundry({ level: selectedLevel, recipe: item.id, mode, link: effectiveLink, cycles: 1, partsMultiplier: props.partsMultiplier });
              return <div key={item.id} className={`productionRecipe ${effectiveRecipe === item.id ? 'isSelected' : ''} ${!unlocked ? 'isLocked' : ''}`}>
                <label className="productionRecipeChoice">
                  <input type="radio" name={`${panelId}-recipe`} value={item.id} checked={effectiveRecipe === item.id} disabled={!unlocked} onChange={() => {
                    setRecipe(item.id); clearFeedback();
                    if (recipePickerRef.current) recipePickerRef.current.open = false;
                    recipeSummaryRef.current?.focus({ preventScroll: true });
                  }} />
                  <span className="productionRecipeBody">
                    <span className="productionRecipeHeading"><strong>{item.name}</strong>{!unlocked && <small>Закрыт</small>}</span>
                    <span className="productionRecipeHint">{RECIPE_HINT[item.id]}</span>
                    <span className="productionRecipeCost"><GameAmount resource="ore">{number(recipeQuote.ore)}</GameAmount> · <GameAmount resource="energy">{number(recipeQuote.energy)}</GameAmount> → <GameAmount resource="parts">{number(recipeQuote.parts)}</GameAmount> деталей · {duration(recipeQuote.seconds)}</span>
                  </span>
                </label>
                {!unlocked && item.requiredResearch && props.recipesEnabled !== false && <div className="productionRecipeUnlock">
                  <span>Нужно исследование «{RECIPE_RESEARCH_NAME[item.requiredResearch] ?? item.requiredResearch}».</span>
                  {props.onResearch && <button type="button" className="miniButton" onClick={() => props.onResearch?.(item.requiredResearch!)}>К исследованию</button>}
                </div>}
              </div>;
            })}
          </div>
          </details>
          <p className="productionHint">{selectedRecipe.description}.</p>
        </fieldset>

        <fieldset className="productionField" disabled={locked}>
          <legend>Режим плавки</legend>
          <div className="productionModes">
            {FOUNDRY_MODES.map((item) => {
              const modeQuote = quoteFoundry({ level: selectedLevel, recipe: effectiveRecipe, mode: item.id, link: effectiveLink, cycles: 1, partsMultiplier: props.partsMultiplier });
              return <label key={item.id} className={`productionMode ${mode === item.id ? 'isSelected' : ''}`}>
                <input type="radio" name={`${panelId}-mode`} value={item.id} checked={mode === item.id} onChange={() => { setMode(item.id); clearFeedback(); }} />
                <strong>{item.name}</strong><span><GameAmount resource="energy">{number(modeQuote.energy)}</GameAmount></span><small>{duration(modeQuote.cycleSeconds)}</small>
              </label>;
            })}
          </div>
          <p className="productionHint">{FOUNDRY_MODES.find((item) => item.id === mode)?.description}</p>
        </fieldset>

        <fieldset className="productionField" disabled={locked}>
          <legend>Связь с соседним зданием</legend>
          <div className="productionLinks">
            {links.map((availableLink) => <label key={availableLink} className={`productionLink ${effectiveLink === availableLink ? 'isSelected' : ''}`}>
              <input type="radio" name={`${panelId}-link`} value={availableLink} checked={effectiveLink === availableLink} onChange={() => { setLink(availableLink); clearFeedback(); }} />
              {availableLink !== 'none' && <><GameIcon name={availableLink} size={13} /> </>}{LINK_LABEL[availableLink]}
            </label>)}
          </div>
          <p className="productionHint">{links.length === 1
            ? 'Поставь работающую шахту или электростанцию на соседнюю клетку по стороне. Перестановка бесплатная.'
            : 'Выбери одну связь. Скидка применяется к новым плавкам.'}</p>
        </fieldset>

        <div className="productionCycles">
          <div><strong id={`${panelId}-cycles`}>Циклов подряд</strong><span>Свободно в очереди: {freeSlots} из {capacity}</span></div>
          <div className="productionStepper" role="group" aria-labelledby={`${panelId}-cycles`}>
            <button type="button" aria-label="Уменьшить число циклов" disabled={locked || effectiveCycles <= 1 || !freeSlots} onClick={() => { setCycles(effectiveCycles - 1); clearFeedback(); }}>−</button>
            <output aria-live="polite" aria-label="Число циклов">{freeSlots ? effectiveCycles : 0}</output>
            <button type="button" aria-label="Увеличить число циклов" disabled={locked || effectiveCycles >= freeSlots} onClick={() => { setCycles(effectiveCycles + 1); clearFeedback(); }}>+</button>
          </div>
        </div>

        {freeSlots > 0 ? <>
          <div className="productionOrder">
          <div className="productionOrderHeading"><strong>Партия · {effectiveCycles} {effectiveCycles === 1 ? 'цикл' : effectiveCycles < 5 ? 'цикла' : 'циклов'}</strong><span>{FOUNDRY_MODES.find((item) => item.id === mode)?.name}</span></div>
          <div className="productionQuote" aria-live="polite">
            <div><span>Потратишь сразу</span><strong className="productionIngredients"><GameAmount resource="ore" size={21}>{number(quote.ore)}</GameAmount> <i>+</i> <GameAmount resource="energy" size={21}>{number(quote.energy)}</GameAmount></strong></div>
            <span className="productionArrow" aria-hidden="true"><GameIcon name="arrow" size={16} /></span>
            <div><span>Получишь</span><strong><GameAmount resource="parts" size={25}>{number(quote.parts)}</GameAmount> <small>деталей</small></strong></div>
          </div>
          <p className="productionTiming"><GameIcon name="clock" size={16} /><span><strong>{duration(quote.seconds)} работы</strong><small>Готово примерно в {finishTime(batchEnd, now)}{queueEnd > now ? ' с учётом очереди' : ''}.</small></span></p>
          </div>
          {storageWillOverflow && <p className="productionStorage isBlocked">С учётом очередей всех цехов места на складе не хватит. Лишние готовые циклы останутся в цехе — детали не пропадут.</p>}
          <button type="button" className="action productionStart" disabled={locked || insufficient} onClick={() => void start()}>
            {submitting ? 'Запускаем…' : selectedJobs.length > 0 ? `Добавить в очередь · ${effectiveCycles} ${effectiveCycles === 1 ? 'цикл' : effectiveCycles < 5 ? 'цикла' : 'циклов'}` : `Запустить · ${effectiveCycles} ${effectiveCycles === 1 ? 'цикл' : effectiveCycles < 5 ? 'цикла' : 'циклов'}`}
          </button>
          <div aria-live="polite"><ResourceShortage cost={{ ore: quote.ore, energy: quote.energy }} resources={props.resources} /></div>
        </> : <div className="notice productionStatus">Очередь заполнена. Дождись выдачи деталей, чтобы добавить новые циклы.</div>}
      </>}

      {props.feedback}
      {localError && <div className="notice error actionFeedback" role="alert">{localError}</div>}

      <div className="productionQueue">
        <div className="productionQueueHeading"><h3>Очередь этого цеха</h3><span>{selectedJobs.length} / {capacity}</span></div>
        {selectedJobs.length === 0 ? <p>Пока пусто. Цех ждёт задания.</p> : <>
          {readyJobs.length > 0 && <p className={`productionStorage ${storageBlocked ? 'isBlocked' : ''}`} role="status">{storageBlocked
            ? 'Склад деталей заполнен. Потрать или продай детали — готовые циклы останутся в цехе до освобождения места.'
            : 'Готовые детали поступят на склад при обновлении. Если места не хватит, они останутся в цехе.'}</p>}
          {readyJobs.length > 0 && props.onRefresh && <button type="button" className="miniButton productionRefresh" disabled={locked} onClick={props.onRefresh}>Обновить выдачу деталей</button>}
          <ol className="productionJobs">
            {selectedJobs.map((job, index) => {
              const startAt = new Date(job.started_at).getTime();
              const endAt = new Date(job.completes_at).getTime();
              const ready = endAt <= now;
              const queued = !ready && startAt > now;
              const progress = Math.max(0, Math.min(100, (now - startAt) / Math.max(1, endAt - startAt) * 100));
              const jobRecipe = FOUNDRY_RECIPES.find((item) => item.id === job.recipe_key) ?? FOUNDRY_RECIPES[0];
              return <li key={job.id} className={`productionJob ${ready ? 'isReady' : queued ? 'isQueued' : 'isRunning'}`}>
                <div className="productionJobTop"><strong>{index + 1}. <GameAmount resource="parts">{number(Number(job.parts_reward))}</GameAmount> деталей</strong><span>{ready ? 'Готово' : queued ? 'В очереди' : 'Плавка'}</span></div>
                <div className="productionJobRecipe">{jobRecipe.name}</div>
                <div className="productionJobBottom"><span><GameAmount resource="ore">{number(Number(job.ore_spent))}</GameAmount> · <GameAmount resource="energy">{number(Number(job.energy_spent))}</GameAmount></span><span>{ready ? 'Ожидает выдачи' : queued ? `Старт в ${finishTime(startAt, now)}` : `Ещё ${duration((endAt - now) / 1000)}`}</span></div>
                {!queued && !ready && <div className="productionProgress" role="progressbar" aria-label={`Плавка ${index + 1}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }} /></div>}
              </li>;
            })}
          </ol>
          <p className="productionHint">Циклы идут по очереди. Перестановка, смена рецепта и режима не меняют уже оплаченные задания.</p>
        </>}
      </div>
    </>}
  </section>;
}
