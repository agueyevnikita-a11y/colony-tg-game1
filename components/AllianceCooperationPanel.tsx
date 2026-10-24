'use client';

import { useEffect, useRef, useState } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import { durationText } from '@/lib/game/format';
import { validCooperationReceipt } from '@/lib/game/alliance-cooperation-receipt';
import '@/app/alliance-cooperation.css';

type Amounts = Partial<Record<'ore' | 'energy' | 'parts' | 'credits' | 'science', number>>;
type Role = 'drilling' | 'power' | 'analysis';
type Technology = { id: 'drilling' | 'analysis'; name: string; level: number; maxLevel: number; nextCost: number | null; effectText: string; canResearch: boolean };
export type AllianceCooperationState = {
  available: boolean;
  current: null | {
    id: string; allianceId: string; allianceName: string; status: 'active' | 'settled'; startedAt: string; endsAt: string;
    participants: number; roles: string[]; teamBonusPercent: number; sharedScience: number;
    technologySnapshot: { drilling: number; analysis: number }; myUnits: number; maxUnits: number;
    myContributions: { id: string; role: string; cost: Amounts; reward: Amounts; claimedAt: string | null }[];
    myReward: Amounts;
    team?: { name: string; isMe: boolean; isCurrentMember: boolean; units: number; roles: { id: Role; units: number }[] }[];
  };
  pending: { id: string; allianceName: string; endsAt: string; status: 'active' | 'ready'; units: number; reward: Amounts; canClaim: boolean; storageShortages: { ore: number } }[];
  progress: null | { sharedScience: number; technologies: Technology[]; canResearch: boolean };
  roleOptions: { id: Role; name: string; cost: Amounts; reward: Amounts }[];
  rules: { durationSec: number; maxUnitsPerPlayer: number; sharedSciencePerUnit: number };
};
type Props = {
  cooperation?: AllianceCooperationState;
  view: 'mining' | 'technology';
  resources: Partial<Record<keyof Amounts, number | string>>;
  hasMembership: boolean;
  ownerKey?: string;
  allianceKey?: string;
  busy: boolean;
  onAction: (path: string, body?: Record<string, unknown>) => Promise<any>;
  onRefresh?: () => void;
  onMining?: () => void;
  onTechnology?: () => void;
  onPersonalResearch?: () => void;
  onOpenRating?: () => void;
};
const n = (value: unknown) => Number(value ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const ROLE_ICONS: Record<Role, string> = { drilling: 'ore', power: 'energy', analysis: 'science' };
const ROLE_LABELS: Record<Role, string> = { drilling: 'Бурение', power: 'Энергия', analysis: 'Анализ' };
const RESOURCE_NAMES: Record<string, string> = { ore: 'руды', energy: 'энергии', parts: 'деталей', credits: 'кредитов', science: 'науки' };
function date(value: string) { return new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function remaining(timestamp: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(timestamp) - now) / 1000));
  if (!Number.isFinite(seconds)) return 'Обнови состояние';
  return durationText(seconds);
}
function amounts(value: Amounts) {
  return <span className="coopAmounts">{Object.entries(value).filter(([, amount]) => Number(amount) > 0).map(([resource, amount]) => <GameAmount key={resource} resource={resource}>{n(amount)}</GameAmount>)}</span>;
}
function newReceiptId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A choice is sent only by its explicit action; failed intents keep their receipt ID. */
export function AllianceCooperationPanel({ cooperation: state, view, resources, hasMembership, ownerKey = '', allianceKey = '', busy, onAction, onRefresh, onMining, onTechnology, onPersonalResearch, onOpenRating }: Props) {
  const [role, setRole] = useState<Role>('drilling');
  const [pendingKey, setPendingKey] = useState('');
  const [feedback, setFeedback] = useState<Record<string, { text: string; error: boolean }>>({});
  const [success, setSuccess] = useState<{ view: Props['view']; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState(0);
  const [teamPage, setTeamPage] = useState(0);
  const guard = useRef(false);
  const receipts = useRef(new Map<string, string>());
  const identity = `${ownerKey}:${allianceKey}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const current = state?.current;
  const currentEndsAt = current ? Date.parse(current.endsAt) : Number.NaN;
  const active = current?.status === 'active' && currentEndsAt > now;
  const pendingSharedScience = current?.status === 'active' && Number.isFinite(Number(current.sharedScience)) ? Math.max(0, Number(current.sharedScience)) : 0;
  const selectedRole = state?.roleOptions.find(option => option.id === role) ?? state?.roleOptions[0];
  const maxUnits = Number(current?.maxUnits ?? state?.rules.maxUnitsPerPlayer ?? 3);
  const freeUnits = Math.max(0, maxUnits - Number(current?.myUnits ?? 0));
  const locked = busy || Boolean(pendingKey);
  const receive = (state?.pending ?? []).filter(item => item.status === 'ready' || item.id !== current?.id);
  const timingKey = [current?.status === 'active' ? current.endsAt : '', ...(state?.pending ?? []).filter(item => item.status === 'active').map(item => item.endsAt)].filter(Boolean).join('|');
  const pages = Math.max(1, Math.ceil(receive.length / 3)), currentPage = Math.min(page, pages - 1);
  const shortages = selectedRole ? Object.entries(selectedRole.cost).filter(([resource, amount]) => Number(resources[resource as keyof Amounts] ?? 0) < Number(amount)) : [];
  const team = hasMembership ? current?.team ?? [] : [];
  const teamPages = Math.max(1, Math.ceil(team.length / 5)), currentTeamPage = Math.min(teamPage, teamPages - 1);
  const missingRoles = (Object.keys(ROLE_LABELS) as Role[]).filter(id => !current?.roles.includes(id));
  const nextBonus = Number(current?.teamBonusPercent ?? 0) >= 10 ? 20 : 10;
  const nextTarget = nextBonus === 20 ? 3 : 2;

  useEffect(() => {
    setNow(Date.now());
    if (!timingKey) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [timingKey]);
  useEffect(() => { setFeedback({}); setSuccess(null); setRole('drilling'); setPage(0); }, [ownerKey, allianceKey]);
  useEffect(() => { setTeamPage(0); }, [current?.id, ownerKey, allianceKey]);

  function status(key: string) {
    const item = feedback[key];
    return item ? <div className={`coopFeedback${item.error ? ' isError' : ''}`} role={item.error ? 'alert' : 'status'}>{item.text}{item.error && onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Проверить альянс</button>}</div> : null;
  }
  async function act(key: string, body: Record<string, unknown>, message: string | ((data: any) => string)) {
    if (locked || guard.current || identityRef.current !== identity) return;
    if (body.action === 'contribute' && (!hasMembership || !state?.available || !current || current.id !== body.operationId || current.status !== 'active' || !Number.isFinite(currentEndsAt) || Date.now() >= currentEndsAt)) { setNow(Date.now()); return; }
    guard.current = true; setPendingKey(key); setSuccess(null);
    setFeedback(previous => { const next = { ...previous }; delete next[key]; return next; });
    const storageKey = `colony:cooperation:${ownerKey}:${body.action === 'claim' ? 'earned' : allianceKey}:${key}`;
    const requestIdentity = identity;
    try {
      let requestId = receipts.current.get(storageKey);
      if (!requestId) {
        try { requestId = sessionStorage.getItem(storageKey) ?? undefined; } catch { /* The in-memory receipt still guards this session. */ }
        if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) requestId = newReceiptId();
        receipts.current.set(storageKey, requestId);
        try { sessionStorage.setItem(storageKey, requestId); } catch { /* Continue with the in-memory receipt. */ }
      }
      const data = await onAction('/api/alliance/cooperation', { ...body, requestId });
      if (!validCooperationReceipt(data?.result, body)) throw new Error('Обнови альянс, чтобы проверить результат действия. Повторная попытка проверит ту же квитанцию.');
      if (identityRef.current === requestIdentity) setSuccess({ view, text: typeof message === 'function' ? message(data) : message });
      receipts.current.delete(storageKey);
      try { sessionStorage.removeItem(storageKey); } catch { /* A stale receipt only replays its original response. */ }
    } catch (cause) {
      if (identityRef.current === requestIdentity) setFeedback(previous => ({ ...previous, [key]: { text: cause instanceof Error ? cause.message : 'Не удалось выполнить действие. Можно повторить попытку.', error: true } }));
    } finally { guard.current = false; setPendingKey(''); }
  }

  if (view === 'technology') return <section className="card allianceCooperation" data-alliance-technologies>
    <div className="cardTitleRow"><div><h2><GameIcon name="research" size={22} />Технологии альянса</h2><p>Усиливают будущую совместную добычу всей команды.</p></div>{state?.progress && <span className="coopScience" data-coop-science-available><GameAmount resource="science">{n(state.progress.sharedScience)}</GameAmount><small>доступно сейчас</small></span>}</div>
    <MechanicGuide steps={[
      state ? `Каждая оплаченная смена создаёт ${n(state.rules.sharedSciencePerUnit)} общей науки. В запас альянса она поступит после завершения добычи.` : 'Оплаченные смены создают общую науку. В запас альянса она поступит после завершения добычи.',
      'Владелец или офицер расходует общую науку на исследования. Личная наука игроков при этом не списывается.',
      'Новый уровень действует с запуска следующей операции. Текущая добыча сохраняет прежние условия.',
    ]} />
    {hasMembership && onMining && <div className="coopMiningLink"><button type="button" className="miniButton" onClick={onMining}><GameIcon name="ore" size={17} />Открыть добычу · бесплатно<GameIcon name="arrow" size={14} /></button><small>Просмотр не списывает ресурсы. Оплата смены — отдельное действие в добыче.</small></div>}
    {hasMembership && onPersonalResearch && <p className="coopHint coopPersonalResearch" data-coop-personal-research>Технологии этой команды усиливают добычу. Здания и рецепты твоей колонии открываются в личных исследованиях.<button type="button" className="miniButton" disabled={locked} onClick={onPersonalResearch}>Личные исследования<GameIcon name="arrow" size={13} /></button></p>}
    {state?.progress ? <>
      {hasMembership && current?.status === 'active' && <div className="coopSciencePending" data-coop-science-pending>
        <div><GameIcon name="clock" size={18} /><strong>Ожидается от текущей добычи</strong><GameAmount resource="science">{n(pendingSharedScience)}</GameAmount></div>
        <p>Эта общая наука ещё не входит в доступный запас и пока не расходуется на технологии.{pendingSharedScience === 0 ? ' В текущую добычу ещё не отправлены оплаченные смены.' : ''}</p>
        {active ? <p>Начислится после завершения операции: {date(current.endsAt)}. Осталось {remaining(current.endsAt, now)}.</p> : <>
          <p>{Number.isFinite(currentEndsAt) ? 'Время добычи вышло. Обнови состояние, чтобы завершить расчёт и увидеть начисление общей науки.' : 'Не удалось определить время завершения добычи. Обнови состояние перед проверкой начисления.'}</p>
          {onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить общую науку<GameIcon name="arrow" size={14} /></button>}
        </>}
      </div>}
      {hasMembership && current?.status === 'settled' && <p className="coopHint" data-coop-science-settled>Общая наука завершённой операции уже учтена в запасе альянса. Личные доли добычи забираются отдельно и не задерживают её начисление.</p>}
      <div className="coopTechnologyList">{state.progress.technologies.map(technology => {
        const max = technology.nextCost === null || technology.level >= technology.maxLevel;
        const key = `research:${technology.id}:${technology.level}`;
        return <article className="coopTechnology" key={technology.id} data-coop-technology={technology.id}><div><h3>{technology.name}</h3><span>Ур. {technology.level}/{technology.maxLevel}</span></div><p>{technology.effectText}</p>
          {!max && <p className="coopTechnologyCost">Следующий уровень: <GameAmount resource="science">{n(technology.nextCost)}</GameAmount> общей науки</p>}
          {!max && Number(technology.nextCost) > Number(state.progress?.sharedScience ?? 0) && <p className="coopShortage">Не хватает {n(Number(technology.nextCost) - Number(state.progress?.sharedScience ?? 0))} общей науки.</p>}
          {!max && !state.progress?.canResearch && <p className="coopHint">Исследование доступно владельцу и офицерам альянса.</p>}
          {!max && !state.available && <p className="coopHint">Исследования пока недоступны. Обнови данные альянса.</p>}
          <button type="button" className="action secondary" disabled={locked || !state.available || !hasMembership || max || !technology.canResearch || !state.progress?.canResearch || Number(state.progress.sharedScience) < Number(technology.nextCost)} onClick={() => { void act(key, { action: 'research', technologyId: technology.id, expectedLevel: technology.level }, 'Технология улучшена. Новый уровень применяется к следующим операциям.'); }}>{pendingKey === key ? 'Исследуем…' : max ? 'Максимальный уровень' : !state.progress?.canResearch ? 'Нужен владелец или офицер' : 'Исследовать за общую науку'}</button>{status(key)}
        </article>;
      })}</div>
    </> : <p className="coopHint">{hasMembership ? 'Данные общей науки пока недоступны. Проверь состояние совместной добычи.' : 'Технологии развиваются внутри альянса. Вступи в команду, чтобы участвовать.'}</p>}
    {success?.view === view && <div className="coopFeedback" role="status">{success.text}</div>}
  </section>;

  const contributeKey = `contribute:${current?.id}:${selectedRole?.id}`;
  const startKey = `start:${current?.id ?? 'first'}`;
  return <div className="allianceCooperation" data-alliance-cooperation>
    {!hasMembership && <section className="card"><h2><GameIcon name="social" size={22} />Совместная добыча</h2><p className="coopHint">Вступи в альянс, чтобы участвовать в добыче. Ранее заработанные доли можно получить ниже, даже без команды.</p></section>}
    {hasMembership && <section className="card coopOperation"><div className="cardTitleRow"><div><h2><GameIcon name="ore" size={22} />Полярный разрез</h2><p>Совместная добыча за {durationText(state?.rules.durationSec ?? 21600)}. Выбери свою роль в команде.</p></div>{current && <span className="coopOperationStatus">{active ? remaining(current.endsAt, now) : 'Завершено'}</span>}</div>
      <MechanicGuide steps={[
        'Запуск бесплатный. Выбор роли ничего не списывает; ресурсы тратятся только при отправке смены.',
        `Каждый может оплатить до ${n(maxUnits)} смен. Два участника с двумя ролями дают +10% руды, три с тремя ролями — +20%.`,
        'После завершения забери свою долю отдельно. Её размер зависит от твоих смен и итогового бонуса команды; срока получения нет.',
      ]} />
      <details className="coopEconomyGuide" data-coop-economy-guide><summary>Личная добыча и общая наука</summary><div>
        <p><strong>Твоя колония.</strong> Смена оплачивается из личных запасов. Полученные руда и кредиты идут на развитие города, а наука из доли — в твой личный запас для технологий колонии.</p>
        <p><strong>Твоя команда.</strong> Общая наука поступает альянсу после расчёта операции. Она не делится между игроками; владелец или офицер тратит её на технологии следующих операций.</p>
        <p>Можно отправить несколько смен с одной ролью. Для командного бонуса нужны одновременно разные участники и разные роли. Бонус увеличивает только руду.</p>
        <p>Доля добычи, AP мегапроекта и очки недельной лиги учитываются отдельно. Оплата смены не заменяет взнос в мегапроект.</p>
        <div className="coopGuideLinks">{onTechnology && <button type="button" className="miniButton" disabled={locked} onClick={onTechnology}>Технологии альянса<GameIcon name="arrow" size={13} /></button>}{onPersonalResearch && <button type="button" className="miniButton" disabled={locked} onClick={onPersonalResearch}>Личные исследования<GameIcon name="arrow" size={13} /></button>}{onOpenRating && <button type="button" className="miniButton" disabled={locked} onClick={onOpenRating}>Недельная лига<GameIcon name="arrow" size={13} /></button>}</div>
      </div></details>
      {!state || !state.available ? <div className="coopFeedback" role="status">Совместная добыча пока недоступна. {onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить</button>}</div>
        : current && active ? <>
          <div className="coopTeamSummary"><span><GameIcon name="social" size={16} />Участников <b>{n(current.participants)}</b></span><span>Ролей <b>{current.roles.length}/3</b></span><span>Бонус руды <b>+{n(current.teamBonusPercent)}%</b></span></div>
          <div className="coopNextBonus" data-coop-next-bonus>{current.teamBonusPercent >= 20 ? <><GameIcon name="check" size={17} /><span>Все роли собраны. Максимальный командный бонус — +20% руды.</span></> : <><GameIcon name="network" size={17} /><span>До +{nextBonus}%: участников {Math.min(current.participants, nextTarget)}/{nextTarget}, ролей {Math.min(current.roles.length, nextTarget)}/{nextTarget}.{missingRoles.length > 0 ? ` Свободные роли: ${missingRoles.map(id => ROLE_LABELS[id].toLocaleLowerCase('ru-RU')).join(', ')}.` : ' Нужен вклад ещё одного участника.'}</span></>}</div>
          <fieldset className="coopRoleField" disabled={locked || !freeUnits}><legend>Твоя следующая смена · {n(current.myUnits)} из {n(maxUnits)} оплачено</legend><div className="coopRoleChoices">{state.roleOptions.map(option => <label key={option.id} className={selectedRole?.id === option.id ? 'isSelected' : ''}><input type="radio" name={`coop-role-${current.id}`} value={option.id} checked={selectedRole?.id === option.id} aria-label={option.name} onChange={() => setRole(option.id)} /><GameIcon name={ROLE_ICONS[option.id]} size={24} /><span>{ROLE_LABELS[option.id]}</span></label>)}</div></fieldset>
          {selectedRole && freeUnits > 0 ? <div className="coopSelectedRole"><h3>{selectedRole.name}</h3><div><span>Спишется из личных запасов</span>{amounts(selectedRole.cost)}</div>{Number(selectedRole.cost.science) > 0 && <p className="coopPersonalCost" data-coop-personal-science-cost>В стоимости указана твоя личная наука для технологий колонии. Общая наука альянса здесь не расходуется.</p>}<div><span>Твоя доля за смену · без командного бонуса</span>{amounts(selectedRole.reward)}</div><p className="coopHint">После завершения смена даст альянсу {n(state.rules.sharedSciencePerUnit)} общей науки. Командный бонус увеличит твою руду.</p>
            <button type="button" className="action" disabled={locked || shortages.length > 0} onClick={() => { void act(contributeKey, { action: 'contribute', operationId: current.id, role: selectedRole.id }, data => {
              const competition = data.result?.competition;
              return `Смена оплачена. Доля будет доступна после завершения добычи.${Number(competition?.points) > 0 ? ` Начислено ${n(competition.points)} очков лиги.` : competition?.eligible === false ? ' В рейтинге недели учитывается добыча первой выбранной команды.' : ''}`;
            }); }}>{pendingKey === contributeKey ? 'Отправляем…' : 'Оплатить одну смену'}</button>
            {shortages.length > 0 && <p className="coopShortage" role="status">Не хватает {shortages.map(([resource, amount]) => `${n(Number(amount) - Number(resources[resource as keyof Amounts] ?? 0))} ${RESOURCE_NAMES[resource] ?? resource}`).join(', ')}.</p>}{status(contributeKey)}
          </div> : <div className="coopFeedback" role="status">Твои {n(maxUnits)} смены уже оплачены. Можно вернуться за долей после завершения операции.</div>}
          {current.myUnits > 0 && <div className="coopMyShare"><strong>Твоя доля · предварительно</strong>{amounts(current.myReward)}<small>Готовность: {date(current.endsAt)}. Добыча идёт при закрытой игре.</small></div>}
        </> : current?.status === 'active' ? <div className="coopFeedback" role="status">Время добычи вышло. Обнови результат, чтобы получить готовую долю.{onRefresh && <button type="button" className="miniButton" disabled={locked} onClick={onRefresh}>Обновить результат</button>}</div>
          : <div className="coopStart"><p>Запуск бесплатный. Затем каждый участник может оплатить до {n(state.rules.maxUnitsPerPlayer)} смен; роли могут повторяться.</p><button type="button" className="action" disabled={locked} onClick={() => { void act(startKey, { action: 'start' }, data => data.result.started ? 'Совместная добыча началась. Теперь можно выбрать роль и оплатить смену.' : 'У команды уже есть активная добыча. Обнови альянс, чтобы выбрать роль.'); }}>{pendingKey === startKey ? 'Запускаем…' : current ? 'Начать следующую операцию' : 'Начать совместную добычу'}</button>{status(startKey)}</div>}
      {team.length > 0 && <details className="coopTeamRoster" data-coop-team><summary>{current?.status === 'active' ? 'Кто участвует в добыче' : 'Участники завершённой добычи'} · {n(team.length)}</summary><p className="coopHint">Здесь только принятые смены этой операции. Вклад сохраняется, даже если участник покинул альянс.</p><div className="coopTeamList">{team.slice(currentTeamPage * 5, currentTeamPage * 5 + 5).map((member, index) => <article className="coopTeamMember" key={currentTeamPage * 5 + index}><div><strong>{member.name}{member.isMe && <span> · ты</span>}</strong><b>{n(member.units)} / {n(maxUnits)} смены</b></div><div className="coopTeamRoles">{member.roles.map(role => <span key={role.id}><GameIcon name={ROLE_ICONS[role.id]} size={15} />{ROLE_LABELS[role.id]} · {n(role.units)}</span>)}</div>{!member.isCurrentMember && <small>Покинул альянс · вклад сохранён</small>}</article>)}</div>{teamPages > 1 && <div className="coopPagination"><button type="button" className="miniButton" disabled={currentTeamPage === 0} onClick={() => setTeamPage(currentTeamPage - 1)}>Назад</button><span>{currentTeamPage + 1}/{teamPages}</span><button type="button" className="miniButton" disabled={currentTeamPage + 1 >= teamPages} onClick={() => setTeamPage(currentTeamPage + 1)}>Далее</button></div>}</details>}
    </section>}
    {success?.view === view && <div className="coopFeedback" role="status">{success.text}</div>}
    {receive.length > 0 && <section className="card coopRewards" data-coop-rewards><h2><GameIcon name="contracts" size={22} />Твои доли добычи</h2><p>Заработанные доли остаются доступными после выхода из альянса. Срока получения нет.</p><div className="coopRewardList">{receive.slice(currentPage * 3, currentPage * 3 + 3).map(item => {
      const key = `claim:${item.id}`, ready = item.status === 'ready';
      return <article className="coopReward" key={item.id}><div><strong>{item.allianceName}</strong><small>{ready ? 'Готовая доля' : `Предварительная доля · ещё ${remaining(item.endsAt, now)}`} · смен: {n(item.units)}</small></div>{amounts(item.reward)}
        <button type="button" className="action secondary" disabled={locked || !ready || !item.canClaim} onClick={() => { void act(key, { action: 'claim', operationId: item.id }, data => `Добыча получена: ${Object.entries(data.result.reward).filter(([, value]) => Number(value) > 0).map(([resource, value]) => `${n(value)} ${RESOURCE_NAMES[resource] ?? resource}`).join(', ')}.`); }}>{pendingKey === key ? 'Получаем…' : ready ? 'Забрать долю' : 'Добыча идёт'}</button>
        {Number(item.storageShortages?.ore) > 0 && <p className="coopShortage">Нужно ещё {n(item.storageShortages.ore)} свободного места под руду. Потрать руду или расширь склад — доля сохранится целиком.</p>}{status(key)}</article>;
    })}</div>{pages > 1 && <div className="coopPagination"><button type="button" className="miniButton" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Назад</button><span>{currentPage + 1}/{pages}</span><button type="button" className="miniButton" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Далее</button></div>}</section>}
  </div>;
}
