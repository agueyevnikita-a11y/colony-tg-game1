'use client';

import { useEffect, useRef, useState } from 'react';
import { durationText } from '@/lib/game/format';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { allianceCreationQuote, contributionPoints, type AllianceCreationQuote, type AllianceResource } from '@/lib/game/alliance';
import { AllianceCooperationPanel, type AllianceCooperationState } from '@/components/AllianceCooperationPanel';
import { AllianceDirectory } from '@/components/AllianceDirectory';
import { SectionTabs } from '@/components/SectionTabs';
import type { AllianceDirectoryState } from '@/lib/game/alliance-directory';
import '@/app/alliance-panel.css';

type AllianceMember = {
  telegram_id: string | number;
  colony_name?: string;
  first_name?: string;
  username?: string;
  role: 'owner' | 'officer' | 'member';
  hq_level: string | number;
  city_score: string | number;
  contribution_points: string | number;
};

type AllianceState = {
  cooperation?: AllianceCooperationState;
  directory?: AllianceDirectoryState;
  entry?: { availableAt: string | null };
  membership?: { role: 'owner' | 'officer' | 'member' } | null;
  alliance?: {
    id?: string;
    name: string;
    code: string;
    members?: AllianceMember[];
    memberLimit: number;
    officerCount?: number;
    prestige: number;
    seasonPoints: number;
  };
  project?: {
    title: string;
    description: string;
    status: string;
    cycle: number;
    stage: number;
    ore_contributed: string | number;
    energy_contributed: string | number;
    parts_contributed: string | number;
    stageConfig: { title: string; description: string; target: Record<AllianceResource, number>; minimumContributionPoints: number };
    myContribution?: { points: string | number }[];
    canRestart?: boolean;
    restartAvailableAt?: string | null;
  };
  dailyGoals?: {
    goal_key: string;
    title?: string;
    description?: string;
    completed_at?: string | null;
    my_claimed_at?: string | null;
    my_contribution?: string | number;
    progress: string | number;
    target: string | number;
    reward_crystals: string | number;
    reward_credits: string | number;
  }[];
  recommended?: { id: string; name: string; code: string; members: number; member_limit: number; season_points: string | number }[];
  rules?: { createCost?: number; createCurrency?: 'credits' | 'crystals'; createHq?: number; joinHq?: number; memberLimit?: number; officerLimit?: number; rejoinCooldownHours?: number; restartCooldownHours?: number };
};

type Props = {
  alliance?: AllianceState;
  cooperation?: AllianceCooperationState;
  resources: Partial<Record<AllianceResource | 'credits' | 'science' | 'crystals', number | string>>;
  hqLevel: number;
  telegramId?: number | string;
  busy: boolean;
  enabled: boolean;
  initialCode?: string;
  onShare: () => void;
  onViewCity: (telegramId: number) => void;
  onAction: (path: string, body?: Record<string, unknown>) => Promise<any>;
  onDirectorySearch?: (query: string, page: number) => Promise<AllianceDirectoryState>;
  onRefresh?: () => void;
  onNavigate?: (action: 'build' | 'production' | 'contracts') => void;
};

type Feedback = { text: string; error: boolean };
type Confirmation = { kind: 'leave' } | { kind: 'kick' | 'transfer'; telegramId: string | number; name: string };
type AllianceSection = 'mining' | 'technology' | 'project' | 'goals' | 'members';
type EntrySection = 'find' | 'code' | 'create';
const MEMBERS_PER_PAGE = 5;
const RESOURCES: AllianceResource[] = ['ore', 'energy', 'parts'];
const RESOURCE_LABELS = { ore: 'руды', energy: 'энергии', parts: 'деталей' };
const RESOURCE_COLUMNS = { ore: 'ore_contributed', energy: 'energy_contributed', parts: 'parts_contributed' } as const;
const n = (value: unknown) => Number(value ?? 0).toLocaleString('ru-RU');
const pct = (value: unknown, target: unknown) => Math.min(100, Math.max(0, Number(value ?? 0) / Math.max(1, Number(target ?? 1)) * 100));
const memberName = (member: AllianceMember) => member.colony_name || member.first_name || member.username || String(member.telegram_id);
const DAILY_GOAL_ACTIONS: Record<string, { action: 'build' | 'production' | 'contracts'; label: string }> = {
  team_build: { action: 'build', label: 'К постройкам' },
  team_foundry: { action: 'production', label: 'К цехам' },
  team_contracts: { action: 'contracts', label: 'К контрактам' },
};

function timeRemaining(timestamp: string | null | undefined, now: number) {
  if (!timestamp) return '';
  return durationText((Date.parse(timestamp) - now) / 1000);
}

export function AlliancePanel({ alliance, cooperation, resources, hqLevel, telegramId, busy, enabled, initialCode = '', onShare, onViewCity, onAction, onDirectorySearch, onRefresh, onNavigate }: Props) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState('');
  const [resource, setResource] = useState<AllianceResource>('ore');
  const [amount, setAmount] = useState('100');
  const [pendingKey, setPendingKey] = useState('');
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [membershipFeedback, setMembershipFeedback] = useState<Feedback | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [createConfirmation, setCreateConfirmation] = useState<(AllianceCreationQuote & { name: string }) | null>(null);
  const [section, setSection] = useState<AllianceSection>('mining');
  const [entrySection, setEntrySection] = useState<EntrySection>(() => initialCode ? 'code' : 'find');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const submittingRef = useRef(false);
  const miningNavigationPending = useRef(false);
  const cooperationPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (section !== 'mining' || !miningNavigationPending.current) return;
    miningNavigationPending.current = false;
    const element = cooperationPanelRef.current;
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [section]);
  useEffect(() => { setCode(initialCode); if (initialCode) setEntrySection('code'); }, [initialCode]);
  useEffect(() => { setSection('mining'); setConfirmation(null); setCreateConfirmation(null); setMemberSearch(''); setMemberPage(0); }, [alliance?.alliance?.id, alliance?.alliance?.code, telegramId]);
  useEffect(() => {
    setNow(Date.now());
    if (!(alliance?.project?.status === 'completed' && alliance.project.restartAvailableAt) && !alliance?.entry?.availableAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [alliance?.project?.status, alliance?.project?.restartAvailableAt, alliance?.entry?.availableAt]);

  const locked = busy || !!pendingKey;
  const rules = alliance?.rules;
  const joinLevel = Number(rules?.joinHq ?? 2);
  const createLevel = Number(rules?.createHq ?? 3);
  const createQuote = allianceCreationQuote(rules);
  const createCost = createQuote?.cost ?? 0;
  const createCurrency = createQuote?.currency ?? 'crystals';
  const createCurrencyLabel = createCurrency === 'crystals' ? 'кристаллов' : 'кредитов';
  const createBalance = Number(resources[createCurrency] ?? 0);
  const cooldown = Number(rules?.rejoinCooldownHours ?? 24);
  const entryAvailableAt = alliance?.entry?.availableAt;
  const entryWaiting = !!entryAvailableAt && Date.parse(entryAvailableAt) > now;
  const entryWaitMessage = entryWaiting ? `После выхода действует перерыв. Осталось ${timeRemaining(entryAvailableAt, now)}.` : '';
  const directoryJoinIssue = entryWaitMessage || (hqLevel < joinLevel ? `Для вступления нужен центр колонии ур. ${joinLevel}. Сейчас ур. ${hqLevel}.` : '');
  const group = alliance?.alliance;
  const project = alliance?.project;
  const members = group?.members ?? [];
  const normalizedSearch = memberSearch.trim().toLocaleLowerCase('ru-RU').replace(/^@/, '');
  const matchingMembers = members.filter((member) => !normalizedSearch || [member.colony_name, member.first_name, member.username, member.telegram_id].some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(normalizedSearch)));
  const memberPages = Math.max(1, Math.ceil(matchingMembers.length / MEMBERS_PER_PAGE));
  const currentMemberPage = Math.min(memberPage, memberPages - 1);
  const visibleMembers = matchingMembers.slice(currentMemberPage * MEMBERS_PER_PAGE, (currentMemberPage + 1) * MEMBERS_PER_PAGE);
  const dailyGoals = alliance?.dailyGoals ?? [];
  const readyGoals = dailyGoals.filter((goal) => goal.completed_at && !goal.my_claimed_at && Number(goal.my_contribution ?? 0) > 0).length;
  const myRole = alliance?.membership?.role;
  const hasMembership = !!alliance?.membership && !!group;
  const cooperationState = cooperation ?? alliance?.cooperation;
  const ownerMustTransfer = myRole === 'owner' && members.length > 1;
  const available = Math.max(0, Math.floor(Number(resources[resource] ?? 0)));
  const needed = project ? Math.max(0, Number(project.stageConfig.target[resource] ?? 0) - Number(project[RESOURCE_COLUMNS[resource]] ?? 0)) : 0;
  const validInteger = /^[1-9]\d*$/.test(amount) && Number.isSafeInteger(Number(amount));
  const requested = validInteger ? Number(amount) : 0;
  const minimum = resource === 'parts' ? 10 : 100;
  const accepted = Math.min(requested, needed);
  const deficit = Math.max(0, accepted - available);
  const contributionIssue = !validInteger ? 'Введи целое положительное число без пробелов.'
    : requested < minimum ? `Минимальный запрос — ${n(minimum)} ${RESOURCE_LABELS[resource]}. Если до завершения этапа нужно меньше, спишется только остаток.`
    : !project || project.status !== 'active' ? 'Сейчас нет активного этапа.'
    : needed <= 0 ? 'Этот ресурс для текущего этапа уже собран. Выбери другой.'
    : deficit > 0 ? `Не хватает ${n(deficit)} ${RESOURCE_LABELS[resource]} для этого взноса.` : '';
  const cleanName = name.trim().replace(/\s+/g, ' ');
  const nameIssue = cleanName.length < 3 || cleanName.length > 28 ? 'Название должно содержать от 3 до 28 символов.'
    : !/^[\p{L}\p{N} ._\-]+$/u.test(cleanName) ? 'Используй буквы, цифры, пробел, точку, дефис или знак подчёркивания.' : '';
  const createDeficit = Math.max(0, createCost - createBalance);
  const joinIssue = entryWaitMessage || (hqLevel < joinLevel ? `Улучши центр колонии до ур. ${joinLevel}. Сейчас ур. ${hqLevel}.` : !code.trim() ? 'Введи код, которым поделился участник альянса.' : '');
  const createIssue = !createQuote ? 'Цена пока не получена. Обнови игру перед созданием альянса.'
    : entryWaitMessage || (hqLevel < createLevel ? `Для создания нужен центр колонии ур. ${createLevel}. Сейчас ур. ${hqLevel}.`
    : createDeficit > 0 ? `Нужно ${n(createCost)} ${createCurrencyLabel}, в наличии ${n(createBalance)}. Не хватает ${n(createDeficit)}.` : nameIssue);
  const createConfirmationMatches = !!createConfirmation && createConfirmation.name === cleanName && createConfirmation.cost === createCost && createConfirmation.currency === createCurrency;
  const restartWaiting = !!project?.restartAvailableAt && new Date(project.restartAvailableAt).getTime() > now;
  const hiddenMemberFeedback = Object.keys(feedback).filter((key) => key.startsWith('member-') && !visibleMembers.some((member) => key === `member-${member.telegram_id}`));
  const hiddenSectionFeedback = Object.keys(feedback).filter((key) =>
    ((key === 'contribute' || key === 'restart') && (section !== 'project' || !project)) ||
    (key.startsWith('daily-') && section !== 'goals') ||
    (key.startsWith('member-') && section !== 'members'));

  function cancelMemberConfirmation() {
    setConfirmation((previous) => previous?.kind === 'leave' ? previous : null);
  }

  function changeSection(next: AllianceSection) {
    if (next === section) return;
    cancelMemberConfirmation();
    setSection(next);
  }

  function status(key: string) {
    const item = feedback[key];
    return item ? <div className={`allianceFeedback ${item.error ? 'isError' : ''}`} role={item.error ? 'alert' : 'status'}>{item.text}</div> : null;
  }

  async function act(key: string, path: string, body: Record<string, unknown> | undefined, success: (data: any) => string, membershipChange = false) {
    if (!enabled || busy || submittingRef.current) return;
    submittingRef.current = true;
    setPendingKey(key);
    setFeedback((previous) => { const next = { ...previous }; delete next[key]; return next; });
    if (membershipChange) setMembershipFeedback(null);
    try {
      const data = await onAction(path, body);
      const result = { text: success(data), error: false };
      setFeedback((previous) => ({ ...previous, [key]: result }));
      if (membershipChange) setMembershipFeedback(result);
      setConfirmation(null);
      setCreateConfirmation(null);
    } catch (cause) {
      setFeedback((previous) => ({ ...previous, [key]: { text: cause instanceof Error ? cause.message : 'Не удалось выполнить действие. Попробуй ещё раз.', error: true } }));
    } finally {
      submittingRef.current = false;
      setPendingKey('');
    }
  }

  function join(joinCode: string, key = 'join', allianceName?: string) {
    if (entryWaiting || hqLevel < joinLevel || !joinCode.trim()) return;
    void act(key, '/api/alliance/join', { code: joinCode.trim().toUpperCase() }, () => allianceName ? `Ты вступил в «${allianceName}».` : 'Ты вступил в альянс.', true);
  }

  function confirmCreate() {
    if (!createConfirmationMatches || !createConfirmation || createIssue || locked) return;
    const confirmed = createConfirmation;
    void act('create', '/api/alliance/create', {
      name: confirmed.name, expectedCreateCost: confirmed.cost, expectedCreateCurrency: confirmed.currency,
    }, () => `Альянс «${confirmed.name}» создан. Списано ${n(confirmed.cost)} ${confirmed.currency === 'crystals' ? 'кристаллов' : 'кредитов'}.`, true);
  }

  function confirmAction() {
    if (!confirmation || locked) return;
    if (confirmation.kind === 'leave') {
      if (ownerMustTransfer) return;
      void act('leave', '/api/alliance/leave', undefined, () => `Ты вышел из «${group?.name ?? 'альянса'}». Следующее вступление доступно через ${cooldown} ч.`, true);
      return;
    }
    const target = confirmation;
    const current = members.find((member) => String(member.telegram_id) === String(target.telegramId));
    const isMe = String(target.telegramId) === String(telegramId);
    if (!current || isMe) { setConfirmation(null); return; }
    const canKick = (myRole === 'owner' && current.role !== 'owner') || (myRole === 'officer' && current.role === 'member');
    if (target.kind === 'kick' ? !canKick : myRole !== 'owner') { setConfirmation(null); return; }
    void act(`member-${target.telegramId}`, `/api/alliance/manage/${target.kind}`, { telegramId: target.telegramId }, () => target.kind === 'kick' ? `«${target.name}» исключён из альянса.` : `Руководство передано игроку «${target.name}». Ты теперь обычный участник.`);
  }

  function confirmationBox(target: Confirmation) {
    const leave = target.kind === 'leave';
    return <div className="allianceConfirm" role="group" aria-label="Подтверждение действия">
      <strong>{leave ? `Выйти из «${group?.name ?? 'альянса'}»?` : target.kind === 'kick' ? `Исключить «${target.name}»?` : `Передать руководство игроку «${target.name}»?`}</strong>
      <p>{leave ? `${myRole === 'owner' ? 'Альянс будет удалён, поскольку в нём остался только ты. ' : ''}Взносы в проект не возвращаются. Оплаченные доли добычи и заработанные призы лиги сохранятся. Вступить в другой альянс или создать свой можно через ${cooldown} ч.` : target.kind === 'kick' ? `Игрок потеряет членство и сможет вступить в альянс снова через ${cooldown} ч. Взносы останутся в проекте. Его оплаченная добыча и заработанные призы лиги сохранятся.` : 'Ты станешь обычным участником и потеряешь управление альянсом. Новый владелец сможет назначать офицеров и передавать руководство.'}</p>
      <div className="allianceConfirmActions"><button type="button" className="miniButton" disabled={locked} onClick={() => setConfirmation(null)}>Отмена</button><button type="button" className={`miniButton ${target.kind === 'transfer' ? '' : 'dangerMini'}`} disabled={locked} onClick={confirmAction}>{pendingKey ? 'Выполняем…' : leave ? 'Да, выйти' : target.kind === 'kick' ? 'Да, исключить' : 'Да, передать'}</button></div>
    </div>;
  }

  if (!enabled) return <section className="card"><h2><GameIcon name="shield" />Альянсы временно на паузе</h2><p>Альянсы недоступны на текущем этапе закрытого теста. Уже созданные данные сохраняются.</p></section>;

  return <div className="alliancePanel">
    {hasMembership && group ? <>
      <section className="card allianceHero">
        <div className="cardTitleRow"><div><h2><GameIcon name="shield" />{group.name}</h2><p>Код: <b>{group.code}</b> · {members.length}/{group.memberLimit} участников · престиж {n(group.prestige)}</p></div><div className="coopHeroScience"><GameAmount resource="science" size={22}>{n(cooperationState?.progress?.sharedScience)}</GameAmount><span>общая наука</span></div></div>
        <div className="allianceHeroActions"><button type="button" className="action" disabled={locked} onClick={onShare}><GameIcon name="share" size={15} />Пригласить</button><button type="button" className="action secondary" disabled={locked || ownerMustTransfer} onClick={() => { setConfirmation({ kind: 'leave' }); setFeedback((previous) => { const next = { ...previous }; delete next.leave; return next; }); }}>Выйти</button></div>
        {ownerMustTransfer && <p className="finePrint">Чтобы выйти, сначала передай руководство в разделе «Участники».</p>}
        {confirmation?.kind === 'leave' && confirmationBox(confirmation)}
        {status('leave')}
        {membershipFeedback && <div className="allianceFeedback" role="status">{membershipFeedback.text}</div>}
        {hiddenSectionFeedback.map((key) => <div key={key}>{status(key)}</div>)}
      </section>

      <SectionTabs label="Разделы альянса" items={[
        { key: 'mining', label: 'Добыча', icon: 'ore', badge: cooperationState?.pending.filter(item => item.status === 'ready').length },
        { key: 'technology', label: 'Технологии', icon: 'research' },
        { key: 'project', label: 'Проект', icon: 'signal' },
        { key: 'goals', label: 'Цели', icon: 'target', badge: readyGoals },
        { key: 'members', label: 'Участники', icon: 'social', badge: members.length },
      ]} value={section} onChange={key => changeSection(key as AllianceSection)} />

      <div ref={cooperationPanelRef} tabIndex={-1} hidden={section !== 'mining' && section !== 'technology'}><AllianceCooperationPanel cooperation={cooperationState} view={section === 'technology' ? 'technology' : 'mining'} resources={resources} hasMembership={hasMembership} ownerKey={String(telegramId ?? '')} allianceKey={group.id ?? group.code} busy={locked} onAction={onAction} onRefresh={onRefresh} onMining={() => { miningNavigationPending.current = true; changeSection('mining'); }} /></div>

      {section === 'goals' && <section className="card allianceDaily" id="alliance-goals-section"><h2><GameIcon name="target" />Командные цели дня</h2><p>Выполняются общими усилиями. Личную награду получает участник, который внёс вклад до завершения цели.</p>{onNavigate && <p className="finePrint">Кнопки открывают нужный раздел. Ресурсы расходуются при подтверждении выбранного действия.</p>}<div className="stack">{dailyGoals.map((goal) => {
        const done = !!goal.completed_at;
        const contributed = Number(goal.my_contribution ?? 0) > 0;
        const key = `daily-${goal.goal_key}`;
        const destination = DAILY_GOAL_ACTIONS[goal.goal_key];
        return <div className="mission" key={goal.goal_key} data-alliance-goal={goal.goal_key}>
          <div className="missionHead"><div><strong>{goal.title ?? goal.goal_key}</strong><small>{goal.description?.replace('NPC-контрактов', 'контрактов с колонией')}</small></div><span className="missionRewards"><GameAmount resource="crystals">{n(goal.reward_crystals)}</GameAmount><GameAmount resource="credits">{n(goal.reward_credits)}</GameAmount></span></div>
          <div className="progress"><i style={{ width: `${pct(goal.progress, goal.target)}%` }} /></div>
          <div className="missionFoot"><span>{n(goal.progress)}/{n(goal.target)} · твой вклад {n(goal.my_contribution)}</span>
            {!done && destination && onNavigate
              ? <button type="button" className="miniButton" disabled={locked} onClick={() => onNavigate(destination.action)}>{destination.label}<GameIcon name="arrow" size={13} /></button>
              : <button type="button" className="miniButton" disabled={locked || !done || !contributed || !!goal.my_claimed_at} onClick={() => { void act(key, '/api/alliance/daily/claim', { goalKey: goal.goal_key }, (data) => `Награда получена: ${n(data.result?.credits ?? goal.reward_credits)} кредитов и ${n(data.result?.crystals ?? goal.reward_crystals)} кристаллов.`); }}>{pendingKey === key ? 'Получаем…' : goal.my_claimed_at ? 'Получено' : done ? contributed ? 'Забрать' : 'Нет вклада' : 'В процессе'}</button>}
          </div>
          {done && !contributed && <p className="finePrint">В эту цель нужно было внести вклад до её завершения. Участвуй в следующих целях.</p>}{status(key)}
        </div>;
      })}</div>{!dailyGoals.length && <p className="finePrint">Командные цели появятся здесь после обновления дня.</p>}</section>}

      {section === 'project' && (project ? <section className="card allianceProject" id="alliance-project-section">
        <div className="cardTitleRow"><div><h2><GameIcon name="signal" />{project.title}</h2><p>{project.description}</p></div><div className="projectStage">{project.status === 'completed' ? `Цикл ${project.cycle} готов` : `Цикл ${project.cycle} · этап ${project.stage}/3`}</div></div>
        {project.status === 'active' ? <>
          <h3>{project.stageConfig.title}</h3><p>{project.stageConfig.description}</p>
          <div className="projectResources">{RESOURCES.map((item) => {
            const have = Number(project[RESOURCE_COLUMNS[item]] ?? 0);
            const target = Number(project.stageConfig.target[item] ?? 0);
            return <div className="projectResource" key={item}><div><b><GameAmount resource={item}>{n(have)}</GameAmount></b><span>/ {n(target)}</span></div><div className="progress"><i style={{ width: `${pct(have, target)}%` }} /></div></div>;
          })}</div>
          <form className="allianceContributionForm" onSubmit={(event) => {
            event.preventDefault();
            if (contributionIssue || locked) return;
            void act('contribute', '/api/alliance/contribute', { resource, amount: requested }, (data) => {
              const result = data.result ?? {};
              const actual = Number(result.accepted ?? 0);
              return `Внесено ${n(actual)} ${RESOURCE_LABELS[resource]} · +${n(result.points)} AP.${actual < requested ? ` Остальные ${n(requested - actual)} ${RESOURCE_LABELS[resource]} не списаны.` : ''}${result.stageCompleted ? ' Этап завершён!' : ''}`;
            });
          }}>
            <div className="allianceContributionFields"><label>Ресурс<select value={resource} disabled={locked} onChange={(event) => { setResource(event.target.value as AllianceResource); setFeedback((previous) => { const next = { ...previous }; delete next.contribute; return next; }); }}><option value="ore">Руда</option><option value="energy">Энергия</option><option value="parts">Детали</option></select></label><label>Количество<input aria-label="Количество для взноса" aria-describedby="alliance-contribution-help" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={amount} disabled={locked} onChange={(event) => { setAmount(event.target.value); setFeedback((previous) => { const next = { ...previous }; delete next.contribute; return next; }); }} /></label></div>
            <div className="allianceContributionSummary"><span>В наличии <GameAmount resource={resource}>{n(available)}</GameAmount></span><span>Нужно этапу <GameAmount resource={resource}>{n(needed)}</GameAmount></span></div>
            <p className={`allianceContributionHelp ${contributionIssue ? 'isUnavailable' : ''}`} id="alliance-contribution-help">{contributionIssue || `Спишется ${n(accepted)} ${RESOURCE_LABELS[resource]}, твой вклад +${n(contributionPoints(resource, accepted))} AP.${requested > needed ? ` Оставшиеся ${n(requested - accepted)} не списываются.` : ''}`}</p>
            <button type="submit" className="action" disabled={locked || !!contributionIssue}>{pendingKey === 'contribute' ? 'Вносим…' : 'Внести в проект'}</button>
          </form>
          <p className="finePrint">Внесённые ресурсы не возвращаются. Stars здесь не используются. Для награды этапа нужно минимум {n(project.stageConfig.minimumContributionPoints)} очков личного вклада в этом цикле. Твой вклад: {n((project.myContribution ?? []).reduce((sum, entry) => sum + Number(entry.points ?? 0), 0))} AP.</p>
        </> : <div className="projectComplete"><b><GameIcon name="check" size={16} />Цикл {project.cycle} завершён</b><span>Каждый новый цикл добавляет к требованиям 35% ресурсов первого цикла, повышает пожизненный престиж альянса и продлевает ветеранский визуальный эффект.</span>{project.canRestart && <><button type="button" className="action" disabled={locked || restartWaiting} onClick={() => { void act('restart', '/api/alliance/project/restart', undefined, () => 'Новый цикл мегапроекта запущен.'); }}><GameIcon name="refresh" size={15} />{pendingKey === 'restart' ? 'Запускаем…' : 'Запустить следующий цикл'}</button>{restartWaiting && <p className="finePrint">Можно запустить через {timeRemaining(project.restartAvailableAt, now)}.</p>}</>}{!project.canRestart && <p className="finePrint">Следующий цикл запускает владелец или офицер альянса после перерыва {rules?.restartCooldownHours ?? 6} ч.</p>}</div>}
        {status('contribute')}
        {status('restart')}
      </section> : <section className="card allianceProject" id="alliance-project-section"><h2><GameIcon name="signal" />Проект альянса</h2><p>Данные проекта появятся после обновления альянса.</p></section>)}

      {section === 'members' && <section className="card allianceMembers" id="alliance-members-section"><h2><GameIcon name="social" />Участники альянса</h2><p className="finePrint">Владелец назначает до {rules?.officerLimit ?? 5} офицеров. Офицеры могут исключать обычных участников и запускать следующий цикл.</p>
        <label className="allianceMemberSearch" htmlFor="alliance-member-search">Поиск участников<input id="alliance-member-search" type="search" autoComplete="off" placeholder="Имя, @username или ID" value={memberSearch} onChange={(event) => { cancelMemberConfirmation(); setMemberSearch(event.target.value); setMemberPage(0); }} /></label>
        <p className="allianceMemberCount">{normalizedSearch ? `Найдено: ${matchingMembers.length} из ${members.length}` : `Всего: ${members.length} из ${group.memberLimit}`} · по {MEMBERS_PER_PAGE} на странице</p>
        {hiddenMemberFeedback.map((key) => <div key={key}>{status(key)}</div>)}
        <div className="stack">{visibleMembers.map((member, index) => {
          const isMe = String(member.telegram_id) === String(telegramId);
          const canKick = (myRole === 'owner' && !isMe && member.role !== 'owner') || (myRole === 'officer' && !isMe && member.role === 'member');
          const key = `member-${member.telegram_id}`;
          const officerLimitReached = member.role !== 'officer' && Number(group.officerCount ?? members.filter((entry) => entry.role === 'officer').length) >= Number(rules?.officerLimit ?? 5);
          return <div className="memberCard" data-alliance-member={String(member.telegram_id)} key={member.telegram_id}><div><strong>{currentMemberPage * MEMBERS_PER_PAGE + index + 1}. {memberName(member)} {isMe && <span className="allianceMe">· ты</span>} {member.role === 'owner' ? <GameIcon name="crown" size={15} title="Владелец альянса" /> : member.role === 'officer' ? <GameIcon name="shield" size={15} title="Офицер альянса" /> : null}</strong><small>Центр ур. {member.hq_level} · рейтинг города {n(member.city_score)} · проект {n(member.contribution_points)} AP</small></div><div className="memberActions"><button type="button" className="miniButton" disabled={locked} onClick={() => onViewCity(Number(member.telegram_id))}>Город</button>{myRole === 'owner' && !isMe && member.role !== 'owner' && <button type="button" className="miniButton" disabled={locked || officerLimitReached} onClick={() => {
            void act(key, '/api/alliance/manage/role', { telegramId: member.telegram_id, role: member.role === 'officer' ? 'member' : 'officer' }, () => member.role === 'officer' ? `«${memberName(member)}» теперь обычный участник.` : `«${memberName(member)}» назначен офицером.`);
          }}>{member.role === 'officer' ? 'Снять офицера' : 'Офицер'}</button>}{myRole === 'owner' && !isMe && <button type="button" className="miniButton" disabled={locked} onClick={() => setConfirmation({ kind: 'transfer', telegramId: member.telegram_id, name: memberName(member) })}>Передать</button>}{canKick && <button type="button" className="miniButton dangerMini" disabled={locked} onClick={() => setConfirmation({ kind: 'kick', telegramId: member.telegram_id, name: memberName(member) })}>Исключить</button>}</div>
            {myRole === 'owner' && !isMe && officerLimitReached && <p className="finePrint allianceMemberNote">Все места офицеров заняты. Сначала сними роль с одного из действующих офицеров.</p>}
            {confirmation && confirmation.kind !== 'leave' && String(confirmation.telegramId) === String(member.telegram_id) && confirmationBox(confirmation)}
            <div className="allianceMemberFeedback">{status(key)}</div>
          </div>;
        })}</div>
        {!matchingMembers.length && <p className="allianceMemberEmpty">Никого не нашли. Попробуй другое имя, username или ID.</p>}
        <div className="allianceMemberPagination" aria-label="Страницы участников"><button type="button" className="miniButton" disabled={currentMemberPage === 0} onClick={() => { cancelMemberConfirmation(); setMemberPage(currentMemberPage - 1); }}>Назад</button><span aria-live="polite">{currentMemberPage + 1}/{memberPages}</span><button type="button" className="miniButton" disabled={currentMemberPage + 1 >= memberPages} onClick={() => { cancelMemberConfirmation(); setMemberPage(currentMemberPage + 1); }}>Далее</button></div>
      </section>}
    </> : <>
      {cooperationState && <AllianceCooperationPanel cooperation={cooperationState} view="mining" resources={resources} hasMembership={false} ownerKey={String(telegramId ?? '')} busy={locked} onAction={onAction} onRefresh={onRefresh} />}
      <section className="card allianceEntry"><h2><GameIcon name="shield" />Найди свою команду</h2><p>Добывайте ресурсы вместе, развивайте общие технологии и боритесь за призы недельной лиги.</p>
        <div className="allianceEntryBenefits"><span><GameIcon name="ore" size={19} /><b>Личная добыча</b><small>За твою помощь команде</small></span><span><GameIcon name="research" size={19} /><b>Общая наука</b><small>Для технологий альянса</small></span><span><GameIcon name="trophy" size={19} /><b>Призы лиги</b><small>За личный и общий вклад</small></span></div>
        {membershipFeedback && <div className="allianceFeedback" role="status">{membershipFeedback.text}</div>}
        {entryWaiting && <div className="allianceEntryWait" role="status"><GameIcon name="clock" size={19} /><div><strong>Перерыв перед новой командой</strong><p>{entryWaitMessage}</p><small>Доступно {new Date(entryAvailableAt!).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Список можно изучать сейчас.</small></div></div>}
        <SectionTabs label="Вступление в альянс" value={entrySection} items={[{ key: 'find', label: 'Найти', icon: 'network' }, { key: 'code', label: 'По коду', icon: 'share' }, { key: 'create', label: 'Создать', icon: 'shield' }]} onChange={key => { setEntrySection(key as EntrySection); setCreateConfirmation(null); }} />
        <div hidden={entrySection !== 'find'}>
          {alliance?.directory ? <AllianceDirectory initial={alliance.directory} busy={locked} joinIssue={directoryJoinIssue} pendingJoin={pendingKey} onSearch={onDirectorySearch} onJoin={entry => join(entry.code, `join-${entry.id}`, entry.name)} renderFeedback={id => status(`join-${id}`)} /> : <div className="allianceRecommended"><h3>Открытые альянсы</h3>{directoryJoinIssue && <p className="finePrint">{directoryJoinIssue}</p>}<div className="stack">{(alliance?.recommended ?? []).map(entry => <div className="allianceRecommendedRow" key={entry.id}><div><strong>{entry.name}</strong><small>{entry.code} · {entry.members}/{entry.member_limit} участников</small></div><button type="button" className="miniButton" disabled={locked || !!directoryJoinIssue || entry.members >= entry.member_limit} onClick={() => join(entry.code, `join-${entry.id}`, entry.name)}>{pendingKey === `join-${entry.id}` ? 'Вступаем…' : entry.members >= entry.member_limit ? 'Мест нет' : 'Вступить'}</button><div className="allianceRecommendedFeedback">{status(`join-${entry.id}`)}</div></div>)}</div>{!alliance?.recommended?.length && <p className="finePrint">Список пока пуст. Можно вступить по коду или создать команду.</p>}</div>}
        </div>
        <div hidden={entrySection !== 'code'}><form className="allianceEntryForm" onSubmit={(event) => { event.preventDefault(); if (!joinIssue && !locked) join(code); }}><label htmlFor="alliance-join-code">Код из приглашения<input id="alliance-join-code" aria-describedby="alliance-join-help" value={code} maxLength={80} autoCapitalize="characters" autoComplete="off" disabled={locked} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Код альянса" /></label><button type="submit" className="action" disabled={locked || !!joinIssue}>{pendingKey === 'join' ? 'Вступаем…' : 'Вступить бесплатно'}</button><p className="finePrint" id="alliance-join-help">{joinIssue || `Нужен центр ур. ${joinLevel}. Ресурсы за вступление не списываются.`}</p>{status('join')}</form></div>
        <div hidden={entrySection !== 'create'}><form className="allianceEntryForm" onSubmit={(event) => { event.preventDefault(); if (createIssue || locked || !createQuote) return; setCreateConfirmation({ ...createQuote, name: cleanName }); }}>
          <p className="finePrint">Создание — с центра ур. {createLevel}. Плата только за основание своей команды; вступление в готовый альянс бесплатное.</p>
          <label htmlFor="alliance-create-name">Название команды<input id="alliance-create-name" aria-describedby="alliance-create-help" value={name} maxLength={28} disabled={locked} onChange={(event) => { setName(event.target.value); setCreateConfirmation(null); }} placeholder="Название нового альянса" /></label>
          {!createConfirmationMatches && <button type="submit" className="action secondary" disabled={locked || !!createIssue}>{createQuote ? <>Создать · <GameAmount resource={createCurrency}>{n(createCost)}</GameAmount></> : 'Обнови игру для получения цены'}</button>}
          <p className="finePrint" id="alliance-create-help">{createIssue || `В наличии ${n(createBalance)} ${createCurrencyLabel}. При создании спишется ${n(createCost)}.`}</p>
          {createCurrency === 'crystals' && <p className="finePrint">Кристаллы можно заработать в заданиях и достижениях. Покупка за Stars не требуется.</p>}
          {createConfirmationMatches && createConfirmation && <div className="allianceConfirm allianceCreateConfirm" role="group" aria-label="Подтверждение создания альянса">
            <strong>Создать «{createConfirmation.name}»?</strong>
            <p>Спишется <GameAmount resource={createConfirmation.currency}>{n(createConfirmation.cost)}</GameAmount> {createCurrencyLabel}. Это разовая плата за создание; после выхода или удаления альянса она не возвращается.</p>
            <p>Участники вступают бесплатно. Само создание не увеличивает добычу: бонусы открываются совместной работой.</p>
            <div className="allianceConfirmActions"><button type="button" className="miniButton" disabled={locked} onClick={() => setCreateConfirmation(null)}>Отмена</button><button type="button" className="miniButton" disabled={locked || !!createIssue} onClick={confirmCreate}>{pendingKey === 'create' ? 'Создаём…' : <>Подтвердить · <GameAmount resource={createConfirmation.currency}>{n(createConfirmation.cost)}</GameAmount></>}</button></div>
          </div>}
          {status('create')}
        </form></div>
        <details className="allianceEntryRules"><summary>Правила вступления</summary><p className="finePrint">Вступление бесплатное с центра ур. {joinLevel}. После выхода или исключения действует перерыв {cooldown} ч. Вместимость — {rules?.memberLimit ?? 30} участников. Оплаченная добыча и заработанные призы сохраняются после выхода.</p></details>
      </section>
    </>}
  </div>;
}
