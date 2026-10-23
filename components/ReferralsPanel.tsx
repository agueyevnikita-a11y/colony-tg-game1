'use client';

import { useRef, useState } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import type { ReferralProgram } from '@/lib/game/referrals';
import '@/app/referrals.css';

type Props = {
  program?: ReferralProgram;
  busy: boolean;
  inviteLink?: string | null;
  betaRequired?: boolean;
  onShare: () => void;
  onClaim: () => Promise<{ count: number; credits: number; crystals: number }>;
  onViewCity: (telegramId: number) => void;
  onAchievements?: () => void;
};

const n = (value: number) => value.toLocaleString('ru-RU');
const PAGE_SIZE = 4;
const STATUS_LABEL = { locked: 'Впереди', available: 'Забрать в достижениях', received: 'Получено', pending: 'Ожидает выдачи' };

export function ReferralsPanel({ program, busy, inviteLink, betaRequired, onShare, onClaim, onViewCity, onAchievements }: Props) {
  const [page, setPage] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');
  const submittingRef = useRef(false);
  if (!program) return <section className="card"><h2><GameIcon name="network" />Сеть колоний</h2><p>Обнови колонию, чтобы увидеть приглашения и награды.</p></section>;

  const pending = program.pendingCount > 0;
  const totalPages = Math.max(1, Math.ceil(program.friends.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleFriends = program.friends.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const nextMilestone = program.roadmap.find((entry) => entry.status !== 'received');
  const ownBonusReady = Boolean(program.invitedBy?.qualified && !program.invitedBy.bonusClaimed);
  const ownBonusAhead = Boolean(program.invitedBy && !program.invitedBy.qualified);
  async function claim() {
    if (!program?.enabled || !pending || busy || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFeedback('');
    setError('');
    try {
      const result = await onClaim();
      setFeedback(result.count ? `Получено: ${n(result.credits)} кредитов и ${n(result.crystals)} кристаллов.` : 'Все доступные награды уже получены.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось получить награду. Попробуй снова.');
    } finally { submittingRef.current = false; setSubmitting(false); }
  }
  async function copy() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyFeedback('Ссылка скопирована');
    } catch { setCopyFeedback('Нажми на поле со ссылкой и скопируй её вручную.'); }
  }

  return <div className="referralsPanel">
    <section className="card referralHero">
      <div className="cardTitleRow"><div><h2><GameIcon name="network" />Развивайтесь вместе</h2><p>Пригласи друга в COLONY. Когда его центр достигнет ур. {program.qualificationHq}, каждый из вас получит награду.</p></div></div>
      <div className="referralPairReward"><span>Каждому за одну новую колонию</span><div><GameAmount resource="credits" size={19}>+{n(program.reward.credits)}</GameAmount><GameAmount resource="crystals" size={19}>+{n(program.reward.crystals)}</GameAmount></div></div>
      <MechanicGuide steps={[
        'Друг впервые открывает COLONY по твоей личной ссылке. Приглашение и просмотр городов бесплатны.',
        `Когда его центр достигнет ур. ${program.qualificationHq}, бонус станет доступен каждому из вас. Каждый забирает свою награду отдельно.`,
        'За одну колонию бонус выдаётся один раз. Повторные входы и уже существующие игроки новых наград не дают.',
      ]} />
      <div className="referralShareActions"><button className="action" onClick={onShare}><GameIcon name="share" size={17} />Пригласить друга</button>{inviteLink && <button className="action secondary" onClick={copy}><GameIcon name="copy" size={17} />Скопировать</button>}</div>
      {inviteLink && <details className="referralLinkDetails"><summary>Моя ссылка</summary><input aria-label="Личная ссылка приглашения" readOnly value={inviteLink} onFocus={(event) => event.target.select()} /></details>}
      {copyFeedback && <p className="finePrint" role="status">{copyFeedback}</p>}
      {betaRequired && <p className="finePrint">Пока идёт закрытая бета, другу также понадобится доступ к тесту. Ссылка сохраняет приглашение, но не заменяет beta-код.</p>}
    </section>

    <section className="card referralBonusCard">
      <div className="referralCounts"><div><b>{n(program.totalInvited)}</b><span>приглашено</span></div><div><b>{n(program.qualifiedInvited)}</b><span>дошли до ур. {program.qualificationHq}</span></div><div><b>{n(program.receivedCount)}</b><span>наград получено</span></div></div>
      <div className="referralClaimSummary"><GameIcon name={pending ? 'gift' : 'check'} size={24} /><div><strong>{pending ? `Готово наград: ${n(program.pendingCount)}` : 'Пока нет готовых бонусов'}</strong><span>{pending ? ownBonusReady ? 'Включая бонус за развитие твоей колонии по приглашению друга.' : 'За развитие приглашённых тобой колоний.' : ownBonusAhead ? `Улучши свой центр до ур. ${program.qualificationHq}, чтобы получить бонус по приглашению друга.` : `Новый бонус появится, когда приглашённый друг достигнет центра ур. ${program.qualificationHq}.`}</span></div></div>
      {pending && <div className="referralClaimReward"><GameAmount resource="credits">+{n(program.pendingReward.credits)}</GameAmount><GameAmount resource="crystals">+{n(program.pendingReward.crystals)}</GameAmount></div>}
      <button className="action" disabled={!program.enabled || !pending || busy || submitting} onClick={claim}>{submitting ? 'Получаем…' : pending ? 'Забрать награды' : 'Пока нет готовых наград'}</button>
      {!program.enabled && <p className="finePrint">Система наград обновляется. Приглашения сохраняются; получение станет доступно после обновления сервера.</p>}
      {feedback && <div className="notice" role="status">{feedback}</div>}{error && <div className="notice error" role="alert">{error}</div>}
      {program.invitedBy && <div className="referralInvitedBy"><GameIcon name="social" size={19} /><div><strong>Тебя пригласил: {program.invitedBy.name}</strong><span>{program.invitedBy.bonusClaimed ? 'Бонус за развитие твоей колонии получен.' : program.invitedBy.qualified ? 'Твой центр достиг нужного уровня — личный бонус доступен выше.' : `Улучши свой центр: ${program.invitedBy.hqLevel} → ${program.qualificationHq}. Тогда бонус получишь и ты, и друг.`}</span></div></div>}
    </section>

    <section className="card referralRoadmapCard">
      <h2><GameIcon name="trophy" />Награды сети</h2><p>Отдельные цели за друзей с центром ур. {program.qualificationHq}: кристаллы и оформление. Они не входят в бонусы выше.</p>
      {nextMilestone && <div className="referralNextReward"><span>{nextMilestone.status === 'available' ? 'Награда уже ждёт в достижениях' : nextMilestone.status === 'pending' ? 'Этап выполнен · ожидает выдачи' : `Следующая цель: ${nextMilestone.target} ${nextMilestone.target === 1 ? 'колония' : nextMilestone.target < 5 ? 'колонии' : 'колоний'} с центром ур. ${program.qualificationHq}`}</span><strong>{nextMilestone.rewardText}</strong>{nextMilestone.status === 'available' && onAchievements && <button className="miniButton" onClick={onAchievements}>Открыть достижения</button>}</div>}
      <details className="referralRoadmap"><summary>Все этапы сети · {program.roadmap.filter((entry) => entry.status === 'received').length}/{program.roadmap.length}</summary><ol>{program.roadmap.map((entry) => <li key={entry.target} className={`is-${entry.status}`}><span className="referralMilestoneNumber">{entry.status === 'received' ? <GameIcon name="check" size={17} /> : entry.target}</span><div><strong>{entry.name} · {entry.target}</strong><span>{entry.rewardText}</span><small>{STATUS_LABEL[entry.status]}</small></div>{entry.status === 'available' && onAchievements && <button className="miniButton" onClick={onAchievements}>Открыть</button>}</li>)}</ol></details>
    </section>

    <section className="card referralFriendsCard"><h2><GameIcon name="social" />Приглашённые колонии</h2>{program.friends.length ? <>
      <div className="referralFriends">{visibleFriends.map((friend) => <div className="referralFriend" key={friend.telegramId}><span className={`referralFriendIcon ${friend.qualifiedAt ? 'isQualified' : ''}`}><GameIcon name={friend.qualifiedAt ? 'check' : 'city'} size={19} /></span><div><strong>{friend.name}</strong><small>{friend.qualifiedAt ? friend.bonusClaimed ? 'Твоя награда получена' : 'Твоя награда готова' : `Центр ур. ${friend.hqLevel} → ${program.qualificationHq}`}</small></div><button className="miniButton" onClick={() => onViewCity(friend.telegramId)}>Город</button></div>)}</div>
      {totalPages > 1 && <nav className="referralPagination" aria-label="Страницы приглашённых"><button className="miniButton" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Назад</button><span>{currentPage + 1}/{totalPages}</span><button className="miniButton" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>Далее</button></nav>}
      {program.totalInvited > program.friends.length && <p className="finePrint">Показаны последние {program.friends.length} приглашений. В счётчиках и наградах учтены все.</p>}
    </> : <p className="referralEmpty">Здесь появятся друзья, которые впервые откроют COLONY по твоей ссылке. Начните строить собственную сеть колоний.</p>}</section>
  </div>;
}
