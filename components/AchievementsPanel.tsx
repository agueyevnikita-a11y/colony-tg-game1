'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AchievementEmblem } from '@/components/AchievementEmblem';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import '@/app/achievements.css';

export type AchievementCategory = 'all' | 'comfort' | 'friends' | 'exploration';

export type AchievementRow = {
  key: string;
  title: string;
  description: string;
  stat: string;
  target: number;
  progress: number;
  reward?: { crystals?: number; cosmeticId?: string; cosmeticDays?: number };
  status?: { claimed_at?: string | null } | null;
};

type AchievementStatus = 'ready' | 'in_progress' | 'claimed' | 'all';

type Props = {
  rows: AchievementRow[];
  busy: boolean;
  onClaim: (key: string) => Promise<void>;
  focusCategory?: AchievementCategory;
  /** Increase for each external navigation, including a return to the same category. */
  focusRequestId?: number;
  onOpenCollection?: () => void;
};

const PAGE_SIZE = 5;
const CATEGORIES: { key: AchievementCategory; label: string; icon: string }[] = [
  { key: 'all', label: 'Все темы', icon: 'trophy' },
  { key: 'comfort', label: 'Комфорт', icon: 'comfort' },
  { key: 'friends', label: 'Друзья', icon: 'network' },
  { key: 'exploration', label: 'Экспедиции', icon: 'artifact_lens' },
];
const STATUSES: { key: AchievementStatus; label: string }[] = [
  { key: 'ready', label: 'Готовы' },
  { key: 'in_progress', label: 'В процессе' },
  { key: 'claimed', label: 'Получены' },
  { key: 'all', label: 'Все' },
];

function quantity(value: number) {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function inCategory(row: AchievementRow, category: AchievementCategory) {
  if (category === 'exploration') return ['expeditions_completed', 'artifacts_found', 'unique_artifacts_found'].includes(row.stat);
  return category === 'all' || row.stat === (category === 'comfort' ? 'max_comfort' : 'qualified_referrals');
}

function rowStatus(row: AchievementRow, locallyClaimed: ReadonlySet<string>): Exclude<AchievementStatus, 'all'> {
  if (row.status?.claimed_at || locallyClaimed.has(row.key)) return 'claimed';
  return row.status ? 'ready' : 'in_progress';
}

function initialStatus(rows: AchievementRow[], category: AchievementCategory, locallyClaimed: ReadonlySet<string>): AchievementStatus {
  const themed = rows.filter((row) => inCategory(row, category));
  if (themed.some((row) => rowStatus(row, locallyClaimed) === 'ready')) return 'ready';
  if (themed.some((row) => rowStatus(row, locallyClaimed) === 'in_progress')) return 'in_progress';
  return themed.length ? 'claimed' : 'all';
}

function progress(row: AchievementRow) {
  const target = Math.max(1, Number(row.target) || 1);
  const value = Math.min(target, Math.max(0, Number(row.progress) || 0));
  return { target, value, percent: Math.round(value / target * 100) };
}

export function AchievementsPanel({ rows, busy, onClaim, focusCategory = 'all', focusRequestId = 0, onOpenCollection }: Props) {
  const id = useId();
  const [category, setCategory] = useState<AchievementCategory>(focusCategory);
  const [locallyClaimed, setLocallyClaimed] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<AchievementStatus>(() => initialStatus(rows, focusCategory, new Set()));
  const [page, setPage] = useState(0);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const claimGuard = useRef(false);
  const previousFocus = useRef({ category: focusCategory, requestId: focusRequestId });

  useEffect(() => {
    if (previousFocus.current.category === focusCategory && previousFocus.current.requestId === focusRequestId) return;
    previousFocus.current = { category: focusCategory, requestId: focusRequestId };
    setCategory(focusCategory);
    setStatus(initialStatus(rows, focusCategory, locallyClaimed));
    setPage(0);
  }, [focusCategory, focusRequestId, rows, locallyClaimed]);

  const themedRows = rows.filter((row) => inCategory(row, category));
  const counts: Record<AchievementStatus, number> = { ready: 0, in_progress: 0, claimed: 0, all: themedRows.length };
  for (const row of themedRows) counts[rowStatus(row, locallyClaimed)] += 1;

  const order = { ready: 0, in_progress: 1, claimed: 2 };
  const filteredRows = themedRows.filter((row) => status === 'all' || rowStatus(row, locallyClaimed) === status).sort((left, right) => {
    const leftStatus = rowStatus(left, locallyClaimed), rightStatus = rowStatus(right, locallyClaimed);
    return order[leftStatus] - order[rightStatus] || (leftStatus === 'in_progress' && rightStatus === 'in_progress' ? progress(right).percent - progress(left).percent : 0);
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRows = filteredRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const locked = busy || pendingKey !== null;

  function chooseCategory(next: AchievementCategory) {
    setCategory(next);
    setStatus(initialStatus(rows, next, locallyClaimed));
    setPage(0);
  }

  function chooseStatus(next: AchievementStatus) {
    setStatus(next);
    setPage(0);
  }

  async function claim(row: AchievementRow) {
    if (locked || claimGuard.current || rowStatus(row, locallyClaimed) !== 'ready') return;
    claimGuard.current = true;
    setPendingKey(row.key);
    setFeedback(null);
    try {
      await onClaim(row.key);
      setLocallyClaimed((previous) => new Set([...previous, row.key]));
      setFeedback({ error: false, text: `Награда «${row.title}» получена.` });
    } catch (cause) {
      setFeedback({ error: true, text: cause instanceof Error ? cause.message : 'Не удалось получить награду. Попробуй снова.' });
    } finally {
      claimGuard.current = false;
      setPendingKey(null);
    }
  }

  return <section className="card achievementsPanel" aria-labelledby={`${id}-title`} aria-busy={pendingKey !== null}>
    <div className="achievementPanelHeading"><div><h2 id={`${id}-title`}><GameIcon name="trophy" />Достижения</h2><p>Развивай колонию и забирай кристаллы и оформление. Готовые награды показаны первыми.</p></div><span className="achievementCollectionCount"><GameIcon name="check" size={13} />{quantity(rows.filter((row) => rowStatus(row, locallyClaimed) === 'claimed').length)}/{quantity(rows.length)}</span></div>

    <div className="achievementCategories" role="group" aria-label="Тема достижений">{CATEGORIES.map((item) => <button type="button" key={item.key} aria-pressed={category === item.key} onClick={() => chooseCategory(item.key)}><GameIcon name={item.icon} size={15} /><span>{item.label}</span></button>)}</div>
    <div className="achievementStatusFilters" role="group" aria-label="Состояние достижений">{STATUSES.map((item) => <button type="button" key={item.key} aria-pressed={status === item.key} onClick={() => chooseStatus(item.key)}><span>{item.label}</span><b>{quantity(counts[item.key])}</b></button>)}</div>

    {feedback && <div className={`notice achievementFeedback${feedback.error ? ' error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{!feedback.error && <GameIcon name="check" size={17} />}<span>{feedback.text}</span></div>}

    <div className="stack achievementList" data-achievement-status={status}>
      {visibleRows.map((row) => {
        const currentStatus = rowStatus(row, locallyClaimed);
        const unlocked = currentStatus !== 'in_progress', claimed = currentStatus === 'claimed';
        const reward = row.reward ?? {};
        const currentProgress = progress(row);
        return <div className={`rowCard achievementCard ${unlocked ? 'isUnlocked' : ''} ${claimed ? 'isClaimed' : ''}`} key={row.key} data-achievement={row.key}>
          <AchievementEmblem achievementKey={row.key} stat={row.stat} target={row.target} unlocked={unlocked} claimed={claimed} />
          <div className="achievementCardBody"><strong>{row.title}</strong><small>{row.description}</small>
            <div className="achievementRewards">{Number(reward.crystals) > 0 && <GameAmount resource="crystals">{quantity(Number(reward.crystals))}</GameAmount>}{reward.cosmeticId && <span className="achievementRewardAppearance"><GameIcon name="palette" size={14} />Оформление · {reward.cosmeticDays ? `${reward.cosmeticDays} дн.` : 'навсегда'}</span>}</div>
            <div className="progress" role="progressbar" aria-label={`Прогресс: ${row.title}`} aria-valuemin={0} aria-valuemax={currentProgress.target} aria-valuenow={currentProgress.value}><i style={{ width: `${currentProgress.percent}%` }} /></div>
            <div className="achievementCardFoot"><small>{quantity(currentProgress.value)}/{quantity(currentProgress.target)} · {claimed ? 'Награда получена' : unlocked ? 'Награда готова' : 'В процессе'}</small>{currentStatus === 'ready' && <button type="button" className="miniButton" disabled={locked} onClick={() => void claim(row)} aria-label={`Забрать награду: ${row.title}`}>{pendingKey === row.key ? 'Получаем…' : 'Забрать'}</button>}{claimed && <span className="achievementClaimedLabel"><GameIcon name="check" size={13} />Получено</span>}</div>
          </div>
        </div>;
      })}
    </div>

    {!visibleRows.length && <div className="achievementEmpty"><GameIcon name={status === 'ready' ? 'check' : status === 'claimed' ? 'gift' : 'target'} size={25} /><p>{status === 'ready' ? 'Все готовые награды в этой теме уже получены. Посмотри, какую цель можно завершить следующей.' : status === 'claimed' ? 'Здесь появятся награды, которые ты заберёшь. Они останутся в коллекции достижений.' : status === 'in_progress' ? 'В этой теме нет незавершённых целей.' : 'В этой теме пока нет достижений.'}</p>{status !== 'all' && <button type="button" className="miniButton" onClick={() => chooseStatus(status === 'ready' && counts.in_progress > 0 ? 'in_progress' : 'all')}>{status === 'ready' && counts.in_progress > 0 ? 'Посмотреть следующие цели' : 'Показать все достижения'}</button>}</div>}
    {totalPages > 1 && <nav className="achievementPagination" aria-label="Страницы достижений"><button type="button" className="miniButton" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Назад</button><span aria-live="polite">{currentPage + 1}/{totalPages}</span><button type="button" className="miniButton" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>Далее</button></nav>}
    <p className="achievementPanelHint">Оформление после получения можно включить в магазине, в разделе «Моё оформление». Срок действия указан рядом с наградой.</p>
    {onOpenCollection && <button type="button" className="miniButton achievementCollectionLink" onClick={onOpenCollection}><GameIcon name="palette" size={15} />Моё оформление<GameIcon name="arrow" size={14} /></button>}
  </section>;
}
