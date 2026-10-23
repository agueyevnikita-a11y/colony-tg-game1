'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { BuildingArt } from '@/components/BuildingArt';
import { ArtifactArt } from '@/components/ArtifactArt';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import { ARTIFACTS, EXPEDITIONS, artifactDropChance, type ArtifactId, type ExpeditionKey } from '@/lib/game/expeditions';
import { RESEARCH_TREE } from '@/lib/game/research';
import { FEATURE_RESEARCH } from '@/lib/game/unlocks';
import { quoteExpeditionSettlement } from '@/lib/game/expedition-quote';
import { durationText as duration } from '@/lib/game/format';
import '@/app/expeditions-panel.css';

export type ArtifactExpeditionFocus = { routeKey: ExpeditionKey; artifactId: ArtifactId; requestId: number };

type Props = {
  expeditions: any;
  resources: Record<string, unknown>;
  capacities: Partial<Record<'ore' | 'energy' | 'parts', number>>;
  hqLevel: number;
  featureEnabled: boolean;
  busy: boolean;
  accessUnlocked?: boolean;
  artifactFocus?: ArtifactExpeditionFocus | null;
  onArtifacts?: () => void;
  onStart: (key: string) => Promise<unknown>;
  onResolve: (id: string, choiceId?: string) => Promise<unknown>;
  onBuild: () => void;
  onUpgradeHq: () => void;
  onResearch: (key: string) => void;
  onRefresh: () => void;
};

type Values = Record<string, any>;
type Feedback = { target: string; text: string; error: boolean };
const RESOURCES = ['ore', 'energy', 'parts', 'credits', 'science', 'crystals'];
function record(value: unknown): Values { return value && typeof value === 'object' && !Array.isArray(value) ? value as Values : {}; }
function entries(value: unknown) {
  const source = record(value);
  return RESOURCES.flatMap((resource): [string, number][] => {
    const amount = Number(source[resource] ?? 0);
    return Number.isFinite(amount) && amount > 0 ? [[resource, amount]] : [];
  });
}
function number(value: number) { return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }
function Amounts({ value, empty = 'Без затрат' }: { value: unknown; empty?: string }) {
  const values = entries(value);
  return <span className="xpAmounts">{values.length ? values.map(([resource, amount]) => <GameAmount key={resource} resource={resource}>{number(amount)}</GameAmount>) : empty}</span>;
}
function ArtifactNames({ ids }: { ids: unknown[] }) {
  const counts = new Map<string, number>();
  for (const value of ids) if (typeof value === 'string' && value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return <>{[...counts].map(([artifactId, count]) => <span className="xpArtifact" key={artifactId} data-artifact-id={artifactId}><ArtifactArt artifactId={artifactId} size={28} /><span>{ARTIFACTS.find((item) => item.id === artifactId)?.name ?? 'Неизвестный артефакт'}{count > 1 ? ` ×${count}` : ''}</span></span>)}</>;
}
function Receipt({ result }: { result: Values }) {
  return <div className="xpReceiptContents"><div><span className="xpMetaLabel">Получено</span><Amounts value={result} empty="Без ресурсной награды" /></div>
    <ArtifactNames ids={[result.artifactId, result.extraArtifactId]} />
    {entries(result.cost).length > 0 && <div className="xpReceiptCost"><span>Списано за решение:</span><Amounts value={result.cost} /></div>}
  </div>;
}
function ClaimWarnings({ quote, onRefresh, disabled }: { quote: ReturnType<typeof quoteExpeditionSettlement>; onRefresh: () => void; disabled: boolean }) {
  const missingResources = entries(quote.shortages).length > 0;
  const missingStorage = entries(quote.storageShortages).length > 0;
  return <>
    {missingResources && <div className="xpWarning"><span>Не хватает для решения:</span><Amounts value={quote.shortages} /></div>}
    {missingStorage && <div className="xpWarning"><span>Освободи место на складе ещё для:</span><Amounts value={quote.storageShortages} /><small>Полная добыча останется у экспедиции до получения.</small></div>}
    {!quote.canClaim && !missingResources && !missingStorage && <div className="xpFeedback isError"><span>Данные добычи пришли не полностью. Обнови их перед получением.</span><button type="button" className="miniButton" disabled={disabled} onClick={onRefresh}>Обновить добычу</button></div>}
  </>;
}

export function ExpeditionsPanel(props: Props) {
  const id = useId();
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [receipt, setReceipt] = useState<{ runId: string; name: string; result: Values } | null>(null);
  const guard = useRef(false);
  const focusedRouteRef = useRef<HTMLElement>(null);
  const handledFocus = useRef<ArtifactExpeditionFocus | null>(null);
  const data = record(props.expeditions);
  const runs: any[] = Array.isArray(data.runs) ? data.runs : [];
  const catalog: any[] = Array.isArray(data.catalog) ? data.catalog : [];
  const recent: any[] = Array.isArray(data.recent) ? data.recent.slice(0, 3) : [];
  const hasActive = runs.some((run) => run.status === 'active');
  const locked = props.busy || pending !== null;
  const slots = Math.max(1, Number(data.slots ?? 1));
  const activeCount = Number(data.activeCount ?? runs.length);
  const slotsFull = activeCount >= slots;
  const returnedCount = runs.filter((run) => run.status === 'ready' || run.status === 'event').length;
  const accessLocked = props.accessUnlocked === false;
  const focusedArtifact = props.artifactFocus && artifactDropChance(props.artifactFocus.routeKey, props.artifactFocus.artifactId) > 0
    ? ARTIFACTS.find(artifact => artifact.id === props.artifactFocus?.artifactId) : undefined;
  const focusedRouteAvailable = !!focusedArtifact && catalog.some(option => option.key === props.artifactFocus?.routeKey);

  useEffect(() => {
    if (!props.artifactFocus) { handledFocus.current = null; return; }
    if (!focusedRouteAvailable || !focusedRouteRef.current || handledFocus.current === props.artifactFocus) return;
    handledFocus.current = props.artifactFocus;
    focusedRouteRef.current.focus({ preventScroll: true });
    focusedRouteRef.current.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [props.artifactFocus, focusedRouteAvailable]);

  useEffect(() => {
    if (!hasActive) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  function expeditionName(run: any) {
    return run.config?.name ?? EXPEDITIONS.find((item) => item.key === run.expedition_key)?.name ?? 'Экспедиция';
  }
  function notice(target: string) {
    if (feedback?.target !== target) return null;
    return <div className={`xpFeedback ${feedback.error ? 'isError' : 'isSuccess'}`} role={feedback.error ? 'alert' : 'status'}><span>{feedback.text}</span>{feedback.error && <button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить данные</button>}</div>;
  }
  async function start(option: any) {
    if (locked || guard.current || accessLocked || !props.featureEnabled || !data.enabled || !option.unlocked || slotsFull) return;
    const launchQuote = quoteExpeditionSettlement({}, {}, option.cost ?? {}, props.resources, props.capacities);
    if (!launchQuote.canClaim) return;
    const target = `start:${option.key}`;
    guard.current = true; setPending(target); setFeedback(null);
    try { await props.onStart(option.key); setFeedback({ target, text: `«${option.name}» отправлена. Ресурсы за запуск списаны.`, error: false }); }
    catch (error) { setFeedback({ target, text: error instanceof Error ? error.message : 'Не удалось отправить экспедицию.', error: true }); }
    finally { guard.current = false; setPending(null); }
  }
  async function resolve(run: any, choice?: any) {
    if (locked || guard.current || !run.baseReward || !['ready', 'event'].includes(run.status)) return;
    const quote = quoteExpeditionSettlement(run.baseReward, choice?.reward ?? {}, choice?.cost ?? {}, props.resources, props.capacities);
    if (!quote.canClaim || (run.status === 'event' && !choice)) return;
    const target = `resolve:${run.id}:${choice?.id ?? ''}`;
    guard.current = true; setPending(target); setFeedback(null);
    try {
      const response = record(await props.onResolve(run.id, choice?.id));
      const result = record(response.result ?? (RESOURCES.some((key) => key in response) ? response : null));
      if (Object.keys(result).length) setReceipt({ runId: run.id, name: expeditionName(run), result });
      else setFeedback({ target, text: 'Результат принят. Обнови данные, чтобы увидеть сохранённую выдачу.', error: false });
    } catch (error) { setFeedback({ target, text: error instanceof Error ? error.message : 'Не удалось получить результат экспедиции.', error: true }); }
    finally { guard.current = false; setPending(null); }
  }

  return <section className="card expeditionsPanel" aria-labelledby={`${id}-title`} data-expeditions-panel="">
    <div className="xpHeading"><div><h2 id={`${id}-title`}><GameIcon name="rocket" size={22} /> Экспедиции</h2><p>Выбирай маршрут, отправляй аппарат и получай добычу после возвращения.</p></div><BuildingArt type="expedition_center" /></div>
    <div className="xpSlots"><span>Занято слотов: <strong>{activeCount} из {slots}</strong></span><small>{returnedCount > 0 ? 'Забери добычу вернувшихся экспедиций, чтобы освободить их слоты.' : slotsFull ? 'После возвращения забери добычу, чтобы освободить слот.' : `Свободно слотов: ${Math.max(0, slots - activeCount)}. Выбери маршрут для нового вылета.`}</small></div>
    <MechanicGuide steps={[
      'Просмотр маршрутов бесплатный. Кнопка «Отправить экспедицию» списывает указанную стоимость запуска и занимает один слот.',
      'После возвращения забери всю добычу. Если встретилось событие, выбери решение: его стоимость и итоговая награда показаны у кнопки.',
      'Добыча ждёт получения и не пропадает за время отсутствия. При нехватке места освободи склад; слот останется занят до получения результата.',
    ]} />
    {!props.featureEnabled && <div className="xpPause" role="status">Новые запуски временно приостановлены. Результаты отправленных экспедиций можно получить.</div>}
    {receipt && <div className="xpReceipt" data-expedition-receipt={receipt.runId} role="status"><strong><GameIcon name="check" size={16} /> «{receipt.name}» завершена</strong><Receipt result={receipt.result} /></div>}
    {feedback?.target.startsWith('resolve:') && !runs.some((run) => feedback.target.startsWith(`resolve:${run.id}:`)) && notice(feedback.target)}

    {runs.length > 0 && <div className="xpRuns" aria-label="Отправленные экспедиции">{runs.map((run) => {
      const endsAt = new Date(run.completes_at).getTime();
      const elapsed = Number.isFinite(endsAt) && endsAt <= now;
      const hasReward = run.baseReward && typeof run.baseReward === 'object' && !Array.isArray(run.baseReward);
      const eventChoices = Array.isArray(run.event?.choices) ? run.event.choices : [];
      const quote = quoteExpeditionSettlement(run.baseReward ?? {}, {}, {}, props.resources, props.capacities);
      const claimTarget = `resolve:${run.id}:`;
      return <article className={`xpRun is-${run.status}`} key={run.id} data-expedition-run={run.id} aria-labelledby={`${id}-${run.id}`}>
        <div className="xpRunHeading"><h3 id={`${id}-${run.id}`}><GameIcon name="rocket" size={16} />{expeditionName(run)}</h3><span>{run.status === 'active' ? 'В пути' : run.status === 'event' ? 'Нужно решение' : 'Вернулась'}</span></div>
        {run.status === 'active' ? <div className="xpRunWait"><GameIcon name="clock" size={16} /><span>{elapsed ? 'Время вылета вышло. Обнови данные, чтобы проверить возвращение.' : Number.isFinite(endsAt) ? `До возвращения: ${duration((endsAt - now) / 1000)}.` : 'Обнови данные, чтобы проверить время возвращения.'}</span>{(elapsed || !Number.isFinite(endsAt)) && <button className="miniButton" type="button" disabled={locked} onClick={props.onRefresh}>Проверить возвращение</button>}</div> : !hasReward ? <div className="xpRunWait"><span>Обнови данные, чтобы увидеть точную добычу перед получением.</span><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить добычу</button></div> : <>
          <div className="xpReturnedLoot"><span className="xpMetaLabel">Добыча экспедиции</span><Amounts value={run.baseReward} empty="Без ресурсной добычи" /><ArtifactNames ids={[run.baseArtifactId]} /></div>
          {run.status === 'ready' && <><ClaimWarnings quote={quote} onRefresh={props.onRefresh} disabled={locked} /><button type="button" className="action xpClaim" disabled={locked || !quote.canClaim} data-expedition-action={`claim:${run.id}`} onClick={() => void resolve(run)}>{pending === claimTarget ? 'Получаем добычу…' : 'Забрать всю добычу'}<GameIcon name="arrow" size={16} /></button>{notice(claimTarget)}</>}
          {run.status === 'event' && run.event && eventChoices.length > 0 && <div className="xpEvent"><h4>{run.event.title}</h4><p>{run.event.description}</p><div className="xpEventChoices">{eventChoices.map((choice: any) => {
            const settlement = quoteExpeditionSettlement(run.baseReward, choice.reward ?? {}, choice.cost ?? {}, props.resources, props.capacities);
            const target = `resolve:${run.id}:${choice.id}`;
            return <article className="xpEventChoice" key={choice.id} data-expedition-choice={choice.id}>
              <h5>{choice.title}</h5><div className="xpChoiceExchange"><div><span className="xpMetaLabel">Спишется за решение</span><Amounts value={choice.cost} /></div><div><span className="xpMetaLabel">Дополнительно за решение</span><Amounts value={choice.reward} empty="Без ресурсной награды" /><ArtifactNames ids={[choice.reward?.artifactId]} /></div></div>
              <div className="xpChoiceTotal"><span className="xpMetaLabel">Получишь всего</span><Amounts value={settlement.reward} empty="Без ресурсной награды" /><ArtifactNames ids={[run.baseArtifactId, choice.reward?.artifactId]} /></div>
              <ClaimWarnings quote={settlement} onRefresh={props.onRefresh} disabled={locked} /><button type="button" className="action secondary xpClaim" disabled={locked || !settlement.canClaim} aria-label={`Принять решение: ${choice.title}`} data-expedition-action={`${run.id}:${choice.id}`} onClick={() => void resolve(run, choice)}>{pending === target ? 'Применяем решение…' : 'Выбрать и получить добычу'}<GameIcon name="arrow" size={15} /></button>{notice(target)}
            </article>;
          })}</div></div>}
          {run.status === 'event' && (!run.event || eventChoices.length === 0) && <div className="xpFeedback isError"><span>Решения события пока недоступны. Обнови данные перед выбором.</span><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить событие</button></div>}
        </>}
      </article>;
    })}</div>}

    <div className="xpCatalog"><h3>Выбрать маршрут</h3>{catalog.length === 0 && <div className="xpRunWait"><span>Список маршрутов пока недоступен.</span><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить маршруты</button></div>}{catalog.map((option) => {
      const launchQuote = quoteExpeditionSettlement({}, {}, option.cost ?? {}, props.resources, props.capacities);
      const shortages = launchQuote.shortages;
      const missingResources = entries(shortages).length > 0;
      const hqLocked = props.hqLevel < Number(option.unlockHq ?? 3);
      const centerLocked = !data.enabled;
      const researchLocked = !hqLocked && !centerLocked && !option.unlocked && option.requiredResearch;
      const researchName = RESEARCH_TREE.find((item) => item.key === option.requiredResearch)?.name ?? 'нужная технология';
      const gateText = accessLocked ? `Нужно исследование «${FEATURE_RESEARCH.expeditions.name}».` : hqLocked ? `Нужна база ур. ${option.unlockHq}.` : centerLocked ? 'Нужен действующий центр экспедиций.' : researchLocked ? `Нужно исследование «${researchName}».` : !option.unlocked ? String(option.lockReason ?? 'Маршрут пока недоступен.').replace(/HQ(\d+)/g, 'база ур. $1') : '';
      const target = `start:${option.key}`;
      const reward = record(option.reward);
      const isFocused = !!focusedArtifact && option.key === props.artifactFocus?.routeKey;
      return <article className={`xpRoute${isFocused ? ' isArtifactTarget' : ''}`} key={option.key} ref={isFocused ? focusedRouteRef : undefined} tabIndex={isFocused ? -1 : undefined} data-expedition-catalog={option.key} aria-labelledby={`${id}-route-${option.key}`}>
        <div className="xpRouteHeading"><h4 id={`${id}-route-${option.key}`}><GameIcon name="rocket" size={18} />{option.name}</h4><span><GameIcon name="clock" size={13} />{duration(Number(option.durationSec ?? 0))}</span></div>
        {isFocused && <div className="xpArtifactTarget"><ArtifactArt artifactId={focusedArtifact.id} size={40} /><div><strong>Ищем: {focusedArtifact.name}</strong><span>Шанс этой находки за вылет: {(artifactDropChance(option.key, focusedArtifact.id) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%. Находка не гарантирована.</span>{props.onArtifacts && <button type="button" className="miniButton" onClick={props.onArtifacts}>К коллекции<GameIcon name="arrow" size={13} /></button>}</div></div>}
        <div className="xpRouteRewards"><span className="xpMetaLabel">Базовая добыча за вылет</span><div>{['ore', 'credits', 'science'].flatMap((resource) => Array.isArray(reward[resource]) ? [<GameAmount key={resource} resource={resource}>{number(Number(reward[resource][0]))}–{number(Number(reward[resource][1]))}</GameAmount>] : [])}</div>
          {Array.isArray(reward.crystals) && Number(reward.crystalsChance) > 0 && <small><GameAmount resource="crystals">{number(Number(reward.crystals[0]))}–{number(Number(reward.crystals[1]))}</GameAmount> · шанс {Math.round(Number(reward.crystalsChance) * 100)}%</small>}
        </div>
        <details className="xpRouteDetails"><summary>О маршруте и шансах находок<GameIcon name="arrow" size={14} /></summary><p>{option.description}</p><div className="xpProbabilities"><span><GameIcon name="artifact_lens" size={18} />Шанс артефакта: {Math.round(Number(option.artifactChance ?? 0) * 100)}%</span><span>Шанс события: {Math.round(Number(option.eventChance ?? 0) * 100)}%</span></div><p>Исследования могут увеличить науку. Диапазоны и шансы указаны за один вылет; точная добыча станет известна после возвращения.</p></details>
        <div className="xpLaunchCost"><span className="xpMetaLabel">Спишется при запуске</span><Amounts value={option.cost} /></div>
        {gateText && <div className="xpGate"><span>{gateText}</span>{accessLocked ? <button type="button" className="miniButton" disabled={locked} onClick={() => props.onResearch(FEATURE_RESEARCH.expeditions.researchKey)}>Показать исследование</button> : hqLocked ? <button type="button" className="miniButton" disabled={locked} onClick={props.onUpgradeHq}>Показать улучшение базы</button> : centerLocked ? <button type="button" className="miniButton" disabled={locked} onClick={props.onBuild}>Показать центр экспедиций</button> : researchLocked ? <button type="button" className="miniButton" disabled={locked} onClick={() => props.onResearch(option.requiredResearch)}>Показать исследование</button> : null}</div>}
        {missingResources && <div className="xpWarning"><span>Не хватает для запуска:</span><Amounts value={shortages} /></div>}
        {!launchQuote.canClaim && !missingResources && <div className="xpFeedback isError"><span>Стоимость запуска пришла не полностью.</span><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить маршруты</button></div>}
        {slotsFull && <p className="xpLaunchBlocker">{returnedCount > 0 ? 'Получи добычу вернувшейся экспедиции, чтобы освободить слот.' : 'Дождись возвращения экспедиции и забери добычу, чтобы освободить слот.'}</p>}
        <button type="button" className="action secondary xpLaunch" disabled={locked || accessLocked || !props.featureEnabled || !option.unlocked || centerLocked || hqLocked || slotsFull || !launchQuote.canClaim} data-expedition-start={option.key} onClick={() => void start(option)}>{pending === target ? 'Отправляем…' : !props.featureEnabled ? 'Запуски приостановлены' : gateText ? 'Маршрут пока недоступен' : slotsFull ? 'Все слоты заняты' : missingResources ? 'Не хватает ресурсов' : 'Отправить экспедицию'}<GameIcon name="arrow" size={15} /></button>
        {notice(target)}
      </article>;
    })}</div>

    {recent.length > 0 && <details className="xpHistory"><summary>Последние возвращения · {recent.length}</summary><ol>{recent.map((run) => {
      const result = record(run.result);
      return <li key={run.id} data-expedition-recent={run.id}><strong>{expeditionName(run)}</strong>{Object.keys(result).length ? <Receipt result={result} /> : <p>Результат получен ранее. Подробная выдача для этой старой экспедиции не сохранена.</p>}</li>;
    })}</ol></details>}
  </section>;
}
