'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import '@/app/quests.css';

export type QuestPeriod = 'daily' | 'weekly';
export type QuestClaimSelection = { period: QuestPeriod; questKey: string } | { period: QuestPeriod; all: true };
export type QuestClaimResult = { period: QuestPeriod; count: number; credits: number; crystals: number; questKeys: string[] };
export type QuestDestination = 'build' | 'production' | 'contracts' | 'expeditions' | 'city';
type Quest = { id: string; quest_key: string; progress: number | string; target: number | string; crystal_reward: number | string; credit_reward: number | string; claimed_at?: unknown };
type QuestConfig = { key: string; title: string; description: string; event?: string };
type Props = {
  period: QuestPeriod;
  quests: Quest[];
  catalog: readonly QuestConfig[];
  busy: boolean;
  onClaim: (selection: QuestClaimSelection) => Promise<QuestClaimResult>;
  onNavigate: (destination: QuestDestination) => void;
  onRefresh?: () => void;
  resetsAt?: string;
};
type Feedback = { scope: string; error: boolean; text: string; result?: QuestClaimResult };

function number(value: unknown) {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function quantity(value: number) { return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }
function resetTime(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : null;
}
function validReceipt(value: unknown, period: QuestPeriod): value is QuestClaimResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return result.period === period && typeof result.count === 'number' && Number.isInteger(result.count) && result.count >= 0
    && typeof result.credits === 'number' && Number.isFinite(result.credits) && result.credits >= 0
    && typeof result.crystals === 'number' && Number.isFinite(result.crystals) && result.crystals >= 0
    && Array.isArray(result.questKeys) && result.questKeys.length === result.count
    && result.questKeys.every((key) => typeof key === 'string') && new Set(result.questKeys).size === result.count;
}
function shortcut(config: QuestConfig | undefined, questKey: string): { destination: QuestDestination; label: string; icon: string } {
  const event = config?.event ?? questKey;
  if (/build/.test(event)) return { destination: 'build', label: 'К постройкам', icon: 'build' };
  if (/foundry|smelt/.test(event)) return { destination: 'production', label: 'К производству', icon: 'parts' };
  if (/contract/.test(event)) return { destination: 'contracts', label: 'К контрактам', icon: 'market' };
  if (/expedition/.test(event)) return { destination: 'expeditions', label: 'К экспедициям', icon: 'rocket' };
  return { destination: 'city', label: 'В колонию', icon: 'city' };
}
function actionHint(event: string | undefined) {
  if (event === 'expedition_completed') return 'Зачёт — после получения результата экспедиции. Дождаться возвращения аппарата недостаточно.';
  if (event === 'foundry_started') return 'Каждый оплаченный цикл партии считается отдельной плавкой. Ждать выдачи деталей не нужно.';
  return null;
}

export function QuestPanel({ period, quests, catalog, busy, onClaim, onNavigate, onRefresh, resetsAt }: Props) {
  const id = useId();
  const [filter, setFilter] = useState<'all' | 'ready'>('all');
  const [pending, setPending] = useState<string | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const submitGuard = useRef(false);
  const scope = `${period}:${quests.map((quest) => quest.id).sort().join(',')}`;
  const locked = busy || pending !== null;
  const resetAt = Date.parse(resetsAt ?? '');
  const expired = Number.isFinite(resetAt) && resetAt <= now;

  useEffect(() => {
    const timestamp = Date.now();
    setNow(timestamp);
    if (!Number.isFinite(resetAt) || resetAt <= timestamp) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= resetAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resetAt]);

  const rows = quests.map((quest, index) => {
    const config = catalog.find((item) => item.key === quest.quest_key);
    const claimed = !!quest.claimed_at || claimedIds.has(quest.id);
    const progress = number(quest.progress), target = number(quest.target);
    const ready = !expired && !claimed && progress >= target && target > 0;
    return { quest, config, claimed, ready, progress, target, index, rank: ready ? 0 : claimed ? 2 : 1 };
  }).sort((left, right) => left.rank - right.rank || left.index - right.index);
  const ready = rows.filter((row) => row.ready);
  const claimed = rows.filter((row) => row.claimed).length;
  const unfinished = rows.length - ready.length - claimed;
  const credits = quests.reduce((sum, quest) => sum + number(quest.credit_reward), 0);
  const crystals = quests.reduce((sum, quest) => sum + number(quest.crystal_reward), 0);
  const visibleRows = filter === 'ready' ? ready : rows;
  const visibleFeedback = feedback?.scope === scope ? feedback : null;
  const nextReset = resetTime(resetsAt);

  async function claim(questKey?: string) {
    if (locked || submitGuard.current) return;
    const submittedAt = Date.now();
    if (Number.isFinite(resetAt) && resetAt <= submittedAt) {
      setNow(submittedAt);
      return;
    }
    const selected = ready.filter((row) => !questKey || row.quest.quest_key === questKey);
    if (!selected.length || (!questKey && selected.length < 2)) return;
    submitGuard.current = true;
    setPending(questKey ?? 'all');
    setFeedback(null);
    const requestScope = scope;
    try {
      const result = await onClaim(questKey ? { period, questKey } : { period, all: true });
      if (!validReceipt(result, period)) throw new Error('Обнови колонию, чтобы проверить результат получения награды.');
      const keys = new Set(result.questKeys);
      // Snapshot IDs keep a response from hiding tomorrow's identically named quests.
      setClaimedIds((previous) => new Set([...previous, ...selected.filter((row) => keys.has(row.quest.quest_key)).map((row) => row.quest.id)]));
      setFeedback({ scope: requestScope, error: false, text: result.count ? `Получено наград: ${quantity(result.count)}.` : 'Новых наград не выдано. Обнови задания, чтобы проверить текущий набор.', result });
    } catch (cause) {
      setFeedback({ scope: requestScope, error: true, text: cause instanceof Error ? cause.message : 'Не удалось получить награду. Повтори попытку.' });
    } finally {
      submitGuard.current = false;
      setPending(null);
    }
  }

  return <section className="card questPanel" data-quest-panel={period} data-quest-period-state={expired ? 'expired' : 'current'} aria-labelledby={`${id}-title`} aria-busy={pending !== null}>
    <div className="questPanelHeading"><h2 id={`${id}-title`}><GameIcon name="missions" />{period === 'daily' ? 'Ежедневные задания' : 'Недельные задания'}</h2><span className="questPeriod">{expired ? 'Прошлый набор' : period === 'daily' ? 'На сегодня' : 'На эту неделю'}</span></div>
    <p>{expired ? 'Награды показанного набора' : 'Награды всех заданий'}: <GameAmount resource="crystals">{quantity(crystals)}</GameAmount> и <GameAmount resource="credits">{quantity(credits)}</GameAmount>.</p>
    <p className="questReset">{nextReset ? <>Обновление: <time dateTime={resetsAt}>{nextReset}</time></> : 'Обновление по времени сервера'}</p>
    {expired && <div className="questPeriodNotice" data-quest-period-expired role="status"><strong><GameIcon name="clock" size={16} />Период завершился</strong><p>Здесь показан прошлый набор. Обнови колонию, чтобы увидеть актуальные задания и проверить награды.</p>{onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить задания<GameIcon name="arrow" size={13} /></button>}</div>}
    <div className="questCounts" aria-label="Состояние заданий"><span className={expired ? undefined : 'questReadyCount'}>Готово к сбору <strong data-quest-ready-count>{ready.length}</strong></span><span>{expired ? 'Требуют обновления' : 'В процессе'} <strong>{unfinished}</strong></span><span>{expired ? 'Получено в этом наборе' : 'Получено'} <strong>{claimed}/{rows.length}</strong></span></div>
    {ready.length >= 2 && <div className="questBulk"><div><strong>Готовы {ready.length} награды</strong><span><GameAmount resource="credits">{quantity(ready.reduce((sum, row) => sum + number(row.quest.credit_reward), 0))}</GameAmount><GameAmount resource="crystals">{quantity(ready.reduce((sum, row) => sum + number(row.quest.crystal_reward), 0))}</GameAmount></span></div><button type="button" className="action secondary" data-quest-claim-all disabled={locked} onClick={() => void claim()}>{pending === 'all' ? 'Получаем награды…' : 'Собрать готовые'}</button></div>}
    {visibleFeedback && <div className={`notice questFeedback${visibleFeedback.error ? ' error' : ''}`} data-quest-feedback role={visibleFeedback.error ? 'alert' : 'status'}><span>{visibleFeedback.text}</span>{(visibleFeedback.error || visibleFeedback.result?.count === 0) && onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить задания</button>}{!visibleFeedback.error && !!visibleFeedback.result?.count && <strong><GameAmount resource="credits">{quantity(visibleFeedback.result.credits)}</GameAmount><GameAmount resource="crystals">{quantity(visibleFeedback.result.crystals)}</GameAmount></strong>}</div>}
    {rows.length > 0 && <div className="questFilters" role="group" aria-label="Показать задания"><button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Все · {rows.length}</button><button type="button" className={filter === 'ready' ? 'active' : ''} aria-pressed={filter === 'ready'} onClick={() => setFilter('ready')}>Готовые · {ready.length}</button></div>}
    {visibleRows.length ? <div className="questList">{visibleRows.map(({ quest, config, claimed: received, ready: done, progress, target }) => {
      const action = shortcut(config, quest.quest_key);
      const hint = actionHint(config?.event);
      const percent = Math.min(100, Math.round(progress / Math.max(1, target) * 100));
      return <article key={quest.id} className={`questEntry${done ? ' isReady' : received ? ' isClaimed' : expired ? ' isExpired' : ''}`} data-quest-key={quest.quest_key} data-quest-status={received ? 'claimed' : expired ? 'expired' : done ? 'ready' : 'progress'} aria-labelledby={`${id}-${quest.id}`}>
        <div className="questEntryHeading"><h3 id={`${id}-${quest.id}`}>{config?.title ?? quest.quest_key}</h3><span className="questStatus"><GameIcon name={received ? 'check' : done ? 'gift' : 'clock'} size={13} />{received ? 'Получено' : expired ? 'Период завершён' : done ? 'Награда готова' : 'В процессе'}</span></div>
        {!received && <>{config?.description && <p>{config.description}</p>}{!expired && hint && <p className="questActionHint" data-quest-action-hint>{hint}</p>}
          <div className="questProgress" role="progressbar" aria-label={config?.title ?? quest.quest_key} aria-valuemin={0} aria-valuemax={Math.max(1, target)} aria-valuenow={Math.min(progress, Math.max(1, target))}><i style={{ width: `${percent}%` }} /></div>
          <div className="questProgressText"><span>{quantity(Math.min(progress, target))}/{quantity(target)}</span><span>{expired ? 'Данные прошлого периода' : done ? 'Можно забрать награду' : `Осталось: ${quantity(Math.max(0, target - progress))}`}</span></div>
        </>}
        <div className="questEntryFoot"><div className="questReward" aria-label={received ? 'Полученная награда' : expired ? 'Награда прошлого периода' : 'Награда'}><GameAmount resource="credits">{quantity(number(quest.credit_reward))}</GameAmount><GameAmount resource="crystals">{quantity(number(quest.crystal_reward))}</GameAmount></div>{!received && (expired ? <span className="questExpiredAction">Обнови задания</span> : done ? <button type="button" className="miniButton questClaim" data-quest-claim={quest.quest_key} disabled={locked} onClick={() => void claim(quest.quest_key)}>{pending === quest.quest_key ? 'Получаем…' : 'Забрать награду'}</button> : <button type="button" className="miniButton questNavigate" data-quest-navigate={action.destination} disabled={locked} onClick={() => onNavigate(action.destination)}><GameIcon name={action.icon} size={13} />{action.label}<GameIcon name="arrow" size={13} /></button>)}</div>
      </article>;
    })}</div> : <div className="questEmpty" role="status">{expired ? 'Период этого набора завершился. Обнови задания, чтобы проверить новый набор.' : !rows.length ? 'Задания ещё не загружены. Проверь соединение и обнови колонию.' : claimed === rows.length ? 'Все награды получены. Новые задания появятся в следующем периоде.' : 'Пока нет готовых наград. Продолжай выполнять задания.'}{rows.length > 0 ? <button type="button" className="miniButton" onClick={() => setFilter('all')}>{expired ? 'Показать прошлый набор' : 'Показать все задания'}</button> : !expired && onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить задания</button>}</div>}
    <MechanicGuide steps={[
      'Выполняй указанное действие. Прогресс засчитывается автоматически; кнопка в карточке открывает нужный раздел.',
      'Готовую награду нужно забрать. «Собрать готовые» выдаёт только награды выполненных заданий, без дополнительного бонуса за набор.',
      period === 'daily' ? 'Набор обновляется со сменой игрового дня по времени сервера. Забери готовые награды до обновления; время выше показано в часовом поясе устройства.' : 'Набор обновляется со сменой игровой недели по времени сервера. Забери готовые награды до обновления; время выше показано в часовом поясе устройства.',
    ]} />
  </section>;
}
