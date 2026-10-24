'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import { durationText } from '@/lib/game/format';
import type { SeasonReward } from '@/lib/game/season';
import { SEASON_POINT_SOURCES, nextSeasonQuestGoal } from '@/lib/game/season-goals';
import { validSeasonClaimReceipt } from '@/lib/game/season-reward-receipt';
import type { ProgressDestination } from '@/lib/game/progress-goals';
import type { QuestSnapshot, QuestCatalogEntry } from '@/lib/game/quest-guidance';
import type { SeasonClaimRequest, SeasonClaimResult } from '@/lib/server/season';
import '@/app/season-panel.css';

export type { SeasonClaimRequest, SeasonClaimResult } from '@/lib/server/season';
export type SeasonState = {
  id: string;
  title: string;
  subtitle?: string;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  points: number | string;
  claims?: { level: number | string; claimed_at?: string | Date }[];
  rewards: SeasonReward[];
};
type Destination = 'city' | 'build' | 'market' | 'missions' | 'shop' | 'social';
type Props = {
  season?: SeasonState | null;
  busy: boolean;
  onClaim: (body: SeasonClaimRequest) => Promise<SeasonClaimResult>;
  onNavigate: (tab: Destination, section: string) => void;
  onRefresh: () => void;
  cosmetics?: readonly { id: string; name: string; category?: string }[];
  questPeriods?: { daily?: QuestPeriodSnapshot; weekly?: QuestPeriodSnapshot };
  onAction?: (destination: ProgressDestination) => void;
};
type QuestPeriodSnapshot = { quests: readonly QuestSnapshot[]; catalog: readonly QuestCatalogEntry[]; resetsAt?: string };
type Filter = 'all' | 'ready' | 'locked' | 'claimed';
const PAGE_SIZE = 5;
const FILTERS: { key: Filter; label: string }[] = [{ key: 'all', label: 'Все' }, { key: 'ready', label: 'Готовы' }, { key: 'locked', label: 'Впереди' }, { key: 'claimed', label: 'Получены' }];
const ACTION_SECTIONS: Record<ProgressDestination, [Destination, string]> = {
  city: ['city', 'map'], build: ['build', 'buildings'], production: ['city', 'production'], contracts: ['city', 'contracts'],
  research: ['build', 'research'], expeditions: ['build', 'expeditions'], artifacts: ['build', 'artifacts'], friends: ['social', 'friends'],
  market: ['market', 'buy'], decor: ['city', 'decor'],
};
const n = (value: number) => value.toLocaleString('ru-RU');
function finite(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
function date(value: string | Date | null | undefined) { return value == null || value === '' ? NaN : new Date(value).getTime(); }
function remainingTime(milliseconds: number) {
  return durationText(milliseconds / 1000);
}
function RewardValue({ reward, cosmetics }: { reward: SeasonReward; cosmetics?: Props['cosmetics'] }) {
  const cosmetic = reward.cosmeticId ? cosmetics?.find(item => item.id === reward.cosmeticId) : null;
  const category = cosmetic?.category ?? reward.cosmeticId?.split('_')[0];
  const kind = ({ theme: 'Стиль колонии', frame: 'Рамка', weather: 'Небо', badge: 'Знак', title: 'Титул', effect: 'Эффект' } as Record<string, string>)[category ?? ''] ?? 'Оформление';
  return <span className="seasonRewardValue">
    {finite(reward.credits) > 0 && <GameAmount resource="credits">{n(finite(reward.credits))}</GameAmount>}
    {finite(reward.crystals) > 0 && <GameAmount resource="crystals">{n(finite(reward.crystals))}</GameAmount>}
    {reward.cosmeticId && <span className="seasonAppearanceReward"><GameIcon name="palette" size={13} /><span>{kind}: {cosmetic?.name ?? reward.title} · {reward.cosmeticDays ? `${reward.cosmeticDays} дн. доступа при получении` : 'навсегда'}</span></span>}
  </span>;
}

export function SeasonPanel({ season, busy, onClaim, onNavigate, onRefresh, cosmetics, questPeriods, onAction }: Props) {
  const id = useId();
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [pending, setPending] = useState(false);
  const [received, setReceived] = useState<{ key: string; levels: number[] }>({ key: '', levels: [] });
  const [feedback, setFeedback] = useState<{ key: string; error?: string; result?: SeasonClaimResult } | null>(null);
  const guard = useRef(false);
  const sourcesRef = useRef<HTMLDetailsElement>(null);
  const seasonKey = season?.id ?? '';
  const start = date(season?.starts_at), end = date(season?.ends_at);
  const dailyReset = date(questPeriods?.daily?.resetsAt), weeklyReset = date(questPeriods?.weekly?.resetsAt);
  const validDates = Number.isFinite(start) && Number.isFinite(end) && end > start;
  const activity = !validDates ? 'invalid' : now >= end ? 'expired' : now < start ? 'future' : 'active';
  const active = !!season && activity === 'active';
  useEffect(() => {
    if (!season || !validDates || now >= end) return;
    const nextBoundary = Math.min(...[start, end, dailyReset, weeklyReset].filter(boundary => Number.isFinite(boundary) && boundary > now));
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(30000, Math.max(1, nextBoundary - now + 1)));
    return () => window.clearTimeout(timer);
  }, [seasonKey, start, end, dailyReset, weeklyReset, now, validDates, season]);
  useEffect(() => { setPage(0); setFilter('all'); setNow(Date.now()); }, [seasonKey]);

  const points = finite(season?.points);
  const claimed = new Set((season?.claims ?? []).map(row => Number(row.level)));
  if (received.key === seasonKey) received.levels.forEach(level => claimed.add(level));
  const ordered = [...(season?.rewards ?? [])].sort((a, b) => a.level - b.level);
  const status = (reward: SeasonReward): Exclude<Filter, 'all'> => claimed.has(reward.level) ? 'claimed' : active && points >= reward.points ? 'ready' : 'locked';
  const counts = { all: ordered.length, ready: ordered.filter(reward => status(reward) === 'ready').length, locked: ordered.filter(reward => status(reward) === 'locked').length, claimed: ordered.filter(reward => status(reward) === 'claimed').length };
  const rank = { ready: 0, locked: 1, claimed: 2 };
  const filtered = ordered.filter(reward => filter === 'all' || status(reward) === filter).sort((a, b) => rank[status(a)] - rank[status(b)] || a.level - b.level);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const nextReward = ordered.find(reward => !claimed.has(reward.level));
  const visibleFeedback = feedback?.key === seasonKey ? feedback : null;
  const locked = busy || pending;
  const questGoal = active ? nextSeasonQuestGoal({ ...questPeriods, now }) : null;

  function visitAction(destination: ProgressDestination) {
    if (onAction) onAction(destination);
    else onNavigate(...ACTION_SECTIONS[destination]);
  }

  function showSources() {
    const element = sourcesRef.current;
    if (!element) return;
    element.open = true;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  async function claim(body: SeasonClaimRequest) {
    if (locked || guard.current) return;
    const submittedAt = Date.now();
    if (!season || !validDates || submittedAt < start || submittedAt >= end) { setNow(submittedAt); return; }
    const selected = ordered.filter(reward => !claimed.has(reward.level) && points >= reward.points && (body.all === true || reward.level === body.level));
    if (!selected.length) return;
    guard.current = true;
    setPending(true);
    setFeedback(null);
    const key = season.id;
    try {
      const result = await onClaim(body);
      if (!validSeasonClaimReceipt(result, key, selected)) throw new Error('Награда пока не подтверждена полными данными. Обнови колонию, чтобы проверить результат.');
      setReceived(previous => ({ key, levels: [...new Set([...(previous.key === key ? previous.levels : []), ...result.levels])] }));
      setFeedback({ key, result });
    } catch (cause) {
      setFeedback({ key, error: cause instanceof Error ? cause.message : 'Не удалось получить награду. Попробуй снова.' });
    } finally { guard.current = false; setPending(false); }
  }

  if (!season) return <section className="card seasonPanel seasonEmpty" data-season-panel><h2><GameIcon name="missions" />Новый сезон готовится</h2><p>Следующий сезон появится здесь. Пока можно выполнять ежедневные и недельные задания.</p><div className="seasonEmptyActions"><button type="button" className="miniButton" onClick={() => onNavigate('missions', 'daily')}>Ежедневные задания</button><button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить</button></div></section>;

  return <section className="card seasonCard seasonPanel" data-season-panel aria-labelledby={`${id}-title`} aria-busy={pending}>
    <div className="cardTitleRow"><div><h2 id={`${id}-title`}><GameIcon name="missions" />Сезон · {season.title || 'Новый сезон'}</h2>{season.subtitle && <p>{season.subtitle}</p>}<p className="seasonDeadline">{activity === 'active' ? `До конца: ${remainingTime(end - now)}` : activity === 'expired' ? 'Сезон завершён. Получение наград закрыто.' : activity === 'future' ? `До начала: ${remainingTime(start - now)}` : 'Даты сезона недоступны. Обнови колонию.'}</p></div><div className="seasonPoints">{n(points)}<span>SP · очки сезона</span></div></div>
    {!active && <button type="button" className="miniButton seasonRefresh" disabled={locked} onClick={onRefresh}>Проверить сезон</button>}
    <MechanicGuide steps={[
      'Очки сезона (SP) начисляются за подтверждённые действия в колонии. Это прогресс, а не валюта: при получении награды очки не тратятся.',
      'Достигни нужного порога и забери награду кнопкой до окончания активного сезона. Полученное оформление появится в магазине на указанный срок.',
      'Недельная лига кооперации — отдельное соревнование в разделе «Связи → Рейтинг». Здесь показаны только награды сезона.',
    ]} />
    <div className="seasonOverview"><span>Получено <b>{counts.claimed}/{ordered.length}</b></span><span>{active ? <>Готово <b>{counts.ready}</b></> : 'Получение недоступно'}</span></div>
    {nextReward ? <div className="seasonNext" data-season-next-reward={nextReward.level}><span>{active && points >= nextReward.points ? 'Следующая награда готова' : 'Следующая награда'} · ур. {nextReward.level}</span><strong>{nextReward.title}</strong><RewardValue reward={nextReward} cosmetics={cosmetics} /><small>{Math.max(0, nextReward.points - points) ? `Не хватает ${n(Math.max(0, nextReward.points - points))} SP · цель ${n(nextReward.points)} SP` : active ? `Цель ${n(nextReward.points)} SP достигнута` : `Цель ${n(nextReward.points)} SP`}</small><div className="progress" aria-label={`Очки до уровня ${nextReward.level}`} role="progressbar" aria-valuemin={0} aria-valuemax={nextReward.points} aria-valuenow={Math.min(points, nextReward.points)}><i style={{ width: `${Math.min(100, nextReward.points > 0 ? points / nextReward.points * 100 : 100)}%` }} /></div><small>Получение награды не тратит SP.</small>{active && <button type="button" className="miniButton seasonNextAction" disabled={locked} data-season-next-action onClick={points >= nextReward.points ? () => void claim({ level: nextReward.level }) : showSources}>{points >= nextReward.points ? `Забрать награду ур. ${nextReward.level}` : 'Как добрать SP'}<GameIcon name="arrow" size={13} /></button>}</div> : <div className="seasonComplete" role="status"><GameIcon name="check" size={17} />Все награды сезона получены.</div>}
    {questGoal && <details className="seasonDevelopment" data-season-quest-goal={questGoal.quest.quest_key}><summary><GameIcon name={questGoal.source.goal.icon} size={15} />Развитие и сезон: {questGoal.config.title}<GameIcon name="arrow" size={13} /></summary><div>
      <p>{questGoal.source.goal.purpose}</p><strong>{questGoal.period === 'daily' ? 'Цель дня' : 'Цель недели'} · {questGoal.config.title}</strong><p>{questGoal.config.description} Осталось: {n(questGoal.remaining)}.</p>
      <p><b>+{n(questGoal.source.points)} SP</b> · {questGoal.source.label}. {questGoal.source.goal.countHint}</p>
      <p className="seasonQuestReward">Отдельная награда задания: <GameAmount resource="credits">{n(Number(questGoal.quest.credit_reward))}</GameAmount><GameAmount resource="crystals">{n(Number(questGoal.quest.crystal_reward))}</GameAmount></p>
      <div className="seasonDevelopmentActions"><button type="button" className="miniButton" disabled={locked} onClick={() => visitAction(questGoal.source.goal.destination)}>{questGoal.source.goal.label}<GameIcon name="arrow" size={13} /></button><button type="button" className="miniButton" disabled={locked} onClick={() => onNavigate('missions', questGoal.period)}>К заданию {questGoal.period === 'daily' ? 'дня' : 'недели'}</button></div>
      <small>Очки даёт само действие в активном сезоне. Награду задания получаешь отдельно; её сбор не добавляет SP. Просмотр разделов бесплатный, действие и его стоимость проверяются там.</small>
    </div></details>}
    {counts.ready >= 2 && <button type="button" className="action seasonBulkClaim" data-season-claim-all disabled={locked} onClick={() => void claim({ all: true })}>{pending ? 'Получаем награды…' : `Собрать готовые · ${counts.ready}`}</button>}
    {visibleFeedback?.error && <div className="notice error seasonFeedback" role="alert"><span>{visibleFeedback.error}</span><button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить</button></div>}
    {visibleFeedback?.result && <div className="notice seasonFeedback" data-season-receipt role="status">{visibleFeedback.result.count ? <><strong>Получено наград: {n(visibleFeedback.result.count)}</strong><div className="seasonReceipt">{visibleFeedback.result.credits > 0 && <GameAmount resource="credits">+{n(visibleFeedback.result.credits)}</GameAmount>}{visibleFeedback.result.crystals > 0 && <GameAmount resource="crystals">+{n(visibleFeedback.result.crystals)}</GameAmount>}{visibleFeedback.result.cosmeticIds.length > 0 && <button type="button" className="miniButton" onClick={() => onNavigate('shop', 'collection')}><GameIcon name="palette" size={14} />Моё оформление</button>}</div><details className="seasonReceiptDetails"><summary>Уровни и награды<GameIcon name="arrow" size={13} /></summary><ul>{visibleFeedback.result.rewards.map(reward => <li key={reward.level}><strong>Ур. {reward.level} · {reward.title}</strong><RewardValue reward={reward} cosmetics={cosmetics} /></li>)}</ul></details></> : <><span>Новых наград не выдано. Обнови сезон, чтобы проверить текущие уровни.</span><button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Проверить награды</button></>}</div>}
    <div className="seasonFilters" role="group" aria-label="Фильтр наград сезона">{FILTERS.map(item => <button type="button" key={item.key} aria-pressed={filter === item.key} onClick={() => { setFilter(item.key); setPage(0); }} className={filter === item.key ? 'active' : ''}>{item.label}<span>{counts[item.key]}</span></button>)}</div>
    <div className="seasonRewardList" data-season-rewards>{visible.map(reward => {
      const state = status(reward);
      return <article className={`seasonEntry is-${state}`} key={reward.level} data-season-reward={reward.level}><div className="seasonEntryLevel">{state === 'claimed' ? <GameIcon name="check" size={17} /> : reward.level}</div><div className="seasonEntryBody"><strong>{reward.title}</strong><small>Ур. {reward.level} · {n(reward.points)} SP</small><RewardValue reward={reward} cosmetics={cosmetics} /><span className="seasonEntryStatus">{state === 'claimed' ? 'Получено' : state === 'ready' ? 'Готово к получению' : active ? `Ещё ${n(Math.max(0, reward.points - points))} SP` : 'Получение недоступно'}</span></div>{state === 'ready' && <button type="button" className="miniButton" data-season-claim={reward.level} disabled={locked} onClick={() => void claim({ level: reward.level })} aria-label={`Забрать награду уровня ${reward.level}`}>Забрать</button>}{state === 'locked' && <GameIcon name="lock" size={16} />}</article>;
    })}{!visible.length && <p className="seasonFilteredEmpty">{filter === 'ready' ? active ? 'Пока нет готовых наград. Очки начисляются за действия в колонии.' : 'Получение наград сейчас недоступно.' : filter === 'claimed' ? 'Здесь появятся полученные награды.' : 'В этой группе нет наград.'}</p>}</div>
    {pages > 1 && <nav className="seasonPagination" aria-label="Страницы наград сезона"><button type="button" className="miniButton" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Назад</button><span>{currentPage + 1} / {pages}</span><button type="button" className="miniButton" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Далее</button></nav>}
    <details className="seasonPointSources" ref={sourcesRef} tabIndex={-1}><summary><GameIcon name="info" size={15} />Как получать очки сезона</summary><p>SP начисляются за перечисленные действия в активном сезоне. Сбор наград заданий, достижений, входа и сезона очков не даёт. Поставки и рынок игроков тоже не добавляют SP; они помогают развивать колонию другими способами. Уже начисленные очки не тратятся при получении награды.</p>{!active && <p>Сейчас сезон не активен. Эти правила можно посмотреть заранее; SP за действия вне сезона не обещаются.</p>}<div>{SEASON_POINT_SOURCES.map(source => <div className="seasonPointSource" key={source.event} data-season-point-source={source.event}><details className="seasonSourceInfo"><summary>{source.label}<b>+{n(source.points)} SP</b></summary><p>{source.goal.countHint}</p></details><button type="button" className="miniButton" disabled={locked} onClick={() => source.event === 'daily_session' ? onNavigate('missions', 'daily') : visitAction(source.goal.destination)}>{source.event === 'daily_session' ? 'К заданиям' : source.goal.label}</button></div>)}</div><p>Сезонное оформление меняет внешний вид. Временный доступ начисляется при получении награды: действующий срок продлевается, постоянное владение сохраняется.</p></details>
  </section>;
}
