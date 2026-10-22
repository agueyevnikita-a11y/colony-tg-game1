'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { BuildingArt } from '@/components/BuildingArt';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { RESEARCH_TREE } from '@/lib/game/research';
import { evaluateColonyChoice, type ColonyEventDefinition } from '@/lib/game/colony-events';
import '@/app/colony-events.css';

type ResourceAmounts = Record<string, number | undefined>;
type Props = {
  eventState?: {
    enabled: boolean;
    unlocked: boolean;
    active: ({ id: string; createdAt: string } & ColonyEventDefinition) | null;
    lastResolved: {
      id: string; title: string; choiceTitle: string; resultText: string;
      cost: ResourceAmounts; reward: ResourceAmounts; resolvedAt: string;
    } | null;
    nextAt: string | null;
  };
  resources: Record<string, unknown>;
  capacities: Partial<Record<'ore' | 'energy' | 'parts', number>>;
  completedResearch: string[];
  busy: boolean;
  onResolve: (eventId: string, choiceId: string) => Promise<unknown>;
  onShowBuilding: (type: string) => void;
  onResearch: (key: string) => void;
  onRefresh: () => void;
};

function amounts(value: ResourceAmounts) {
  return Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0);
}
function quantity(value: number) { return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }
function Amounts({ value }: { value: ResourceAmounts }) {
  return <>{amounts(value).map(([resource, amount]) => <GameAmount key={resource} resource={resource}>{quantity(amount)}</GameAmount>)}</>;
}
function Exchange({ cost, reward, past = false }: { cost: ResourceAmounts; reward: ResourceAmounts; past?: boolean }) {
  return <div className="colonyEventExchange">
    <div><span>{past ? 'Списано' : 'Спишется'}</span><strong>{amounts(cost).length ? <Amounts value={cost} /> : <span>Без затрат</span>}</strong></div>
    <GameIcon name="arrow" size={15} />
    <div><span>{past ? 'Получено' : 'Получишь'}</span><strong>{amounts(reward).length ? <Amounts value={reward} /> : <span>Без награды</span>}</strong></div>
  </div>;
}
function availableAt(value: string, now: number) {
  const date = new Date(value);
  return date.toLocaleString('ru-RU', {
    ...(date.toDateString() !== new Date(now).toDateString() ? { day: 'numeric', month: 'short' } : {}),
    hour: '2-digit', minute: '2-digit',
  });
}

export function ColonyEventCard(props: Props) {
  const id = useId();
  const [pendingChoice, setPendingChoice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<{ eventId: string; choiceId: string; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const submitGuard = useRef(false);
  const active = props.eventState?.active;
  const lastResolved = props.eventState?.lastResolved;
  const nextAt = props.eventState?.nextAt;
  const nextAtMs = nextAt ? new Date(nextAt).getTime() : 0;
  const nextTimeValid = !!nextAt && Number.isFinite(nextAtMs);
  const canCheckNext = nextTimeValid && nextAtMs <= now;
  const locked = props.busy || pendingChoice !== null;

  useEffect(() => { setLocalError(null); }, [active?.id]);
  useEffect(() => {
    if (active || !nextAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [active?.id, nextAt]);

  async function resolve(choiceId: string) {
    if (!active || locked || submitGuard.current) return;
    const choice = active.choices.find((item) => item.id === choiceId);
    if (!choice || !evaluateColonyChoice(choice, props.resources, props.capacities, props.completedResearch).canResolve) return;
    submitGuard.current = true;
    setPendingChoice(choiceId);
    setLocalError(null);
    try {
      await props.onResolve(active.id, choiceId);
    } catch (error) {
      setLocalError({ eventId: active.id, choiceId, text: error instanceof Error ? error.message : 'Не удалось принять решение. Попробуй ещё раз.' });
    } finally {
      submitGuard.current = false;
      setPendingChoice(null);
    }
  }

  if (!props.eventState?.enabled || !props.eventState.unlocked) return null;

  if (!active) {
    if (!lastResolved && !nextTimeValid) return null;
    return <section className="card colonyEventCard colonyEventCooldown" aria-labelledby={`${id}-title`} data-colony-event="" data-colony-event-status="cooldown">
      {lastResolved ? <>
        <div className="colonyEventResultHeading"><GameIcon name="check" size={20} /><div><span className="colonyEventEyebrow">Событие завершено</span><h2 id={`${id}-title`}>{lastResolved.choiceTitle}</h2></div></div>
        <p className="colonyEventResultText" role="status">{lastResolved.resultText}</p>
        {amounts(lastResolved.reward).length > 0 && <div className="colonyEventResolvedAmounts"><span>Получено:</span><Amounts value={lastResolved.reward} /></div>}
        <details className="colonyEventResultDetails"><summary>Подробности: {lastResolved.title}</summary><Exchange cost={lastResolved.cost} reward={lastResolved.reward} past /></details>
      </> : <h2 id={`${id}-title`}><GameIcon name="events" />События колонии</h2>}
      {nextTimeValid && <div className="colonyEventNext"><GameIcon name="clock" size={15} /><span>{canCheckNext ? 'Проверь, появилось ли новое событие.' : `Новое событие — не раньше ${availableAt(nextAt!, now)}.`}</span>{canCheckNext && <button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Проверить события</button>}</div>}
    </section>;
  }

  return <section className="card colonyEventCard" aria-labelledby={`${id}-title`} data-colony-event={active.id} data-colony-event-key={active.key} aria-busy={pendingChoice !== null}>
    <div className="colonyEventHeading"><div><span className="colonyEventEyebrow">Событие колонии</span><h2 id={`${id}-title`}>{active.title}</h2></div><BuildingArt type={active.buildingType} /></div>
    <p className="colonyEventDescription">{active.description}</p>
    <div className="colonyEventContext"><span>Можно решить позже — событие дождётся.</span><button type="button" className="miniButton" disabled={locked} onClick={() => props.onShowBuilding(active.buildingType)}><GameIcon name="map" size={13} /> На карте</button></div>
    <div className="colonyEventChoices" role="group" aria-label="Решения события">
      {active.choices.map((choice) => {
        const evaluation = evaluateColonyChoice(choice, props.resources, props.capacities, props.completedResearch);
        const requiredResearch = evaluation.requiredResearch;
        const researchName = RESEARCH_TREE.find((item) => item.key === requiredResearch)?.name ?? 'нужную технологию';
        const shortages = Object.fromEntries(amounts(evaluation.shortages).map(([resource, amount]) => [resource, Math.ceil(amount)]));
        const storageShortages = Object.fromEntries(amounts(evaluation.storageShortages).map(([resource, amount]) => [resource, Math.ceil(amount)]));
        const error = localError?.eventId === active.id && localError.choiceId === choice.id ? localError.text : null;
        return <article className="colonyEventChoice" key={choice.id} data-event-choice={choice.id} aria-labelledby={`${id}-${choice.id}`}>
          <h3 id={`${id}-${choice.id}`}>{choice.title}</h3><p>{choice.description}</p>
          <Exchange cost={choice.cost} reward={choice.reward} />
          {requiredResearch && <div className="colonyEventRequirement"><span>Нужно исследование «{researchName}».</span><button type="button" className="miniButton" disabled={locked} onClick={() => props.onResearch(requiredResearch)}><GameIcon name="research" size={13} /> К исследованию</button></div>}
          {amounts(shortages).length > 0 && <div className="colonyEventShortage"><span>Не хватает:</span><Amounts value={shortages} /></div>}
          {amounts(storageShortages).length > 0 && <div className="colonyEventShortage"><span>На складе не хватает места для:</span><Amounts value={storageShortages} /></div>}
          <button type="button" className="action secondary colonyEventResolve" data-event-action={choice.id} disabled={locked || !evaluation.canResolve} aria-label={`Выбрать решение: ${choice.title}`} onClick={() => void resolve(choice.id)}>{pendingChoice === choice.id ? 'Применяем решение…' : 'Выбрать решение'}<GameIcon name="arrow" size={15} /></button>
          {error && <div className="notice error colonyEventError" role="alert"><div>{error}</div><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить колонию</button></div>}
        </article>;
      })}
    </div>
  </section>;
}
