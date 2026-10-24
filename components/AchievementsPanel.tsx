'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AchievementEmblem } from '@/components/AchievementEmblem';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import { progressGoalForStat, type ProgressDestination } from '@/lib/game/progress-goals';
import '@/app/achievements.css';

export type AchievementCategory = 'all' | 'growth' | 'comfort' | 'friends' | 'exploration';

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
  cosmetics?: readonly { id: string; name: string; category?: string }[];
  busy: boolean;
  onClaim: (key: string) => Promise<boolean>;
  focusCategory?: AchievementCategory;
  /** Increase for each external navigation, including a return to the same category. */
  focusRequestId?: number;
  focusKey?: string | null;
  onNavigate?: (destination: ProgressDestination) => void;
  onRefresh?: () => void;
  onOpenCollection?: () => void;
};

const PAGE_SIZE = 5;
const CATEGORIES: { key: AchievementCategory; label: string; icon: string }[] = [
  { key: 'all', label: 'Все темы', icon: 'trophy' },
  { key: 'growth', label: 'Развитие', icon: 'build' },
  { key: 'comfort', label: 'Комфорт', icon: 'comfort' },
  { key: 'friends', label: 'Друзья', icon: 'network' },
  { key: 'exploration', label: 'Экспедиции', icon: 'artifact_lens' },
];
const STATUSES: { key: AchievementStatus; label: string }[] = [
  { key: 'ready', label: 'Готово' },
  { key: 'in_progress', label: 'В процессе' },
  { key: 'claimed', label: 'Получено' },
  { key: 'all', label: 'Все' },
];

function quantity(value: number) {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function inCategory(row: AchievementRow, category: AchievementCategory) {
  if (category === 'growth') return ['buildings_started', 'foundry_jobs_started', 'contracts_completed', 'market_trades_bought', 'research_completed'].includes(row.stat);
  if (category === 'exploration') return ['expeditions_completed', 'artifacts_found', 'unique_artifacts_found'].includes(row.stat);
  return category === 'all' || row.stat === (category === 'comfort' ? 'max_comfort' : 'qualified_referrals');
}

function categoryFor(row: AchievementRow): AchievementCategory {
  return CATEGORIES.find((item) => item.key !== 'all' && inCategory(row, item.key))?.key ?? 'all';
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

function ordered(rows: AchievementRow[], locallyClaimed: ReadonlySet<string>) {
  const rank = { ready: 0, in_progress: 1, claimed: 2 };
  return [...rows].sort((left, right) => {
    const leftStatus = rowStatus(left, locallyClaimed), rightStatus = rowStatus(right, locallyClaimed);
    return rank[leftStatus] - rank[rightStatus] || (leftStatus === 'in_progress' && rightStatus === 'in_progress'
      ? progress(right).value / progress(right).target - progress(left).value / progress(left).target : 0);
  });
}

function appearanceReward(cosmeticId: string, cosmetics: Props['cosmetics']) {
  const cosmetic = cosmetics?.find((item) => item.id === cosmeticId);
  const category = cosmetic?.category ?? cosmeticId.split('_')[0];
  const types: Record<string, { label: string; icon: string }> = {
    frame: { label: 'Рамка', icon: 'palette' }, title: { label: 'Титул', icon: 'trophy' },
    theme: { label: 'Стиль колонии', icon: 'city' }, weather: { label: 'Эффект', icon: 'star' },
    effect: { label: 'Эффект', icon: 'signal' },
  };
  return { name: cosmetic?.name ?? types[category]?.label ?? 'Оформление', icon: types[category]?.icon ?? 'palette' };
}

export function AchievementsPanel({ rows, cosmetics, busy, onClaim, focusCategory = 'all', focusRequestId = 0, focusKey = null, onNavigate, onRefresh, onOpenCollection }: Props) {
  const id = useId();
  const [category, setCategory] = useState<AchievementCategory>(focusCategory);
  const [locallyClaimed, setLocallyClaimed] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<AchievementStatus>(() => initialStatus(rows, focusCategory, new Set()));
  const [page, setPage] = useState(0);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; verify?: boolean; text: string; reward?: AchievementRow['reward'] } | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ key: string; requestId: number } | null>(null);
  const claimGuard = useRef(false);
  const previousFocus = useRef<{ category: AchievementCategory; key: string | null; requestId: number } | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const previous = previousFocus.current;
    if (previous?.category === focusCategory && previous.key === focusKey && previous.requestId === focusRequestId) return;
    previousFocus.current = { category: focusCategory, key: focusKey, requestId: focusRequestId };
    const exact = focusKey ? rows.find((row) => row.key === focusKey) : null;
    const nextCategory = exact ? categoryFor(exact) : focusCategory;
    const nextStatus = exact ? rowStatus(exact, locallyClaimed) : initialStatus(rows, nextCategory, locallyClaimed);
    const matching = ordered(rows.filter((row) => inCategory(row, nextCategory) && (nextStatus === 'all' || rowStatus(row, locallyClaimed) === nextStatus)), locallyClaimed);
    setCategory(nextCategory);
    setStatus(nextStatus);
    setPage(exact ? Math.max(0, Math.floor(matching.findIndex((row) => row.key === exact.key) / PAGE_SIZE)) : 0);
    setPendingFocus(exact ? { key: exact.key, requestId: focusRequestId } : null);
  }, [focusCategory, focusKey, focusRequestId, rows, locallyClaimed]);

  const themedRows = rows.filter((row) => inCategory(row, category));
  const counts: Record<AchievementStatus, number> = { ready: 0, in_progress: 0, claimed: 0, all: themedRows.length };
  for (const row of themedRows) counts[rowStatus(row, locallyClaimed)] += 1;

  const filteredRows = ordered(themedRows.filter((row) => status === 'all' || rowStatus(row, locallyClaimed) === status), locallyClaimed);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRows = filteredRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const nearestKey = filteredRows.find((row) => rowStatus(row, locallyClaimed) === 'in_progress' && progressGoalForStat(row.stat)
    && Number.isFinite(row.target) && row.target > 0 && Number.isFinite(row.progress) && row.progress >= 0 && row.progress < row.target)?.key;
  const locked = busy || pendingKey !== null;

  useEffect(() => {
    if (!pendingFocus) return;
    const element = cardRefs.current.get(pendingFocus.key);
    if (!element) return;
    element.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    element.focus({ preventScroll: true });
    setPendingFocus(null);
  }, [pendingFocus, category, status, currentPage]);

  function chooseCategory(next: AchievementCategory) {
    setPendingFocus(null);
    setCategory(next);
    setStatus(initialStatus(rows, next, locallyClaimed));
    setPage(0);
  }

  function chooseStatus(next: AchievementStatus) {
    setPendingFocus(null);
    setStatus(next);
    setPage(0);
  }

  async function claim(row: AchievementRow) {
    if (locked || claimGuard.current || rowStatus(row, locallyClaimed) !== 'ready') return;
    claimGuard.current = true;
    setPendingKey(row.key);
    setFeedback(null);
    try {
      const confirmed = await onClaim(row.key);
      if (confirmed !== true) {
        setFeedback({ error: false, verify: true, text: 'Ответ получен. Обнови достижения, чтобы проверить выдачу награды.' });
        return;
      }
      setLocallyClaimed((previous) => new Set([...previous, row.key]));
      setFeedback({ error: false, text: `Награда «${row.title}» получена.`, reward: { ...row.reward } });
    } catch (cause) {
      setFeedback({ error: true, text: cause instanceof Error ? cause.message : 'Не удалось получить награду. Попробуй снова.' });
    } finally {
      claimGuard.current = false;
      setPendingKey(null);
    }
  }

  return <section className="card achievementsPanel" aria-labelledby={`${id}-title`} aria-busy={pendingKey !== null}>
    <div className="achievementPanelHeading"><div><h2 id={`${id}-title`}><GameIcon name="trophy" />Достижения</h2><p>Долгосрочные цели без срока. Каждую награду можно получить один раз.</p></div><span className="achievementCollectionCount" aria-label="Награды получены"><GameIcon name="check" size={13} />{quantity(rows.filter((row) => rowStatus(row, locallyClaimed) === 'claimed').length)}/{quantity(rows.length)}</span></div>

    <div className="achievementCategories" role="group" aria-label="Тема достижений">{CATEGORIES.map((item) => <button type="button" key={item.key} aria-pressed={category === item.key} onClick={() => chooseCategory(item.key)}><GameIcon name={item.icon} size={15} /><span>{item.label}</span></button>)}</div>
    <div className="achievementStatusFilters" role="group" aria-label="Состояние достижений">{STATUSES.map((item) => <button type="button" key={item.key} aria-pressed={status === item.key} onClick={() => chooseStatus(item.key)}><span>{item.label}</span><b>{quantity(counts[item.key])}</b></button>)}</div>

    {feedback && <div className={`notice achievementFeedback${feedback.error ? ' error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{!feedback.error && !feedback.verify && <GameIcon name="check" size={17} />}<div><span>{feedback.text}</span>{feedback.reward && <div className="achievementRewards" aria-label="Полученная награда">{Number(feedback.reward.crystals) > 0 && <GameAmount resource="crystals">{quantity(Number(feedback.reward.crystals))}</GameAmount>}{feedback.reward.cosmeticId && <span>{appearanceReward(feedback.reward.cosmeticId, cosmetics).name} · {feedback.reward.cosmeticDays ? `${feedback.reward.cosmeticDays} дн.` : 'навсегда'}</span>}</div>}{feedback.reward?.cosmeticId && onOpenCollection && <button type="button" className="miniButton" onClick={onOpenCollection}><GameIcon name="palette" size={14} />К полученному оформлению</button>}{(feedback.error || feedback.verify) && onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить достижения</button>}</div></div>}

    <div className="stack achievementList" data-achievement-status={status}>
      {visibleRows.map((row) => {
        const currentStatus = rowStatus(row, locallyClaimed);
        const unlocked = currentStatus !== 'in_progress', claimed = currentStatus === 'claimed';
        const reward = row.reward ?? {};
        const currentProgress = progress(row);
        const appearance = reward.cosmeticId ? appearanceReward(reward.cosmeticId, cosmetics) : null;
        const goal = progressGoalForStat(row.stat);
        return <div className={`rowCard achievementCard ${unlocked ? 'isUnlocked' : ''} ${claimed ? 'isClaimed' : ''}`} key={row.key} data-achievement={row.key} tabIndex={-1} ref={(element) => { if (element) cardRefs.current.set(row.key, element); else cardRefs.current.delete(row.key); }}>
          <AchievementEmblem achievementKey={row.key} stat={row.stat} target={row.target} unlocked={unlocked} claimed={claimed} />
          <div className="achievementCardBody">{nearestKey === row.key && <span className="achievementNearestLabel" data-achievement-nearest>Ближе к завершению</span>}<strong>{row.title}</strong>{!claimed && <small>{row.description}</small>}
            <div className="achievementRewards" aria-label={claimed ? 'Полученная награда' : 'Награда'}>{Number(reward.crystals) > 0 && <GameAmount resource="crystals">{quantity(Number(reward.crystals))}</GameAmount>}{appearance && <span className="achievementRewardAppearance"><GameIcon name={appearance.icon} size={14} /><span>{appearance.name} · {reward.cosmeticDays ? `${reward.cosmeticDays} дн. после получения` : 'навсегда'}</span></span>}</div>
            {!claimed && <div className="progress" role="progressbar" aria-label={`Прогресс: ${row.title}`} aria-valuemin={0} aria-valuemax={currentProgress.target} aria-valuenow={currentProgress.value}><i style={{ width: `${currentProgress.percent}%` }} /></div>}
            <div className="achievementCardFoot">{!claimed && <small>{quantity(currentProgress.value)}/{quantity(currentProgress.target)} · {unlocked ? 'Награда готова' : `Осталось: ${quantity(currentProgress.target - currentProgress.value)}`}</small>}{currentStatus === 'ready' && <button type="button" className="miniButton" disabled={locked} onClick={() => void claim(row)} aria-label={`Забрать награду: ${row.title}`}>{pendingKey === row.key ? 'Получаем…' : 'Забрать награду'}</button>}{claimed && <span className="achievementClaimedLabel"><GameIcon name="check" size={13} />Получено</span>}</div>
            {currentStatus === 'in_progress' && goal && <details className="achievementGoalGuide" data-achievement-guide={row.key}><summary><GameIcon name={goal.icon} size={14} /><span>Как продвинуть цель</span><GameIcon name="arrow" size={13} /></summary><p>{goal.purpose}</p><p>{goal.countHint}</p>{onNavigate && <button type="button" className="miniButton" disabled={locked} data-achievement-navigate={goal.destination} onClick={() => onNavigate(goal.destination)}>{goal.label}<GameIcon name="arrow" size={13} /></button>}</details>}
          </div>
        </div>;
      })}
    </div>

    {!visibleRows.length && <div className="achievementEmpty" role="status"><GameIcon name={status === 'ready' ? 'check' : status === 'claimed' ? 'gift' : 'target'} size={25} /><p>{!rows.length ? 'Достижения ещё не загружены. Обнови колонию, чтобы проверить цели.' : status === 'ready' ? 'Готовых наград в этой теме нет. Посмотри, какую цель можно завершить следующей.' : status === 'claimed' ? 'Здесь появятся награды, которые ты заберёшь. Они останутся в коллекции достижений.' : status === 'in_progress' ? 'В этой теме нет незавершённых целей.' : 'В этой теме пока нет достижений.'}</p>{status !== 'all' && <button type="button" className="miniButton" onClick={() => chooseStatus(status === 'ready' && counts.in_progress > 0 ? 'in_progress' : 'all')}>{status === 'ready' && counts.in_progress > 0 ? 'Посмотреть следующие цели' : 'Показать все достижения'}</button>}</div>}
    {totalPages > 1 && <nav className="achievementPagination" aria-label="Страницы достижений"><button type="button" className="miniButton" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Назад</button><span aria-live="polite">{currentPage + 1}/{totalPages}</span><button type="button" className="miniButton" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>Далее</button></nav>}
    {onOpenCollection && <button type="button" className="miniButton achievementCollectionLink" onClick={onOpenCollection}><GameIcon name="palette" size={15} />Моё оформление<GameIcon name="arrow" size={14} /></button>}
    <MechanicGuide steps={[
      'Выбери тему и цель. Прогресс сохраняется автоматически и не обнуляется со сменой дня или недели.',
      'Когда награда готова, нажми «Забрать награду». Кристаллы поступят на баланс, а оформление появится в твоей коллекции.',
      'Оформление включается в магазине → «Моё оформление». Временный доступ начисляется при получении награды; постоянные награды остаются навсегда.',
      'Оформление меняет внешний вид и не усиливает добычу или производство. Уже активный временный срок продлевается, а постоянное владение сохраняется.',
    ]} />
  </section>;
}
