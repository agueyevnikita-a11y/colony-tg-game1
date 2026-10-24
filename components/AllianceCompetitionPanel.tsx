'use client';

import { useEffect, useRef, useState } from 'react';
import { competitionCosmetics, type AllianceCompetitionState } from '@/lib/game/alliance-competition';
import { competitionClaimForAwards } from '@/lib/game/competition-claim';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { SectionTabs } from '@/components/SectionTabs';
import { MechanicGuide } from '@/components/MechanicGuide';
import '@/app/alliance-competition.css';

type Props = {
  state?: AllianceCompetitionState;
  busy: boolean;
  onClaim: (periodId: string) => Promise<any>;
  onRefresh?: () => void;
  currentAllianceId?: string | null;
  onOpenAlliance?: () => void;
  onOpenCollection?: () => void;
  onOpenSeason?: () => void;
  cosmetics?: readonly { id: string; name: string }[];
};
type View = 'players' | 'alliances' | 'rewards';
type Award = AllianceCompetitionState['rewards'][number];
const n = (value: unknown) => Number(value ?? 0).toLocaleString('ru-RU');
const COSMETIC_NAMES: Record<string, string> = {
  badge_coop_champion: 'Знак чемпиона лунной лиги', frame_coop_orbit: 'Рамка лидера лунной лиги',
  title_coop_vanguard: 'Авангард лунной лиги', frame_coop_team: 'Рамка ведущего альянса', title_coop_team: 'Первопроходец альянса',
};
function dateUTC(timestamp: string) {
  if (!Number.isFinite(Date.parse(timestamp))) return 'Дата уточняется';
  return `${new Date(timestamp).toLocaleString('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} UTC`;
}

function periodFinished(awards: readonly Award[], now: number) {
  return awards.length > 0 && awards.every(award => Number.isFinite(Date.parse(award.endsAt)) && Date.parse(award.endsAt) <= now);
}

export function AllianceCompetitionPanel({ state, busy, onClaim, onRefresh, currentAllianceId, onOpenAlliance, onOpenCollection, onOpenSeason, cosmetics }: Props) {
  const [view, setView] = useState<View>(() => state?.rewards.some(award => !award.claimedAt && Number.isFinite(Date.parse(award.endsAt)) && Date.parse(award.endsAt) <= Date.now()) ? 'rewards' : 'players');
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState('');
  const [received, setReceived] = useState<Set<string>>(() => new Set());
  const [receivedAwards, setReceivedAwards] = useState<Record<string, Award['kind'][]>>({});
  const [receivedCosmetics, setReceivedCosmetics] = useState<Record<string, string[]>>({});
  const [feedback, setFeedback] = useState<Record<string, { text: string; error: boolean; refresh?: boolean }>>({});
  const [now, setNow] = useState(() => Date.now());
  const guard = useRef(false);
  const awardClaimed = (award: Award) => Boolean(award.claimedAt) || (receivedAwards[award.periodId]?.includes(award.kind) ?? false);
  const cosmeticName = (id: string) => cosmetics?.find(item => item.id === id)?.name || COSMETIC_NAMES[id] || 'Памятное оформление';
  const groups = new Map<string, AllianceCompetitionState['rewards']>();
  for (const award of state?.rewards ?? []) groups.set(award.periodId, [...(groups.get(award.periodId) ?? []), award]);
  const history = [...groups].sort((a, b) => Number(a[1].every(awardClaimed) || received.has(a[0])) - Number(b[1].every(awardClaimed) || received.has(b[0])) || Date.parse(b[1][0].endsAt) - Date.parse(a[1][0].endsAt));
  const readyPeriods = history.filter(([periodId, awards]) => !received.has(periodId) && awards.some(row => !awardClaimed(row)) && periodFinished(awards, now)).length;
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
    const selected = awards?.filter(award => !awardClaimed(award));
    if (!awards || !selected?.length || received.has(periodId) || !periodFinished(awards, Date.now())) return;
    guard.current = true; setPending(periodId);
    setFeedback(previous => { const next = { ...previous }; delete next[periodId]; return next; });
    try {
      const response = await onClaim(periodId), result = competitionClaimForAwards(response?.result ?? response, periodId, selected);
      if (!result) {
        setFeedback(previous => ({ ...previous, [periodId]: { text: 'Ответ о награде пока не подтверждён. Обнови рейтинг, чтобы проверить получение.', error: false, refresh: true } }));
        return;
      }
      if (!result.count) {
        setFeedback(previous => ({ ...previous, [periodId]: { text: 'Новых наград не выдано. Обнови рейтинг, чтобы проверить ранее полученные награды.', error: false, refresh: true } }));
        return;
      }
      if (result.complete) setReceived(previous => new Set([...previous, periodId]));
      setReceivedAwards(previous => ({ ...previous, [periodId]: [...new Set([...(previous[periodId] ?? []), ...result.paidKinds])] }));
      setReceivedCosmetics(previous => ({ ...previous, [periodId]: [...new Set([...(previous[periodId] ?? []), ...result.cosmeticIds])] }));
      setFeedback(previous => ({ ...previous, [periodId]: { text: `Получено: ${n(result.crystals)} кристаллов.${result.cosmeticIds.length ? ' Оформление доступно в коллекции; применение выбирается отдельно.' : ''}${result.complete ? '' : ' Подтверждена часть наград недели. Обнови рейтинг, чтобы проверить остальные.'}`, error: false, refresh: !result.complete } }));
    } catch (cause) {
      setFeedback(previous => ({ ...previous, [periodId]: { text: cause instanceof Error ? cause.message : 'Не удалось получить награды. Попробуй ещё раз.', error: true, refresh: true } }));
    } finally { guard.current = false; setPending(''); }
  }
  function status(periodId: string) {
    const item = feedback[periodId];
    return item ? <div className={`competitionFeedback${item.error ? ' isError' : ''}`} role={item.error ? 'alert' : 'status'}>{item.text}{item.refresh && onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить рейтинг</button>}</div> : null;
  }

  if (!state?.available) return <section className="card allianceCompetition" data-alliance-competition><h2><GameIcon name="trophy" size={22} />Недельная лига кооперации</h2><p>Лига готовится к открытию. Заработанные награды появятся здесь после обновления.</p>{onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить</button>}</section>;

  const periodStart = Date.parse(state.period.startsAt), periodEnd = Date.parse(state.period.endsAt);
  const periodKnown = Number.isFinite(periodStart) && Number.isFinite(periodEnd) && periodEnd > periodStart;
  const future = periodKnown && periodStart > now;
  const ended = periodKnown && periodEnd <= now;
  const active = periodKnown && !future && !ended;
  const missing = Math.max(0, state.minimumRewardPoints - state.me.points);
  const lastPrizeRank = state.prizes.at(-1)?.to ?? 50;
  const myAlliance = state.binding ? state.alliances.find(alliance => alliance.allianceId === state.binding!.allianceId) : null;
  const differentTeam = state.binding && currentAllianceId !== undefined && state.binding.allianceId !== currentAllianceId;
  return <section className="card allianceCompetition" data-alliance-competition>
    <div className="cardTitleRow"><div><h2><GameIcon name="trophy" size={22} />Лига кооперации</h2><p>Недельные призы за вклад в совместную добычу.</p><p className="competitionDeadline">{ended ? 'Неделя завершена' : future ? 'Начало недели' : !periodKnown ? 'Проверка недели' : 'Итоги'} · {dateUTC(future ? state.period.startsAt : state.period.endsAt)}</p></div><span className="competitionWeekPoints"><b>{n(state.me.points)}</b><small>очков лиги</small></span></div>
    {(!periodKnown || future) && <div className="competitionFeedback" role="status" data-competition-period-check>{future ? 'Неделя ещё не началась.' : 'Время недели пока не подтверждено.'} Обнови рейтинг, чтобы проверить активную неделю.{onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить рейтинг</button>}</div>}
    {ended && onRefresh && <div className="competitionFeedback" role="status">Обнови рейтинг, чтобы увидеть окончательные места и награды.<button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Проверить итоги</button></div>}
    <div className="competitionMyResult"><div><span>Твоё место</span><strong>{state.me.rank ? `№${n(state.me.rank)}` : '—'}</strong></div><div><span>Личная награда</span><GameAmount resource="crystals">{n(state.me.estimatedPersonalCrystals)}</GameAmount></div><div><span>Доля команды</span><GameAmount resource="crystals">{n(state.me.estimatedTeamCrystals)}</GameAmount></div><small>Предварительно: если закончить неделю с текущим результатом.</small></div>
    <div className="competitionQualification" data-competition-qualification><span>Личный порог <strong>{n(Math.min(state.me.points, state.minimumRewardPoints))}/{n(state.minimumRewardPoints)}</strong></span><div className="progress" role="progressbar" aria-label="Личный порог лиги" aria-valuemin={0} aria-valuemax={state.minimumRewardPoints} aria-valuenow={Math.min(state.me.points, state.minimumRewardPoints)}><i style={{ width: `${Math.min(100, state.me.points / Math.max(1, state.minimumRewardPoints) * 100)}%` }} /></div><small>{ended ? 'Новые смены пойдут в зачёт следующей недели. Проверь окончательные итоги.' : !active ? 'Порог и место нужно проверить для активной недели.' : missing > 0 ? `Ещё ${n(missing)} очков · смен до порога: ${n(Math.ceil(missing / Math.max(1, state.pointsPerModule)))}. Для личного приза также нужно место в топ-${n(lastPrizeRank)}.` : `Порог выполнен. Личный приз требует итогового места в топ-${n(lastPrizeRank)}.`}</small></div>
    <p className="competitionBinding">{state.binding ? <>Команда недели: <strong>{state.binding.allianceName}</strong>. {active ? 'Засчитываются оплаченные модули этой команды.' : 'Для нового вклада сначала проверь активную неделю.'}</> : active ? 'Первая оплаченная смена закрепит команду для рейтинга этой недели.' : 'Команда закрепляется первой оплаченной сменой во время активной недели.'}</p>
    {!ended && onOpenAlliance && <div className="competitionNextStep" data-competition-next-step>
      <p>{!active
        ? 'Можно бесплатно посмотреть альянсы и условия добычи. Зачёт нового вклада нужно проверить после обновления активной недели.'
        : differentTeam
        ? 'Команда недели уже закреплена. Смены в другом альянсе принесут обычные награды добычи, но не очки этой недели. Заработанные очки и призы сохраняются.'
        : currentAllianceId === null
          ? 'Сначала выбери альянс, затем открой совместную добычу. Просмотр команд и стоимости смен бесплатный; ресурсы спишутся только после подтверждения модуля.'
          : currentAllianceId === undefined
            ? 'Открой альянсы и проверь условия совместной добычи. Просмотр бесплатный; выбор роли и оплата модуля — отдельный шаг.'
            : `Посмотри роли и стоимость смены совместной добычи. Каждый оплаченный модуль даст ${n(state.pointsPerModule)} очков лиги; просмотр ничего не списывает.`}</p>
      <button type="button" className="miniButton" disabled={locked} onClick={onOpenAlliance}>{currentAllianceId === null ? 'Найти альянс' : currentAllianceId === undefined ? 'Открыть альянсы' : differentTeam ? 'Открыть мой альянс' : 'К совместной добыче'}<GameIcon name="arrow" size={13} /></button>
    </div>}
    <MechanicGuide title="За что дают очки и призы" steps={[
      `Во время активной недели каждый оплаченный модуль совместной добычи даёт ${n(state.pointsPerModule)} очков сразу при отправке. Роль не влияет на очки. Запуск операции и получение готовой добычи дополнительных очков не дают.`,
      'Первая оплаченная смена закрепляет альянс до конца недели. Вклад в другую команду приносит обычную добычу, но не очки этой недели.',
      `Личный приз требует ${n(state.minimumRewardPoints)} очков и места в топ-${n(lastPrizeRank)}. Для командного фонда нужны ${n(state.minimumTeamContributors)} участника с таким личным порогом и место альянса в топ-${n(lastPrizeRank)}. Доля положена только участникам, выполнившим порог.`,
      'Пока неделя идёт, суммы предварительные. После итогов готовые награды можно забрать в разделе «Мои награды» без ограничения по времени.',
    ]} />
    {myAlliance && myAlliance.qualifiedContributors < state.minimumTeamContributors && <p className="competitionHint">До командного зачёта: {n(myAlliance.qualifiedContributors)} из {n(state.minimumTeamContributors)} участников с личным порогом {n(state.minimumRewardPoints)} очков.</p>}

    <SectionTabs label="Недельный рейтинг" value={view} items={[{ key: 'players', label: 'Игроки', icon: 'city' }, { key: 'alliances', label: 'Альянсы', icon: 'social' }, { key: 'rewards', label: 'Мои награды', icon: 'crystals', badge: readyPeriods }]} onChange={key => setView(key as View)} />
    {view === 'alliances' && <p className="competitionHint" data-competition-pool-hint>Общий фонд — приз всей команды. Твоя предполагаемая доля показана выше и зависит от места команды и твоих очков.</p>}
    {view === 'rewards' && history.length > 0 && <p className="competitionHint">Здесь зафиксированные награды прошлых недель. Получение не требует ресурсов и не зависит от текущего членства в альянсе.</p>}
    {view === 'players' && <div className="competitionRows" data-competition-players>{state.players.slice(currentPage * 5, currentPage * 5 + 5).map(player => <div className="competitionRow" key={player.userId}><span className="competitionRank">{player.rank}</span><div><strong>{player.name}</strong><small>{n(player.points)} очков</small></div><span className="competitionRowPrize"><GameAmount resource="crystals">{n(player.crystals)}</GameAmount><small>предварительно</small></span></div>)}{!state.players.length && <p className="competitionEmpty">Первая оплаченная смена откроет зачёт недели. Здесь появятся участники совместной добычи.</p>}</div>}
    {view === 'alliances' && <div className="competitionRows" data-competition-alliances>{state.alliances.slice(currentPage * 5, currentPage * 5 + 5).map(alliance => <div className="competitionRow" key={alliance.allianceId}><span className="competitionRank">{alliance.rank ?? '—'}</span><div><strong>{alliance.name}</strong><small>{n(alliance.points)} очков · {n(alliance.contributors)} участников</small>{alliance.qualifiedContributors < state.minimumTeamContributors && <small>Для зачёта: {n(alliance.qualifiedContributors)}/{n(state.minimumTeamContributors)} с нужным вкладом</small>}</div><span className="competitionRowPrize"><GameAmount resource="crystals">{n(alliance.pool)}</GameAmount><small>общий фонд</small></span></div>)}{!state.alliances.length && <p className="competitionEmpty">Альянсы появятся после первых оплаченных смен. Для командного приза нужны {n(state.minimumTeamContributors)} участника с личным порогом {n(state.minimumRewardPoints)} очков.</p>}</div>}
    {view === 'rewards' && <div className="competitionAwards" data-competition-awards>{history.slice(currentPage * 5, currentPage * 5 + 5).map(([periodId, awards]) => {
      const claimed = received.has(periodId) || awards.every(awardClaimed);
      const ready = periodFinished(awards, now);
      const datesKnown = awards.every(award => Number.isFinite(Date.parse(award.endsAt)));
      const hasOwnedCosmetics = awards.some(award => awardClaimed(award) && award.cosmeticIds.length > 0) || (receivedCosmetics[periodId]?.length ?? 0) > 0;
      return <article className="competitionAward" key={periodId}>
        <h3>Итоги {dateUTC(awards[0].endsAt)}</h3>
        {awards.map(award => <div className="competitionAwardLine" key={award.kind} data-competition-award={award.kind}>
          <span>{award.kind === 'personal' ? 'Личное место' : `${award.allianceName ?? 'Альянс'} · доля`} №{n(award.rank)}</span><GameAmount resource="crystals">{n(award.crystals)}</GameAmount>
          {award.cosmeticIds.length > 0 && <small>{award.cosmeticIds.map(cosmeticName).join(' · ')} · навсегда</small>}
          {awardClaimed(award) && <small className="competitionAwardClaimed"><GameIcon name="check" size={12} />Награда получена</small>}
        </div>)}
        <button type="button" className="action" disabled={locked || claimed || !ready} onClick={() => { void claim(periodId); }}>{pending === periodId ? 'Получаем…' : claimed ? 'Получено' : !datesKnown ? 'Сначала уточни дату итогов' : !ready ? 'Неделя ещё идёт' : 'Забрать награды недели'}</button>
        {!datesKnown && onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Проверить неделю</button>}
        {hasOwnedCosmetics && onOpenCollection && <div className="competitionCollection"><button type="button" className="miniButton" disabled={locked} onClick={onOpenCollection}><GameIcon name="palette" size={16} />Моё оформление<GameIcon name="arrow" size={13} /></button><small>Призовое оформление уже в коллекции. Просмотр бесплатный; применение выбирается отдельно.</small></div>}{status(periodId)}
      </article>;
    })}{!history.length && <p className="competitionEmpty">Окончательные награды появятся после завершения недели. Получить их можно позже, даже после выхода из альянса.</p>}</div>}
    {pages > 1 && <div className="competitionPagination"><button type="button" className="miniButton" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Назад</button><span>{currentPage + 1}/{pages}</span><button type="button" className="miniButton" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Далее</button></div>}

    <details className="competitionRules"><summary>Призы и правила недели</summary><div className="competitionPrizeHead"><span>Место</span><span>Лично</span><span>Фонд альянса</span></div>{state.prizes.map(prize => <div className="competitionPrizeRow" key={prize.from}><span>{prize.label}</span><GameAmount resource="crystals">{n(prize.personal)}</GameAmount><GameAmount resource="crystals">{n(prize.alliancePool)}</GameAmount></div>)}
      <details className="competitionCosmeticPrizes"><summary>Какое оформление можно получить</summary><p>Возможные призы за итоговое место при выполнении порога. Всё оформление выдаётся навсегда; таблица не гарантирует личную награду.</p>{state.prizes.map(prize => <div className="competitionCosmeticBand" key={prize.from}><strong>{prize.label}</strong><p><span>Лично:</span> {competitionCosmetics('personal', prize.from).map(cosmeticName).join(' · ')}</p><p><span>Команда:</span> {competitionCosmetics('alliance', prize.from).map(cosmeticName).join(' · ')}</p></div>)}</details>
      <p>Фонд команды: 40% поровну, 60% по очкам среди участников с порогом {n(state.minimumRewardPoints)} очков. Нужно минимум {n(state.minimumTeamContributors)} таких участника. Это общий фонд, а не награда каждому.</p><p>За призовые места также выдаётся постоянное памятное оформление. Состав команды и очки фиксируются историей вклада: выход или исключение не отнимают заработанную награду.</p><p>При равных очках выше тот, кто раньше набрал результат. Итоги — по понедельникам в 00:00 UTC. Срока получения готовых наград нет.</p>
      <div className="competitionScoreGuide" data-competition-score-guide><strong>Четыре разных показателя</strong><p>Рейтинг города отражает развитие базы. SP открывают награды сезона. AP учитывают вклад в мегапроект альянса. Очки этой лиги начисляются только за оплаченные модули совместной добычи; другие показатели в них не переводятся.</p>{onOpenSeason && <button type="button" className="miniButton" disabled={locked} onClick={onOpenSeason}>Награды сезона<GameIcon name="arrow" size={13} /></button>}</div>
    </details>
  </section>;
}
