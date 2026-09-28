'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  FOUNDRY_MODES, availableFoundryLinks, foundryQueueCapacity, quoteFoundry,
  type FoundryBuilding, type FoundryJob, type FoundryLink, type FoundryMode,
} from '@/lib/game/foundry';
import { ResourceShortage } from '@/components/ResourceShortage';
import '@/app/production.css';

type Props = {
  buildings: FoundryBuilding[];
  jobs: FoundryJob[];
  resources: Record<string, unknown>;
  partsMultiplier: number;
  partsCapacity?: number;
  busy: boolean;
  selectedBuildingId?: string | null;
  onStart: (body: { buildingId: string; mode: FoundryMode; link: FoundryLink; cycles: number }) => Promise<boolean>;
  onBuild: () => void;
  onSelectBuilding?: (id: string) => void;
  onFoundryChange?: (id: string) => void;
  onChangeSelection?: () => void;
  onRefresh?: () => void;
  feedback?: ReactNode;
};

const number = (value: number) => value.toLocaleString('ru-RU');
function duration(seconds: number) {
  const rounded = Math.max(1, Math.ceil(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return [hours ? `${hours} ч.` : '', minutes ? `${minutes} мин.` : '', remainder ? `${remainder} сек.` : ''].filter(Boolean).join(' ');
}
function finishTime(value: number, now: number) {
  return new Date(value).toLocaleString('ru-RU', {
    ...(new Date(value).toDateString() !== new Date(now).toDateString() ? { day: 'numeric', month: 'short' } : {}),
    hour: '2-digit', minute: '2-digit',
  });
}
const LINK_LABEL: Record<FoundryLink, string> = { none: 'Без связи', ore: '⛏ Руда −15%', energy: '⚡ Энергия −20%' };

export function ProductionPanel(props: Props) {
  const panelId = useId();
  const foundries = props.buildings.filter((building) => building.type === 'foundry');
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<FoundryMode>('standard');
  const [link, setLink] = useState<FoundryLink>('none');
  const [cycles, setCycles] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const submittingRef = useRef(false);
  const selected = foundries.find((building) => building.id === selectedId)
    ?? foundries.find((building) => building.status === 'active') ?? foundries[0];
  const requestedFoundryId = foundries.find((building) => building.id === props.selectedBuildingId)?.id;

  useEffect(() => {
    if (requestedFoundryId) { setSelectedId(requestedFoundryId); setCycles(1); }
  }, [requestedFoundryId]);
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
  const quote = quoteFoundry({ level: selectedLevel, mode, link: effectiveLink, cycles: effectiveCycles, partsMultiplier: props.partsMultiplier });
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

  function clearFeedback() { setLocalError(''); props.onChangeSelection?.(); }

  async function start() {
    if (!selected || !isActive || locked || submittingRef.current || insufficient || !freeSlots) return;
    submittingRef.current = true;
    setSubmitting(true);
    setLocalError('');
    try {
      await props.onStart({ buildingId: selected.id, mode, link: effectiveLink, cycles: effectiveCycles });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось запустить плавку. Попробуй ещё раз.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return <section className="card productionPanel" aria-labelledby={`${panelId}-title`}>
    <div className="cardTitleRow">
      <div><h2 id={`${panelId}-title`}>🏭 Производство</h2><p>Превращай руду и энергию в детали.</p></div>
      {foundries.length > 0 && <span className="productionBadge">{foundries.length} {foundries.length === 1 ? 'цех' : foundries.length < 5 ? 'цеха' : 'цехов'}</span>}
    </div>

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
      {props.onSelectBuilding && <button type="button" className="miniButton" disabled={locked} onClick={() => props.onSelectBuilding?.(selected.id)}>На карте</button>}</div>

      {!isActive && <div className="notice productionStatus" role="status">{selected.status === 'upgrading'
        ? 'Цех улучшается. Новые плавки станут доступны после улучшения; уже запущенные продолжаются.'
        : 'Цех строится. После завершения здесь можно будет запустить плавку.'}</div>}

      {isActive && <>
        <fieldset className="productionField" disabled={locked}>
          <legend>Режим плавки</legend>
          <div className="productionModes">
            {FOUNDRY_MODES.map((item) => {
              const modeQuote = quoteFoundry({ level: selectedLevel, mode: item.id, link: effectiveLink, cycles: 1, partsMultiplier: props.partsMultiplier });
              return <label key={item.id} className={`productionMode ${mode === item.id ? 'isSelected' : ''}`}>
                <input type="radio" name={`${panelId}-mode`} value={item.id} checked={mode === item.id} onChange={() => { setMode(item.id); clearFeedback(); }} />
                <strong>{item.name}</strong><span>⚡ {number(modeQuote.energy)}</span><small>{duration(modeQuote.cycleSeconds)}</small>
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
              {LINK_LABEL[availableLink]}
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
          <div className="productionQuote" aria-live="polite">
            <div><span>Потратишь сразу</span><strong>⛏ {number(quote.ore)} <i>+</i> ⚡ {number(quote.energy)}</strong></div>
            <span className="productionArrow" aria-hidden="true">→</span>
            <div><span>Получишь</span><strong>⚙️ {number(quote.parts)} деталей</strong></div>
          </div>
          <p className="productionTiming">{duration(quote.seconds)} работы · готово примерно в {finishTime(batchEnd, now)}{queueEnd > now ? ' с учётом очереди' : ''}.</p>
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
              return <li key={job.id} className={`productionJob ${ready ? 'isReady' : queued ? 'isQueued' : 'isRunning'}`}>
                <div className="productionJobTop"><strong>{index + 1}. ⚙️ {number(Number(job.parts_reward))} деталей</strong><span>{ready ? 'Готово' : queued ? 'В очереди' : 'Плавка'}</span></div>
                <div className="productionJobBottom"><span>⛏ {number(Number(job.ore_spent))} · ⚡ {number(Number(job.energy_spent))}</span><span>{ready ? 'Ожидает выдачи' : queued ? `Старт в ${finishTime(startAt, now)}` : `Ещё ${duration((endAt - now) / 1000)}`}</span></div>
                {!queued && !ready && <div className="productionProgress" role="progressbar" aria-label={`Плавка ${index + 1}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }} /></div>}
              </li>;
            })}
          </ol>
          <p className="productionHint">Циклы идут по очереди. Перестановка и смена режима не меняют уже оплаченные задания.</p>
        </>}
      </div>
    </>}
  </section>;
}
