'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GameIcon } from '@/components/GameIcon';
import { BUILDINGS } from '@/lib/game/config';
import { TUTORIAL_STEPS } from '@/lib/game/tutorial';
import '@/app/onboarding.css';

type Props = {
  tutorial: any;
  buildings: any[];
  busy: boolean;
  onAction: (action: string) => void;
  onClaim: () => Promise<void>;
  onRefresh: () => void;
  onHelp?: () => void;
};

const FALLBACKS: Record<string, { action: string; label: string; why: string; hint: string; building?: string }> = {
  welcome: { action: 'city', label: 'Показать город', why: 'Стартовый резерв поможет запустить первое производство.', hint: 'Забери резерв, затем выберем место для литейного цеха.' },
  build_foundry: { action: 'build_foundry', label: 'Показать литейный цех', why: 'Детали нужны для улучшения базы. Цех превращает в них руду и энергию.', hint: 'Выбери свободную клетку. Соседство с шахтой или электростанцией поможет экономить ресурсы.', building: 'foundry' },
  first_smelt: { action: 'production', label: 'Показать производство', why: 'Первая партия деталей откроет путь к улучшениям и новым зданиям.', hint: 'В панели производства выбери цех и запусти один цикл плавки.', building: 'foundry' },
  build_trade_hub: { action: 'build_trade_hub', label: 'Показать торговый узел', why: 'Торговля превращает лишние ресурсы в кредиты для развития.', hint: 'Выбери место для торгового узла на карте.', building: 'trade_hub' },
  first_contract: { action: 'contracts', label: 'Показать контракты', why: 'Контракты дают колонии первые доходы от продажи ресурсов.', hint: 'Выбери доступный NPC-контракт и обменяй указанные ресурсы на кредиты.', building: 'trade_hub' },
  hq2: { action: 'upgrade_hq', label: 'Показать улучшение HQ', why: 'Следующий уровень управления открывает исследовательский центр и технологии.', hint: 'Открой Центр управления на карте и начни улучшение.', building: 'hq' },
};

function text(value: unknown, fallback: string) { return typeof value === 'string' && value.trim() ? value : fallback; }
function remainingTime(endsAt: unknown, now: number) {
  const end = new Date(String(endsAt ?? '')).getTime();
  if (!Number.isFinite(end)) return 'Проверь готовность, чтобы обновить город.';
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  if (!seconds) return 'Время вышло. Проверь готовность здания.';
  const roundedMinutes = Math.ceil(seconds / 60);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return hours ? `Осталось ${hours} ч.${minutes ? ` ${minutes} мин.` : ''}` : seconds >= 60 ? `Осталось ${Math.ceil(seconds / 60)} мин.` : `Осталось ${seconds} сек.`;
}

export function ColonyGuide({ tutorial, buildings, busy, onAction, onClaim, onRefresh, onHelp }: Props) {
  const id = useId();
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const submitGuard = useRef(false);
  const rawTotal = Number(tutorial?.total);
  const total = Number.isFinite(rawTotal) && rawTotal >= 1 ? Math.floor(rawTotal) : TUTORIAL_STEPS.length;
  const rawStep = Number(tutorial?.step);
  const step = Number.isFinite(rawStep) ? Math.max(0, Math.min(total, Math.floor(rawStep))) : 0;
  const completed = !!tutorial?.completed || step >= total;
  const current = tutorial?.current ?? TUTORIAL_STEPS[step] ?? null;
  const fallback = FALLBACKS[current?.key] ?? { action: 'city', label: 'Показать следующий шаг', why: 'Развивай производство и открывай новые возможности колонии.', hint: 'Следуй подсказке и возвращайся за наградой.' };
  const activeBuilding = fallback.building && buildings.some((building) => building.type === fallback.building && building.status === 'active' && Number(building.level) >= (fallback.building === 'hq' ? 2 : 1));
  const pending = !completed && !activeBuilding && fallback.building ? buildings.find((building) => building.type === fallback.building && ['building', 'upgrading'].includes(building.status)) : null;
  const canClaim = !completed && !!tutorial?.current?.conditionMet;
  const locked = busy || submitting;

  useEffect(() => {
    if (!pending) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending?.id, pending?.completes_at]);

  useEffect(() => { setFeedback((previous) => previous?.error ? null : previous); }, [step]);

  async function claim() {
    if (locked || submitGuard.current || !canClaim) return;
    submitGuard.current = true;
    setSubmitting(true);
    setFeedback(null);
    try {
      await onClaim();
      setFeedback({ text: 'Награда получена. Можно двигаться дальше.', error: false });
    } catch (cause) {
      setFeedback({ text: cause instanceof Error ? cause.message : 'Не удалось получить награду. Попробуй ещё раз.', error: true });
    } finally {
      submitGuard.current = false;
      setSubmitting(false);
    }
  }

  if (!tutorial) return null;

  const hqLevel = Number(buildings.find((building) => building.type === 'hq')?.level ?? 1);
  const lab = buildings.find((building) => building.type === 'research_lab');
  const nextAction = hqLevel < BUILDINGS.research_lab.unlockHq ? 'upgrade_hq' : lab ? 'research' : 'build_lab';
  const nextTitle = hqLevel < BUILDINGS.research_lab.unlockHq ? 'Открой научное развитие' : lab ? 'Развивай технологии' : 'Построй исследовательский центр';
  const nextWhy = lab ? 'Исследования усиливают добычу и открывают новые здания и рецепты плавки.' : 'Наука поможет получать больше ресурсов с каждой клетки и развивать производство.';
  const rewards = Object.entries(current?.reward ?? {}).filter(([resource, amount]) => resource !== 'cosmeticId' && typeof amount === 'number' && amount > 0);
  const labels: Record<string, string> = { ore: 'руды', energy: 'энергии', parts: 'деталей', credits: 'кредитов', crystals: 'кристаллов', science: 'науки' };

  return <section className={`card colonyGuide${completed ? ' colonyGuideComplete' : ''}`} aria-labelledby={`${id}-title`} aria-busy={submitting}>
    <div className="colonyGuideTop"><span className="onboardingEyebrow">{completed ? 'Следующая цель' : 'Первые шаги'}</span><div>{!completed && <span className="colonyGuideCount" aria-label={`Шаг ${step + 1} из ${total}`}>{step + 1} / {total}</span>}{onHelp && <button className="colonyGuideHelp" type="button" onClick={onHelp} aria-label="Как играть в COLONY"><GameIcon name="help" size={20} /></button>}</div></div>
    <h2 id={`${id}-title`}>{completed ? nextTitle : text(current?.title, 'Развивай колонию')}</h2>
    <p className="colonyGuideWhy">{completed ? nextWhy : text(current?.why, fallback.why)}</p>
    {!completed && !canClaim && <p className="colonyGuideHint">{text(current?.hint, FALLBACKS[current?.key]?.hint ?? text(current?.description, fallback.hint))}</p>}
    {pending && !canClaim && <div className="colonyGuidePending"><GameIcon name="clock" size={19} /><div><strong>{pending.status === 'upgrading' ? 'Улучшение идёт…' : 'Строительство идёт…'}</strong><span role="timer" aria-live="off">{remainingTime(pending.completes_at, now)}</span></div><button className="miniButton" type="button" disabled={locked} onClick={onRefresh}>Проверить</button></div>}
    {!completed && <div className="colonyGuideRewards"><span>{canClaim ? 'Готово. Твоя награда:' : 'Награда за шаг:'}</span><div>{rewards.map(([resource, amount]) => <span key={resource} title={labels[resource] ?? resource} aria-label={`${amount} ${labels[resource] ?? resource}`}><GameIcon name={resource} size={15} />{Number(amount).toLocaleString('ru-RU')}</span>)}{current?.reward?.cosmeticId && <span><GameIcon name="star" size={15} />Предмет оформления</span>}</div></div>}
    <div className="colonyGuideActions">
      {completed ? <button className="action secondary" type="button" disabled={locked} onClick={() => onAction(nextAction)}>{nextAction === 'build_lab' ? 'Показать исследовательский центр' : nextAction === 'research' ? 'Показать исследования' : 'Показать Центр управления'}<GameIcon name="arrow" size={17} /></button>
        : canClaim ? <button className="action colonyGuideClaim" type="button" disabled={locked} onClick={() => void claim()}>{submitting ? 'Получаем награду…' : step === 0 ? 'Начать развитие' : 'Забрать награду и продолжить'}<GameIcon name={step === 0 ? 'arrow' : 'check'} size={18} /></button>
          : <button className="action secondary" type="button" disabled={locked} onClick={() => onAction(pending ? 'city' : text(current?.action, fallback.action))}>{pending ? 'Показать на карте' : text(current?.actionLabel, fallback.label)}<GameIcon name="arrow" size={17} /></button>}
    </div>
    {feedback && <div className={`notice onboardingFeedback${feedback.error ? ' error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</div>}
  </section>;
}
