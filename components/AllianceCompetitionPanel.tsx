'use client';

import { useEffect, useRef, useState } from 'react';
import type { AllianceCompetitionState } from '@/lib/game/alliance-competition';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { SectionTabs } from '@/components/SectionTabs';
import '@/app/alliance-competition.css';

type Props = { state?: AllianceCompetitionState; busy: boolean; onClaim: (periodId: string) => Promise<any>; onRefresh?: () => void };
type View = 'players' | 'alliances' | 'rewards';
const n = (value: unknown) => Number(value ?? 0).toLocaleString('ru-RU');
const COSMETIC_NAMES: Record<string, string> = {
  badge_coop_champion: 'Знак чемпиона лунной лиги', frame_coop_orbit: 'Рамка лидера лунной лиги',
  title_coop_vanguard: 'Авангард лунной лиги', frame_coop_team: 'Рамка ведущего альянса', title_coop_team: 'Первопроходец альянса',
};
function dateUTC(timestamp: string) {
  if (!Number.isFinite(Date.parse(timestamp))) return 'Дата уточняется';
  return `${new Date(timestamp).toLocaleString('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} UTC`;
}

export function AllianceCompetitionPanel({ state, busy, onClaim, onRefresh }: Props) {
  const [view, setView] = useState<View>(() => state?.rewards.some(award => !award.claimedAt && Date.parse(award.endsAt) <= Date.now()) ? 'rewards' : 'players');
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState('');
  const [received, setReceived] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<Record<string, { text: string; error: boolean }>>({});
  const [now, setNow] = useState(() => Date.now());
  const guard = useRef(false);
  const groups = new Map<string, AllianceCompetitionState['rewards']>();
  for (const award of state?.rewards ?? []) groups.set(award.periodId, [...(groups.get(award.periodId) ?? []), award]);
  const history = [...groups].sort((a, b) => Number(a[1].every(row => row.claimedAt) || received.has(a[0])) - Number(b[1].every(row => row.claimedAt) || received.has(b[0])) || Date.parse(b[1][0].endsAt) - Date.parse(a[1][0].endsAt));
  const readyPeriods = history.filter(([periodId, awards]) => !received.has(periodId) && awards.some(row => !row.claimedAt) && Date.parse(awards[0].endsAt) <= now).length;
  const rows = view === 'players' ? state?.players ?? [] : view === 'alliances' ? state?.alliances ?? [] : history;
  const pages = Math.max(1, Math.ceil(rows.length / 5)), currentPage = Math.min(page, pages - 1);
  const locked = busy || Boolean(pending);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [state?.period.id]);
  useEffect(() => { setPage(0); }, [view, state?.period.id]);

  async function claim(periodId: string) {
    if (!state?.available || locked || guard.current) return;
    const awards = groups.get(periodId);
    if (!awards?.some(award => !award.claimedAt) || received.has(periodId) || Date.parse(awards[0].endsAt) > Date.now()) return;
    guard.current = true; setPending(periodId);
    setFeedback(previous => { const next = { ...previous }; delete next[periodId]; return next; });
    try {
      const response = await onClaim(periodId), result = response?.result ?? response;
      if (result?.periodId !== periodId || !Number.isSafeInteger(result.count) || result.count < 0) throw new Error('Подтверждение награды не получено. Обнови рейтинг и проверь результат.');
      setReceived(previous => new Set([...previous, periodId]));
      setFeedback(previous => ({ ...previous, [periodId]: { text: result.count ? `Награды получены: ${n(result.crystals)} кристаллов.${result.cosmeticIds?.length ? ' Оформление доступно в коллекции.' : ''}` : 'Награды этой недели уже получены.', error: false } }));
    } catch (cause) {
      setFeedback(previous => ({ ...previous, [periodId]: { text: cause instanceof Error ? cause.message : 'Не удалось получить награды. Попробуй ещё раз.', error: true } }));
    } finally { guard.current = false; setPending(''); }
  }
  function status(periodId: string) {
    const item = feedback[periodId];
    return item ? <div className={`competitionFeedback${item.error ? ' isError' : ''}`} role={item.error ? 'alert' : 'status'}>{item.text}</div> : null;
  }

  if (!state?.available) return <section className="card allianceCompetition" data-alliance-competition><h2><GameIcon name="trophy" size={22} />Недельная лига кооперации</h2><p>Лига готовится к открытию. Заработанные награды появятся здесь после обновления.</p>{onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить</button>}</section>;

  const ended = Date.parse(state.period.endsAt) <= now;
  const missing = Math.max(0, state.minimumRewardPoints - state.me.points);
  const myAlliance = state.binding ? state.alliances.find(alliance => alliance.allianceId === state.binding!.allianceId) : null;
  return <section className="card allianceCompetition" data-alliance-competition>
    <div className="cardTitleRow"><div><h2><GameIcon name="trophy" size={22} />Лига кооперации</h2><p>Новая неделя — новый зачёт игроков и альянсов.</p><p className="competitionDeadline">{ended ? 'Неделя завершена' : 'Итоги'} · {dateUTC(state.period.endsAt)}</p></div><span className="competitionWeekPoints"><b>{n(state.me.points)}</b><small>твоих очков</small></span></div>
    {ended && onRefresh && <div className="competitionFeedback" role="status">Обнови рейтинг, чтобы увидеть окончательные места и награды.<button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Проверить итоги</button></div>}
    <div className="competitionMyResult"><div><span>Твоё место</span><strong>{state.me.rank ? `№${n(state.me.rank)}` : '—'}</strong></div><div><span>Личная награда</span><GameAmount resource="crystals">{n(state.me.estimatedPersonalCrystals)}</GameAmount></div><div><span>Доля команды</span><GameAmount resource="crystals">{n(state.me.estimatedTeamCrystals)}</GameAmount></div><small>Предварительно: если закончить неделю с текущим результатом.</small></div>
    <p className="competitionHint">Оплаченная смена общей добычи даёт {n(state.pointsPerModule)} очков. Для призов нужно минимум {n(state.minimumRewardPoints)} очков — {n(Math.ceil(state.minimumRewardPoints / Math.max(1, state.pointsPerModule)))} смены.{missing > 0 ? ` До порога осталось ${n(missing)}.` : ''}</p>
    <p className="competitionBinding">{state.binding ? <>Команда недели: <strong>{state.binding.allianceName}</strong>. В рейтинг засчитывается добыча этого альянса.</> : 'Первая оплаченная смена закрепит команду для рейтинга этой недели.'}</p>
    {myAlliance && myAlliance.qualifiedContributors < state.minimumTeamContributors && <p className="competitionHint">До командного зачёта: {n(myAlliance.qualifiedContributors)} из {n(state.minimumTeamContributors)} участников с личным порогом {n(state.minimumRewardPoints)} очков.</p>}

    <SectionTabs label="Недельный рейтинг" value={view} items={[{ key: 'players', label: 'Игроки', icon: 'city' }, { key: 'alliances', label: 'Альянсы', icon: 'social' }, { key: 'rewards', label: 'Мои награды', icon: 'crystals', badge: readyPeriods }]} onChange={key => setView(key as View)} />
    {view === 'players' && <div className="competitionRows" data-competition-players>{state.players.slice(currentPage * 5, currentPage * 5 + 5).map(player => <div className="competitionRow" key={player.userId}><span className="competitionRank">{player.rank}</span><div><strong>{player.name}</strong><small>{n(player.points)} очков</small></div><span className="competitionRowPrize"><GameAmount resource="crystals">{n(player.crystals)}</GameAmount><small>предварительно</small></span></div>)}{!state.players.length && <p className="competitionEmpty">Первая оплаченная смена откроет зачёт недели. Здесь появятся участники совместной добычи.</p>}</div>}
    {view === 'alliances' && <div className="competitionRows" data-competition-alliances>{state.alliances.slice(currentPage * 5, currentPage * 5 + 5).map(alliance => <div className="competitionRow" key={alliance.allianceId}><span className="competitionRank">{alliance.rank ?? '—'}</span><div><strong>{alliance.name}</strong><small>{n(alliance.points)} очков · {n(alliance.contributors)} участников</small>{alliance.qualifiedContributors < state.minimumTeamContributors && <small>Для зачёта: {n(alliance.qualifiedContributors)}/{n(state.minimumTeamContributors)} с нужным вкладом</small>}</div><span className="competitionRowPrize"><GameAmount resource="crystals">{n(alliance.pool)}</GameAmount><small>общий фонд</small></span></div>)}{!state.alliances.length && <p className="competitionEmpty">Альянсы появятся после первых оплаченных смен. Для командного приза нужны {n(state.minimumTeamContributors)} участника с личным порогом {n(state.minimumRewardPoints)} очков.</p>}</div>}
    {view === 'rewards' && <div className="competitionAwards" data-competition-awards>{history.slice(currentPage * 5, currentPage * 5 + 5).map(([periodId, awards]) => {
      const claimed = received.has(periodId) || awards.every(award => Boolean(award.claimedAt));
      const ready = Date.parse(awards[0].endsAt) <= now;
      return <article className="competitionAward" key={periodId}><h3>Итоги {dateUTC(awards[0].endsAt)}</h3>{awards.map(award => <div className="competitionAwardLine" key={award.kind}><span>{award.kind === 'personal' ? 'Личное место' : `${award.allianceName ?? 'Альянс'} · доля`} №{n(award.rank)}</span><GameAmount resource="crystals">{n(award.crystals)}</GameAmount>{award.cosmeticIds.length > 0 && <small>{award.cosmeticIds.map(cosmetic => COSMETIC_NAMES[cosmetic] ?? 'Памятное оформление').join(' · ')}</small>}</div>)}<button type="button" className="action" disabled={locked || claimed || !ready} onClick={() => { void claim(periodId); }}>{pending === periodId ? 'Получаем…' : claimed ? 'Получено' : !ready ? 'Неделя ещё идёт' : 'Забрать награды недели'}</button>{status(periodId)}</article>;
    })}{!history.length && <p className="competitionEmpty">Окончательные награды появятся после завершения недели. Получить их можно позже, даже после выхода из альянса.</p>}</div>}
    {pages > 1 && <div className="competitionPagination"><button type="button" className="miniButton" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Назад</button><span>{currentPage + 1}/{pages}</span><button type="button" className="miniButton" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Далее</button></div>}

    <details className="competitionRules"><summary>Призы и правила недели</summary><div className="competitionPrizeHead"><span>Место</span><span>Лично</span><span>Фонд альянса</span></div>{state.prizes.map(prize => <div className="competitionPrizeRow" key={prize.from}><span>{prize.label}</span><GameAmount resource="crystals">{n(prize.personal)}</GameAmount><GameAmount resource="crystals">{n(prize.alliancePool)}</GameAmount></div>)}<p>Фонд команды: 40% поровну, 60% по очкам среди участников с порогом {n(state.minimumRewardPoints)} очков. Нужно минимум {n(state.minimumTeamContributors)} таких участника. Это общий фонд, а не награда каждому.</p><p>За призовые места также выдаётся памятное оформление. Состав команды и очки фиксируются историей вклада: выход или исключение не отнимают заработанную награду.</p><p>При равных очках выше тот, кто раньше набрал результат. Итоги — по понедельникам в 00:00 UTC. Срока получения готовых наград нет.</p></details>
  </section>;
}
