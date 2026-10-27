'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { BuildingArt } from '@/components/BuildingArt';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import { RESEARCH_TREE } from '@/lib/game/research';
import { evaluateColonyChoice, type ColonyEventDefinition } from '@/lib/game/colony-events';
import { colonyEventResourceActions, colonyEventResourceGuidance, validColonyEventReceipt, type ColonyEventReceipt } from '@/lib/game/colony-event-guidance';
import type { ProgressDestination } from '@/lib/game/progress-goals';
import '@/app/colony-events.css';

type ResourceAmounts = Record<string, number | undefined>;
type ActiveEvent = { id: string; createdAt: string } & ColonyEventDefinition;
type Props = {
  eventState?: {
    enabled: boolean;
    unlocked: boolean;
    active: ActiveEvent | null;
    lastResolved: ColonyEventReceipt | null;
    nextAt: string | null;
  };
  resources: Record<string, unknown>;
  capacities: Partial<Record<'ore' | 'energy' | 'parts', number>>;
  completedResearch: string[];
  busy: boolean;
  onResolve: (eventId: string, choiceId: string) => Promise<unknown>;
  onShowBuilding: (type: string) => void;
  onResearch: (key: string) => void;
  onRefresh: () => unknown | Promise<unknown>;
  onNavigate?: (destination: ProgressDestination) => void;
  playerKey?: string;
};
type Attempt = { owner: string; event: ActiveEvent; choiceId: string; generation: number };
type Feedback = Attempt & { error?: string; result?: ColonyEventReceipt; resolvedElsewhere?: boolean };
type RefreshRequest = { owner: string; generation: number };

function amounts(value: ResourceAmounts) {
  return Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0);
}
function quantity(value: number) { return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }
function Amounts({ value }: { value: ResourceAmounts }) {
  return <>{amounts(value).map(([resource, amount]) => <GameAmount key={resource} resource={resource}>{quantity(amount)}</GameAmount>)}</>;
}
function Exchange({ cost, reward, past = false, id }: { cost: ResourceAmounts; reward: ResourceAmounts; past?: boolean; id?: string }) {
  return <span className="colonyEventExchange" id={id}>
    <span><span>{past ? 'Списано' : 'Затраты'}</span><strong>{amounts(cost).length ? <Amounts value={cost} /> : <span>Без затрат</span>}</strong></span>
    <GameIcon name="arrow" size={15} />
    <span><span>{past ? 'Получено' : 'Награда'}</span><strong>{amounts(reward).length ? <Amounts value={reward} /> : <span>Без награды</span>}</strong></span>
  </span>;
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
  const owner = props.playerKey ?? '';
  const active = props.eventState?.active;
  const lastResolved = props.eventState?.lastResolved;
  const [selection, setSelection] = useState<{ owner: string; eventId: string; choiceId: string } | null>(null);
  const [pending, setPending] = useState<Attempt | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [checking, setChecking] = useState<RefreshRequest | null>(null);
  const [refreshError, setRefreshError] = useState<(RefreshRequest & { text: string }) | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const submitGuard = useRef<Attempt | null>(null);
  const refreshGuard = useRef<RefreshRequest | null>(null);
  const mounted = useRef(true);
  const boundary = useRef({ owner, eventId: active?.id, lastId: lastResolved?.id, generation: 0 });
  const previousBoundary = boundary.current;
  const identityChanged = previousBoundary.owner !== owner
    || (active?.id ? active.id !== previousBoundary.eventId && active.id !== previousBoundary.lastId
      : previousBoundary.eventId ? lastResolved?.id !== previousBoundary.eventId : lastResolved?.id !== previousBoundary.lastId);
  boundary.current = { owner, eventId: active?.id, lastId: lastResolved?.id, generation: previousBoundary.generation + (identityChanged ? 1 : 0) };
  function belongs(attempt: Attempt | null) {
    const current = boundary.current;
    return !!attempt && attempt.owner === current.owner && attempt.generation === current.generation
      && (attempt.event.id === current.eventId || (!current.eventId && attempt.event.id === current.lastId));
  }
  function currentRefresh(request: RefreshRequest | null) {
    return !!request && request.owner === boundary.current.owner && request.generation === boundary.current.generation;
  }
  const visibleFeedback = belongs(feedback) ? feedback : null;
  const visiblePending = belongs(pending) ? pending : null;
  const uncertain = !!visibleFeedback?.error;
  const receipt = visibleFeedback?.result;
  const visibleChecking = currentRefresh(checking);
  const locked = props.busy || !!visiblePending || visibleChecking;
  const nextAt = props.eventState?.nextAt;
  const nextAtMs = nextAt ? new Date(nextAt).getTime() : NaN;
  const nextTimeValid = !!nextAt && Number.isFinite(nextAtMs);
  const canCheckNext = nextTimeValid && nextAtMs <= now;
  const selected = selection?.owner === owner && selection.eventId === active?.id
    ? active?.choices.find(choice => choice.id === selection.choiceId) : undefined;
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!selected || !detailRef.current) return;
    detailRef.current.focus({ preventScroll: true });
    detailRef.current.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [selection]);
  useEffect(() => {
    if (active || !nextTimeValid) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [active?.id, nextAt, nextTimeValid]);

  function navigate(destination: ProgressDestination) {
    if (props.onNavigate) props.onNavigate(destination);
    else if (destination === 'research') props.onShowBuilding('research_lab');
    else if (destination === 'production') props.onShowBuilding('foundry');
    else if (destination === 'build') props.onShowBuilding('hq');
  }
  function preview(choiceId: string) {
    if (!active) return;
    setSelection({ owner, eventId: active.id, choiceId });
  }
  async function verifyRefresh() {
    if (locked || currentRefresh(refreshGuard.current) || belongs(submitGuard.current)) return;
    const request: RefreshRequest = { owner, generation: boundary.current.generation };
    const attempt = visibleFeedback?.error ? visibleFeedback : null;
    refreshGuard.current = request;
    setChecking(request);
    setRefreshError(null);
    try {
      const reply = await props.onRefresh();
      if (!mounted.current || !currentRefresh(request) || !attempt || !belongs(attempt)) return;
      const fresh = reply && typeof reply === 'object' && !Array.isArray(reply) && 'playerKey' in reply && reply.playerKey === owner && 'eventState' in reply
        ? reply.eventState : null;
      if (fresh && typeof fresh === 'object' && !Array.isArray(fresh) && 'enabled' in fresh && fresh.enabled === true && 'unlocked' in fresh && fresh.unlocked === true && 'active' in fresh) {
        const freshActive = fresh.active;
        if (freshActive && typeof freshActive === 'object' && 'id' in freshActive && freshActive.id === attempt.event.id && boundary.current.eventId === attempt.event.id) {
          setFeedback(null);
          return;
        }
        if (!freshActive && 'lastResolved' in fresh) {
          const confirmed = attempt.event.choices.filter(choice => validColonyEventReceipt(fresh.lastResolved, attempt.event, choice.id));
          if (confirmed.length === 1) {
            setFeedback({ ...attempt, error: undefined, result: fresh.lastResolved as ColonyEventReceipt, resolvedElsewhere: confirmed[0].id !== attempt.choiceId });
            return;
          }
        }
      }
      setRefreshError({ ...request, text: 'Обновление пока не подтвердило состояние события. Прежнее решение можно проверить ещё раз.' });
    } catch {
      if (mounted.current && currentRefresh(request) && attempt && belongs(attempt)) setRefreshError({ ...request, text: 'Не удалось обновить данные. Прежний результат пока не подтверждён; попробуй проверить его ещё раз.' });
    } finally {
      if (refreshGuard.current === request) {
        refreshGuard.current = null;
        if (mounted.current) setChecking(null);
      }
    }
  }
  async function resolve(choiceId: string, retry = false) {
    const event = retry ? visibleFeedback?.event : active;
    if (!event || locked || belongs(submitGuard.current) || currentRefresh(refreshGuard.current) || receipt) return;
    if (retry && (!uncertain || visibleFeedback?.choiceId !== choiceId)) return;
    if (!retry && uncertain) return;
    const choice = event.choices.find(item => item.id === choiceId);
    if (!choice || (!retry && !evaluateColonyChoice(choice, props.resources, props.capacities, props.completedResearch).canResolve)) return;
    const attempt: Attempt = { owner, event, choiceId, generation: boundary.current.generation };
    submitGuard.current = attempt;
    setPending(attempt);
    setRefreshError(null);
    if (!retry) setFeedback(null);
    try {
      const reply = await props.onResolve(event.id, choiceId);
      if (!mounted.current || !belongs(attempt)) return;
      const result = reply && typeof reply === 'object' && !Array.isArray(reply) && 'ok' in reply && reply.ok === true && 'result' in reply ? reply.result : undefined;
      if (!validColonyEventReceipt(result, event, choiceId)) throw new Error('Ответ не подтвердил результат решения. Обнови колонию или повторно проверь это же решение.');
      setFeedback({ ...attempt, result });
    } catch (error) {
      if (mounted.current && belongs(attempt)) setFeedback({ ...attempt, error: error instanceof Error ? error.message : 'Результат решения пока не подтверждён. Обнови колонию или попробуй ещё раз.' });
    } finally {
      if (submitGuard.current === attempt) {
        submitGuard.current = null;
        if (mounted.current) setPending(null);
      }
    }
  }

  const feedbackView = uncertain && visibleFeedback ? <div className="notice error colonyEventError" role="alert" data-event-feedback="unconfirmed">
    <strong>Проверь решение «{visibleFeedback.event.choices.find(choice => choice.id === visibleFeedback.choiceId)?.title}»</strong>
    <span>{visibleFeedback.error}</span><small>Пока результат не подтверждён, другое решение не применяется. Проверка того же решения не спишет ресурсы повторно.</small>
    {currentRefresh(refreshError) && <small data-event-refresh-error role="status">{refreshError?.text}</small>}
    <div className="colonyEventActions"><button type="button" className="miniButton" disabled={locked} onClick={() => void verifyRefresh()}>{visibleChecking ? 'Обновляем…' : 'Обновить колонию'}</button><button type="button" className="miniButton" disabled={locked} onClick={() => void resolve(visibleFeedback.choiceId, true)}>{visiblePending ? 'Проверяем…' : 'Проверить это решение'}</button></div>
  </div> : null;
  const result = receipt ?? (!uncertain ? lastResolved : null);
  const resultView = result ? <div data-event-receipt={result.id}>
    {visibleFeedback?.resolvedElsewhere && <p className="colonyEventSafety" role="status">При обновлении подтверждено другое решение. Ниже показан фактический результат события.</p>}
    <div className="colonyEventResultHeading"><GameIcon name="check" size={20} /><div><span className="colonyEventEyebrow">Событие завершено</span><h2 id={`${id}-title`}>{result.choiceTitle}</h2></div></div>
    <p className="colonyEventResultText" role="status">{result.resultText}</p>
    <Exchange cost={result.cost} reward={result.reward} past />
    <div className="colonyEventBenefit">{colonyEventResourceGuidance(result.reward).map(guidance => <p key={guidance.resource}>{guidance.purpose}</p>)}</div>
    <div className="colonyEventActions">{colonyEventResourceActions(result.reward).map(action => <button key={action.destination} type="button" className="miniButton" onClick={() => navigate(action.destination)}><GameIcon name={action.icon} size={14} />{action.label}</button>)}</div>
    <details className="colonyEventResultDetails"><summary>Какое событие решено<GameIcon name="arrow" size={13} /></summary><p>{result.title}. Это разовая награда; обычная выработка зданий не изменилась.</p></details>
  </div> : null;

  if (!props.eventState?.enabled || !props.eventState.unlocked) {
    const disabled = !props.eventState?.enabled;
    return <section className="card colonyEventCard colonyEventEmpty" data-colony-event="" data-colony-event-status={disabled ? 'disabled' : 'locked'} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}><GameIcon name="events" />События колонии</h2>
      <p>{disabled ? 'События пока недоступны. Остальные возможности колонии продолжают работать.' : 'Заверши первые шаги и улучши центр колонии до уровня 2. Затем здесь появятся ситуации с тремя решениями и разовыми наградами.'}</p>
      <p className="colonyEventSafety">За отсутствие в игре нет потерь. Решение всегда принимаешь ты.</p>
      <div className="colonyEventActions">{!disabled && <button type="button" className="miniButton" onClick={() => props.onNavigate ? navigate('city') : props.onShowBuilding('hq')}>К первым шагам</button>}<button type="button" className="miniButton" disabled={locked} onClick={() => void verifyRefresh()}>{visibleChecking ? 'Обновляем…' : 'Проверить события'}</button></div>
    </section>;
  }

  if (!active || receipt) return <section className="card colonyEventCard colonyEventCooldown" aria-labelledby={`${id}-title`} data-colony-event="" data-colony-event-status={nextTimeValid ? 'cooldown' : result || uncertain ? 'cooldown-unknown' : 'empty'} aria-busy={!!visiblePending || visibleChecking}>
    {resultView ?? <h2 id={`${id}-title`}><GameIcon name="events" />{uncertain ? 'Проверка решения' : 'В колонии спокойно'}</h2>}
    {feedbackView}
    {!result && !uncertain && <p>Ситуации появляются у действующих шахт, электростанций, цехов и научных центров. Можно развивать колонию дальше и проверить события позже.</p>}
    <div className="colonyEventNext"><GameIcon name="clock" size={15} /><span>{nextTimeValid ? canCheckNext ? 'Проверь, появилось ли новое событие.' : `Новое событие — не раньше ${availableAt(nextAt!, now)}.` : result ? 'Время следующего события пока не подтверждено. Обнови колонию.' : 'События не требуют постоянного присутствия и не останавливают производство.'}</span>{(!nextTimeValid || canCheckNext) && <button type="button" className="miniButton" disabled={locked} onClick={() => void verifyRefresh()}>{visibleChecking ? 'Обновляем…' : 'Проверить события'}</button>}</div>
    {!result && !uncertain && <div className="colonyEventActions"><button type="button" className="miniButton" onClick={() => props.onNavigate ? navigate('build') : props.onShowBuilding('mine')}>К постройкам</button></div>}
  </section>;

  const evaluation = selected ? evaluateColonyChoice(selected, props.resources, props.capacities, props.completedResearch) : null;
  const shortages = evaluation ? Object.fromEntries(amounts(evaluation.shortages).map(([resource, amount]) => [resource, Math.ceil(amount)])) : {};
  const storageShortages = evaluation ? Object.fromEntries(amounts(evaluation.storageShortages).map(([resource, amount]) => [resource, Math.ceil(amount)])) : {};
  const requiredResearch = evaluation?.requiredResearch;
  const researchName = RESEARCH_TREE.find(item => item.key === requiredResearch)?.name ?? 'нужную технологию';

  return <section className="card colonyEventCard" aria-labelledby={`${id}-title`} data-colony-event={active.id} data-colony-event-key={active.key} aria-busy={!!visiblePending || visibleChecking}>
    <div className="colonyEventHeading"><div><span className="colonyEventEyebrow">Событие колонии · разовая выгода</span><h2 id={`${id}-title`}>{active.title}</h2></div><BuildingArt type={active.buildingType} /></div>
    <p className="colonyEventDescription">{active.description}</p>
    <div className="colonyEventContext"><span>Событие дождётся. Производство работает без потерь.</span><button type="button" className="miniButton" onClick={() => props.onShowBuilding(active.buildingType)}><GameIcon name="map" size={13} />На карте</button></div>
    <p className="colonyEventChoiceHint">Сравни решения и открой подробности. Просмотр бесплатный.</p>
    <div className="colonyEventChoices" role="group" aria-label="Сравнение решений события">{active.choices.map(choice => {
      const ready = evaluateColonyChoice(choice, props.resources, props.capacities, props.completedResearch).canResolve;
      return <button type="button" className={`colonyEventPreview${selected?.id === choice.id ? ' isSelected' : ''}`} key={choice.id} data-event-preview={choice.id} aria-pressed={selected?.id === choice.id} aria-controls={`${id}-choice-detail`} aria-describedby={`${id}-${choice.id}-exchange`} aria-label={`Посмотреть решение: ${choice.title}`} onClick={() => preview(choice.id)}>
        <span className="colonyEventChoiceHeading"><strong>{choice.title}</strong><span className={`colonyEventChoiceStatus${ready ? ' isReady' : ''}`}><GameIcon name={ready ? 'check' : 'lock'} size={12} />{ready ? 'Доступно' : 'Подготовка'}</span></span><Exchange cost={choice.cost} reward={choice.reward} id={`${id}-${choice.id}-exchange`} /><span className="colonyEventPreviewAction">{selected?.id === choice.id ? 'Подробности открыты' : 'Открыть решение'}<GameIcon name="arrow" size={13} /></span>
      </button>;
    })}</div>
    {feedbackView}
    <div id={`${id}-choice-detail`} className="colonyEventDetail" ref={detailRef} tabIndex={-1} data-event-detail={selected?.id ?? ''}>
      {selected && evaluation ? <article className="colonyEventChoice" data-event-choice={selected.id} aria-labelledby={`${id}-selected-title`}>
        <h3 id={`${id}-selected-title`}>{selected.title}</h3><p>{selected.description}</p>
        <div className="colonyEventBenefit">{colonyEventResourceGuidance(selected.reward).map(guidance => <p key={guidance.resource}>{guidance.purpose}</p>)}</div>
        {requiredResearch && <div className="colonyEventRequirement"><span>Нужно исследование «{researchName}».</span><button type="button" className="miniButton" onClick={() => props.onResearch(requiredResearch)}><GameIcon name="research" size={13} />К исследованию</button></div>}
        {amounts(shortages).length > 0 && <div className="colonyEventPreparation"><div className="colonyEventShortage"><span>Не хватает:</span><Amounts value={shortages} /></div><div className="colonyEventActions">
          {!!shortages.ore && <button type="button" className="miniButton" onClick={() => props.onShowBuilding('mine')}>К добыче руды</button>}{!!shortages.energy && <button type="button" className="miniButton" onClick={() => props.onShowBuilding('solar')}>К выработке энергии</button>}{!!shortages.parts && <button type="button" className="miniButton" onClick={() => navigate('production')}>К производству деталей</button>}{!!shortages.credits && props.onNavigate && <button type="button" className="miniButton" onClick={() => navigate('contracts')}>К контрактам</button>}{!!shortages.science && <button type="button" className="miniButton" onClick={() => navigate('research')}>К исследованиям</button>}
        </div></div>}
        {amounts(storageShortages).length > 0 && <div className="colonyEventPreparation"><div className="colonyEventShortage"><span>Освободи место на складе:</span><Amounts value={storageShortages} /></div><p>Можно потратить запасы на развитие или увеличить хранилище. Награда должна поместиться целиком.</p><button type="button" className="miniButton" onClick={() => props.onShowBuilding('warehouse')}>К хранилищу</button></div>}
        <Exchange cost={selected.cost} reward={selected.reward} />
        <button type="button" className="action secondary colonyEventResolve" data-event-action={selected.id} disabled={locked || uncertain || !evaluation.canResolve} aria-label={`Применить решение: ${selected.title}`} onClick={() => void resolve(selected.id)}>{visiblePending?.choiceId === selected.id ? 'Применяем решение…' : amounts(selected.cost).length ? 'Потратить ресурсы и применить' : 'Применить без затрат'}<GameIcon name="arrow" size={15} /></button>
        {!uncertain && !evaluation.canResolve && <small className="colonyEventSafety">Подготовь колонию или сравни другие решения. У события есть вариант без затрат.</small>}
        <details className="colonyEventResultDetails"><summary>Куда использовать награду<GameIcon name="arrow" size={13} /></summary><div className="colonyEventActions">{colonyEventResourceActions(selected.reward).map(action => <button key={action.destination} type="button" className="miniButton" onClick={() => navigate(action.destination)}><GameIcon name={action.icon} size={14} />{action.label}</button>)}</div><p>Переход бесплатный и не применяет решение.</p></details>
      </article> : <p className="colonyEventSelectionEmpty">Выбери карточку выше, чтобы увидеть пользу награды и способы подготовки. Сам выбор карточки ничего не тратит.</p>}
    </div>
    <MechanicGuide title="Правила событий" steps={[
      'У каждого события три решения. Применяется одно, только после явного нажатия кнопки. Всегда есть вариант без затрат.',
      'Награда разовая: она пополняет запас ресурсов, но не повышает скорость добычи. Отдельная плавка события не меняет очередь цеха.',
      'Решение события не даёт SP сезона и не считается обычной плавкой, контрактом или исследованием для заданий.',
      'За отсутствие в игре нет потерь: событие дождётся, а производство продолжит работу. Следующее событие появляется не раньше чем через 12 часов после решения.',
    ]} />
  </section>;
}
