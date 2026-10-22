'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import '@/app/rewards-panels.css';

type Props = {
  contracts: any[];
  info?: { enabled: boolean; nextAt: string | null };
  buildings: any[];
  resources: Record<string, unknown>;
  busy: boolean;
  onComplete: (id: string) => Promise<unknown>;
  onBuild: () => void;
  onProduction: () => void;
  onRefresh: () => void;
};
type Feedback = { id: string; error: boolean; text: string; resource?: string; amount?: number; credits?: number };

function number(value: unknown) {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function quantity(value: number) { return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }
function timeLeft(end: number, now: number) {
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return hours ? `${hours} ч. ${minutes} мин.` : minutes ? `${minutes} мин. ${seconds % 60} сек.` : `${seconds} сек.`;
}

export function ContractsPanel(props: Props) {
  const id = useId();
  const [now, setNow] = useState(() => Date.now());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const submitGuard = useRef(false);
  const locked = props.busy || pendingId !== null;
  const activeHub = props.buildings.some((building) => building.type === 'trade_hub' && building.status === 'active');
  const pendingHub = props.buildings.find((building) => building.type === 'trade_hub' && ['building', 'upgrading'].includes(building.status));
  const enabled = props.info?.enabled ?? activeHub;
  const nextAt = Date.parse(props.info?.nextAt ?? '');
  const hubEnd = Date.parse(pendingHub?.completes_at ?? '');
  const contracts = props.contracts.filter((contract) => !completedIds.has(String(contract.id)));
  const errorInList = feedback?.error && enabled && contracts.some((contract) => String(contract.id) === feedback.id);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function complete(contract: any) {
    const contractId = String(contract.id ?? '');
    const deadline = Date.parse(contract.expires_at ?? '');
    const amount = number(contract.amount);
    if (locked || submitGuard.current || !enabled || !contractId || completedIds.has(contractId)
      || !['ore', 'parts'].includes(contract.resource) || amount <= 0
      || number(props.resources[contract.resource]) < amount) return;
    if (Number.isFinite(deadline) && deadline <= Date.now()) {
      setNow(Date.now());
      setFeedback({ id: contractId, error: true, text: 'Срок контракта истёк. Обнови заказы — ресурсы не списаны.' });
      return;
    }
    submitGuard.current = true;
    setPendingId(contractId);
    setFeedback(null);
    try {
      await props.onComplete(contractId);
      setCompletedIds((previous) => new Set(previous).add(contractId));
      setFeedback({ id: contractId, error: false, text: 'Контракт выполнен.', resource: contract.resource, amount, credits: number(contract.credit_reward) });
    } catch (cause) {
      setFeedback({ id: contractId, error: true, text: cause instanceof Error ? cause.message : 'Не удалось выполнить контракт. Обнови колонию перед повтором.' });
    } finally {
      submitGuard.current = false;
      setPendingId(null);
    }
  }

  return <section className="card contractsPanel rewardsPanel" aria-labelledby={`${id}-title`} aria-busy={pendingId !== null}>
    <h2 id={`${id}-title`}><GameIcon name="contracts" />Контракты колонии</h2>
    <p>Передай заказчику руду или детали и получи кредиты на развитие. Ресурсы спишутся только при выполнении.</p>
    {!enabled ? pendingHub ? <div className="rewardEmptyState">
      <strong><GameIcon name="clock" size={16} />Торговый узел {pendingHub.status === 'upgrading' ? 'улучшается' : 'строится'}</strong>
      <p>{Number.isFinite(hubEnd) && hubEnd > now ? <>До готовности: <span role="timer" aria-live="off">{timeLeft(hubEnd, now)}</span>. Контракты появятся, когда узел начнёт работать.</> : 'Обнови колонию, чтобы проверить готовность узла и получить заказы.'}</p>
      <button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Проверить готовность узла</button>
    </div> : <div className="rewardEmptyState">
      <p>Построй торговый узел: он откроет контракты и обмен с другими игроками.</p>
      <button type="button" className="action secondary" disabled={locked} onClick={props.onBuild}>Построить торговый узел</button>
    </div> : contracts.length === 0 ? <div className="rewardEmptyState">
      <strong>Сейчас нет активных заказов</strong>
      <p>{Number.isFinite(nextAt) && nextAt > now ? <>Новые заказы — не раньше чем через <span role="timer" aria-live="off">{timeLeft(nextAt, now)}</span>. Пока можно пополнить запасы.</> : 'Торговый узел работает. Проверь, появились ли новые заказы.'}</p>
      <button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Проверить заказы</button>
    </div> : <div className="contractsList">
      {contracts.map((contract) => {
        const contractId = String(contract.id);
        const amount = number(contract.amount), credits = number(contract.credit_reward);
        const missing = Math.max(0, amount - number(props.resources[contract.resource]));
        const deadline = Date.parse(contract.expires_at ?? '');
        const expired = Number.isFinite(deadline) && deadline <= now;
        const valid = ['ore', 'parts'].includes(contract.resource) && amount > 0;
        const rowError = feedback?.error && feedback.id === contractId ? feedback.text : null;
        return <article className={`contractEntry${expired ? ' isExpired' : ''}`} key={contractId} data-contract-id={contractId} aria-labelledby={`${id}-${contractId}`}>
          <div className="rewardEntryHeading"><h3 id={`${id}-${contractId}`}>{contract.resource === 'parts' ? 'Поставка деталей' : 'Поставка руды'}</h3><span className="contractDeadline"><GameIcon name="clock" size={13} />{expired ? 'Срок истёк' : Number.isFinite(deadline) ? <span role="timer" aria-live="off">{timeLeft(deadline, now)}</span> : 'Срок проверит сервер'}</span></div>
          <div className="rewardExchange"><div><span>Спишется</span><strong><GameAmount resource={contract.resource}>{quantity(amount)}</GameAmount></strong></div><GameIcon name="arrow" size={16} /><div><span>Получишь</span><strong><GameAmount resource="credits">{quantity(credits)}</GameAmount></strong></div></div>
          {expired ? <div className="contractExpired"><p>Этот заказ уже нельзя выполнить. Обнови список заказов.</p><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить заказы</button></div> : <>
            {missing > 0 && <div className="rewardShortage"><span>Не хватает:</span><GameAmount resource={contract.resource}>{quantity(Math.ceil(missing))}</GameAmount>{contract.resource === 'parts' && <button type="button" className="miniButton" disabled={locked} onClick={props.onProduction}>К производству</button>}</div>}
            <button type="button" className="action secondary contractComplete" data-contract-action={contractId} disabled={locked || missing > 0 || !valid} onClick={() => void complete(contract)}>{pendingId === contractId ? 'Выполняем контракт…' : 'Выполнить контракт'}</button>
          </>}
          {rowError && <div className="notice error rewardFeedback" role="alert"><span>{rowError}</span><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить колонию</button></div>}
        </article>;
      })}
    </div>}
    {feedback && !feedback.error && <div className="notice rewardFeedback rewardSuccess" role="status"><GameIcon name="check" size={18} /><div><strong>{feedback.text}</strong><span>Списано: <GameAmount resource={feedback.resource ?? 'ore'}>{quantity(feedback.amount ?? 0)}</GameAmount></span><span>Получено: <GameAmount resource="credits">{quantity(feedback.credits ?? 0)}</GameAmount></span></div></div>}
    {feedback?.error && !errorInList && <div className="notice error rewardFeedback" role="alert"><span>{feedback.text}</span><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить колонию</button></div>}
  </section>;
}
