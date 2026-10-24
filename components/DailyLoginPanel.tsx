'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import { dailyLoginClaimResult, isRewardPeriodExpired } from '@/lib/game/daily-login-claim';
import '@/app/rewards-panels.css';

type Props = {
  dailyLogin: any;
  busy: boolean;
  onClaim: () => Promise<unknown>;
  onRefresh: () => void;
  resetsAt?: string;
};

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

export function DailyLoginPanel({ dailyLogin, busy, onClaim, onRefresh, resetsAt }: Props) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [claimedKey, setClaimedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; relatedKey?: string; error: boolean; text: string; credits?: number; crystals?: number; refresh?: boolean } | null>(null);
  const [uncertainSnapshot, setUncertainSnapshot] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const submitGuard = useRef(false);
  const uncertainSnapshotRef = useRef<unknown>(null);
  const today = dailyLogin?.today;
  const rewardKey = today ? String(today.reward_date ?? `${today.streak_number ?? dailyLogin?.streak?.current_streak ?? 1}:${today.cycle_day ?? 1}`) : '';
  const claimed = !!today?.claimed_at || (!!rewardKey && claimedKey === rewardKey);
  const locked = busy || pending;
  const visibleFeedback = feedback?.key === rewardKey || feedback?.relatedKey === rewardKey ? feedback : null;
  const credits = number(today?.credit_reward), crystals = number(today?.crystal_reward);
  const nextReset = resetTime(resetsAt);
  const expired = isRewardPeriodExpired(resetsAt, now);
  // A new server snapshot can confirm a result. Keeping the original object
  // here avoids trapping a freshly checked, still-unclaimed reward forever.
  const requiresCheck = uncertainSnapshot !== null && uncertainSnapshot === today;

  useEffect(() => {
    const deadline = Date.parse(resetsAt ?? '');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (Number.isFinite(deadline) && deadline > timestamp) timer = setTimeout(check, Math.min(deadline - timestamp, 2_147_483_647));
    };
    check();
    return () => clearTimeout(timer);
  }, [resetsAt]);

  async function claim() {
    if (!today || claimed || locked || requiresCheck || uncertainSnapshotRef.current === today || submitGuard.current) return;
    const submittedAt = Date.now();
    if (isRewardPeriodExpired(resetsAt, submittedAt)) { setNow(submittedAt); return; }
    submitGuard.current = true;
    setPending(true);
    setFeedback(null);
    setUncertainSnapshot(null);
    uncertainSnapshotRef.current = null;
    try {
      const result = dailyLoginClaimResult(await onClaim(), today.reward_date);
      if (result.status === 'received') {
        setClaimedKey(rewardKey);
        setFeedback({ key: rewardKey, error: false, text: 'Награда за вход получена.', credits: result.credits, crystals: result.crystals });
      } else if (result.status === 'day_changed') {
        uncertainSnapshotRef.current = today;
        setUncertainSnapshot(today);
        setFeedback({ key: rewardKey, relatedKey: result.rewardDate, error: false, refresh: true, text: 'Ответ пришёл за другой игровой день. Обнови колонию, чтобы проверить награду и баланс; повторять получение сейчас не нужно.' });
      } else {
        uncertainSnapshotRef.current = today;
        setUncertainSnapshot(today);
        setFeedback({ key: rewardKey, error: false, refresh: true, text: 'Запрос завершён, но результат награды не подтверждён. Обнови колонию, чтобы проверить получение и баланс.' });
      }
    } catch (cause) {
      uncertainSnapshotRef.current = today;
      setUncertainSnapshot(today);
      setFeedback({ key: rewardKey, error: true, text: cause instanceof Error ? cause.message : 'Не удалось получить награду. Обнови колонию перед повтором.' });
    } finally {
      submitGuard.current = false;
      setPending(false);
    }
  }

  return <section className="card dailyLoginCard dailyLoginPanel rewardsPanel" data-daily-period-state={expired ? 'expired' : 'current'} aria-labelledby={`${id}-title`} aria-busy={pending}>
    <div className="cardTitleRow"><div><h2 id={`${id}-title`}><GameIcon name="gift" />Награда за вход</h2><p>Возвращайся в колонию и забирай награду каждый день.</p></div><span className="pill">Серия · {quantity(number(dailyLogin?.streak?.current_streak ?? 0))} дн.</span></div>
    {expired ? <div className="rewardEmptyState" data-daily-period-expired role="status"><strong><GameIcon name="clock" size={17} />Игровой день сменился</strong><p>Показанные данные относятся к прошлому дню. Обнови колонию, чтобы проверить новую награду и серию входов.</p><button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Проверить награду нового дня</button></div> : today ? <div className="dailyRewardContent">
      <div className="dailyRewardSummary"><span>День цикла {number(today.cycle_day ?? 1)}/7</span><strong><GameAmount resource="credits">{quantity(credits)}</GameAmount>{crystals > 0 && <GameAmount resource="crystals">{quantity(crystals)}</GameAmount>}</strong></div>
      {claimed ? <div className="rewardClaimed" role="status"><GameIcon name="check" size={17} />Получено. Вернись в следующий игровой день.</div> : requiresCheck ? <button type="button" className="action secondary" data-daily-check-result disabled={locked} onClick={onRefresh}>Проверить результат награды</button> : <button type="button" className="action secondary" data-daily-claim disabled={locked} onClick={() => void claim()}>{pending ? 'Получаем награду…' : 'Забрать награду'}</button>}
      <p className="dailyReset">{nextReset ? <>Следующий день: <time dateTime={resetsAt}>{nextReset}</time></> : 'Новый день — по времени сервера'}</p>
    </div> : <div className="rewardEmptyState"><p>Награда за сегодняшний вход ещё не загружена. Обнови колонию, чтобы проверить её.</p><button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Проверить награду</button></div>}
    {visibleFeedback && <div className={`notice rewardFeedback${visibleFeedback.error ? ' error' : ''}`} data-daily-feedback role={visibleFeedback.error ? 'alert' : 'status'}><span>{visibleFeedback.text}</span>{visibleFeedback.credits !== undefined && <strong><GameAmount resource="credits">{quantity(visibleFeedback.credits)}</GameAmount>{Number(visibleFeedback.crystals) > 0 && <GameAmount resource="crystals">{quantity(Number(visibleFeedback.crystals))}</GameAmount>}</strong>}{(visibleFeedback.error || visibleFeedback.refresh) && !requiresCheck && !expired && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить колонию</button>}</div>}
    <MechanicGuide steps={[
      'Зайди в колонию и нажми «Забрать награду» до смены игрового дня. Время выше получено от сервера и показано в часовом поясе устройства.',
      'После 7-го дня набор наград повторяется, а серия входов продолжается. Если пропустить день, серия начнётся с первого дня; уже полученные награды останутся.',
      `Твой рекорд: ${quantity(number(dailyLogin?.streak?.longest_streak ?? 0))} дн. Серия растёт за входы в соседние дни, а не за нажатия кнопки награды.`,
    ]} />
  </section>;
}
