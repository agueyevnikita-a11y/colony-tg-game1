'use client';

import { useId, useRef, useState } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import '@/app/rewards-panels.css';

type Props = {
  dailyLogin: any;
  busy: boolean;
  onClaim: () => Promise<unknown>;
  onRefresh: () => void;
};

function number(value: unknown) {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function quantity(value: number) { return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }

export function DailyLoginPanel({ dailyLogin, busy, onClaim, onRefresh }: Props) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [claimedKey, setClaimedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; error: boolean; text: string } | null>(null);
  const submitGuard = useRef(false);
  const today = dailyLogin?.today;
  const rewardKey = today ? String(today.reward_date ?? `${today.streak_number ?? dailyLogin?.streak?.current_streak ?? 1}:${today.cycle_day ?? 1}`) : '';
  const claimed = !!today?.claimed_at || (!!rewardKey && claimedKey === rewardKey);
  const locked = busy || pending;
  const visibleFeedback = feedback?.key === rewardKey ? feedback : null;
  const credits = number(today?.credit_reward), crystals = number(today?.crystal_reward);

  async function claim() {
    if (!today || claimed || locked || submitGuard.current) return;
    submitGuard.current = true;
    setPending(true);
    setFeedback(null);
    try {
      await onClaim();
      setClaimedKey(rewardKey);
      setFeedback({ key: rewardKey, error: false, text: 'Награда за вход получена.' });
    } catch (cause) {
      setFeedback({ key: rewardKey, error: true, text: cause instanceof Error ? cause.message : 'Не удалось получить награду. Обнови колонию перед повтором.' });
    } finally {
      submitGuard.current = false;
      setPending(false);
    }
  }

  return <section className="card dailyLoginCard dailyLoginPanel rewardsPanel" aria-labelledby={`${id}-title`} aria-busy={pending}>
    <div className="cardTitleRow"><div><h2 id={`${id}-title`}><GameIcon name="star" />Серия входов · {quantity(number(dailyLogin?.streak?.current_streak ?? 1))} дн.</h2><p>Небольшая ежедневная награда за возвращение. После 7-го дня цикл наград начинается заново, а серия продолжается.</p></div><span className="pill">рекорд {quantity(number(dailyLogin?.streak?.longest_streak ?? 1))}</span></div>
    {today ? <div className="dailyRewardContent">
      <div className="dailyRewardSummary"><span>День {number(today.cycle_day ?? 1)}/7</span><strong><GameAmount resource="credits">{quantity(credits)}</GameAmount>{crystals > 0 && <GameAmount resource="crystals">{quantity(crystals)}</GameAmount>}</strong></div>
      {claimed ? <div className="rewardClaimed" role="status"><GameIcon name="check" size={17} />Награда получена. Следующая — при входе в новый день.</div> : <button type="button" className="action secondary" data-daily-claim disabled={locked} onClick={() => void claim()}>{pending ? 'Получаем награду…' : 'Забрать награду'}</button>}
    </div> : <div className="rewardEmptyState"><p>Награда за сегодняшний вход ещё не загружена. Обнови колонию, чтобы проверить её.</p><button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Проверить награду</button></div>}
    {visibleFeedback && <div className={`notice rewardFeedback${visibleFeedback.error ? ' error' : ''}`} role={visibleFeedback.error ? 'alert' : 'status'}><span>{visibleFeedback.text}</span>{visibleFeedback.error && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить колонию</button>}</div>}
  </section>;
}
