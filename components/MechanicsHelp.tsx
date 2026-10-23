'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GameIcon } from '@/components/GameIcon';
import { BUILDINGS, DEFAULT_OFFLINE_CAP_HOURS } from '@/lib/game/config';
import { FOUNDRY_RECIPES, quoteFoundry } from '@/lib/game/foundry';
import { COMFORT_MAX, COMFORT_MILESTONES } from '@/lib/game/comfort';
import { REFERRAL_BONUS, REFERRAL_QUALIFICATION_HQ } from '@/lib/game/referrals';
import '@/app/onboarding.css';

type Props = { open: boolean; onClose: () => void; onNavigate: (action: string) => void };

const STANDARD = FOUNDRY_RECIPES.find((recipe) => recipe.id === 'standard_alloy')!;
const ORE_LINK = quoteFoundry({ level: 1, recipe: STANDARD.id, mode: 'standard', link: 'ore', cycles: 1 });
const ENERGY_LINK = quoteFoundry({ level: 1, recipe: STANDARD.id, mode: 'standard', link: 'energy', cycles: 1 });
const TOPICS = [
  { key: 'resources', title: 'Ресурсы', icon: 'ore' },
  { key: 'city', title: 'Город', icon: 'city' },
  { key: 'production', title: 'Производство', icon: 'foundry' },
  { key: 'research', title: 'Исследования', icon: 'research' },
  { key: 'trade', title: 'Торговля', icon: 'market' },
  { key: 'comfort', title: 'Комфорт', icon: 'comfort' },
  { key: 'friends', title: 'Друзья', icon: 'network' },
  { key: 'events', title: 'События', icon: 'events' },
  { key: 'offline', title: 'Офлайн', icon: 'clock' },
] as const;
type Topic = typeof TOPICS[number]['key'];
const RESOURCES = [
  { key: 'ore', name: 'Руда', description: 'Производится шахтами. Нужна для строительства и плавки.' },
  { key: 'energy', name: 'Энергия', description: 'Производится электростанциями. Питает плавку и экспедиции.' },
  { key: 'parts', name: 'Детали', description: 'Производятся в литейном цехе из руды и энергии. Нужны для улучшений, науки и новых зданий.' },
  { key: 'credits', name: 'Кредиты', description: 'Поступают от жилых модулей, контрактов и торговли. Оплачивают развитие колонии.' },
  { key: 'science', name: 'Наука', description: 'Производится исследовательским центром и приходит из экспедиций. Открывает технологии.' },
  { key: 'crystals', name: 'Кристаллы', description: 'Награда за задания и достижения. Тратятся на доступные предложения магазина.' },
];

export function MechanicsHelp({ open, onClose, onNavigate }: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [topic, setTopic] = useState<Topic>('resources');
  const selectedTopic = TOPICS.find((item) => item.key === topic)!;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      previousFocus.current = document.activeElement;
      dialog.showModal();
      closeRef.current?.focus({ preventScroll: true });
    } else if (!open && dialog.open) {
      dialog.close();
      if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [topic, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      dialog?.close();
      if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, []);

  function navigate(action: string) {
    onClose();
    onNavigate(action);
  }

  function action(label: string, destination: string) {
    return <button type="button" className="action secondary" onClick={() => navigate(destination)}>{label}<GameIcon name="arrow" size={17} /></button>;
  }

  return <dialog ref={dialogRef} className="onboardingDialog mechanicsDialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]')]
        .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled')
          && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0
          && getComputedStyle(element).visibility === 'visible')
        .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
      const first = focusable[0] ?? closeRef.current;
      const last = focusable.at(-1) ?? closeRef.current;
      const active = document.activeElement;
      if (!dialog.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="onboardingDialogBody mechanicsBody">
      <header className="mechanicsHeading"><div><span className="onboardingEyebrow">Справочник колониста</span><h2 id={`${id}-title`}>Как играть в COLONY</h2></div><button ref={closeRef} type="button" className="onboardingClose" aria-label="Закрыть справочник" onClick={onClose}><GameIcon name="close" size={21} /></button></header>
      <p id={`${id}-intro`} className="mechanicsIntro">Построй самостоятельную колонию: наладь добычу, выпускай детали и выбирай, что развивать дальше.</p>
      <div className="mechanicsTopics" role="group" aria-label="Темы справочника">
        {TOPICS.map((item) => <button type="button" key={item.key} className={`mechanicsTopicButton ${topic === item.key ? 'isActive' : ''}`} aria-pressed={topic === item.key} aria-controls={`${id}-topic`} onClick={() => setTopic(item.key)}><span className="mechanicsTopicIcon"><GameIcon name={item.icon} size={18} /></span><span>{item.title}</span></button>)}
      </div>
      <section ref={panelRef} id={`${id}-topic`} className="mechanicsSection mechanicsTopicPanel" aria-labelledby={`${id}-topic-title`} tabIndex={0}>
        <h3 id={`${id}-topic-title`}><GameIcon name={selectedTopic.icon} size={21} />{selectedTopic.title}</h3>
        {topic === 'resources' && <>
          <dl className="mechanicsResources">{RESOURCES.map((resource) => <div key={resource.key}><dt><GameIcon name={resource.key} size={21} /><strong>{resource.name}</strong></dt><dd>{resource.description}</dd></div>)}</dl>
          <p className="mechanicsCaption mechanicsAfterResources">Посмотри на запасы перед стройкой. Если чего-то не хватает, игра покажет недостающее рядом с действием.</p>
          {action('К зданиям', 'build')}
        </>}
        {topic === 'city' && <>
          <p>Выбери здание в разделе строительства, затем свободную клетку на карте. Для цеха сначала сравни связи и подтверди место отдельной кнопкой. Нажми на готовое здание, чтобы увидеть выработку, улучшить или переместить его.</p>
          <p>Литейный цех рядом с работающей шахтой экономит {Math.round((1 - ORE_LINK.ore / STANDARD.ore) * 100)}% руды, рядом с электростанцией — {Math.round((1 - ENERGY_LINK.energy / STANDARD.energy) * 100)}% энергии. Учитываются соседи по стороне клетки; действует одна связь.</p>
          {action('Выбрать здание', 'build')}
        </>}
        {topic === 'production' && <>
          <p>Построй литейный цех. В производстве выбери рецепт, режим и число циклов. Руда и энергия списываются сразу; у каждого цеха своя очередь.</p>
          <div className="mechanicsRecipe" aria-label="Базовый рецепт стандартного сплава"><span><GameIcon name="ore" size={18} />{STANDARD.ore}</span><span>+</span><span><GameIcon name="energy" size={18} />{STANDARD.energy}</span><GameIcon name="arrow" size={18} /><span><GameIcon name="parts" size={18} />{STANDARD.parts}</span><small>{Math.ceil(STANDARD.seconds / 60)} мин.</small></div>
          <p className="mechanicsCaption">Первый уровень цеха, обычный режим, без бонусов. Точный расчёт виден перед запуском.</p>
          <p>При полном складе готовые детали остаются в цехе. Освободи место и обнови колонию, чтобы получить их.</p>
          {action('К производству', 'production')}
        </>}
        {topic === 'research' && <>
          <p>Улучши центр колонии до уровня {BUILDINGS.research_lab.unlockHq} и построй исследовательский центр. Он производит науку для технологий.</p>
          <p>Выбери цель в плане развития: игра покажет нужные технологии и ближайшее действие. Четыре направления помогают выбирать: ресурсы, производство, экспедиции и город со связями.</p>
          <p>Одновременно идёт одно исследование. Его постоянный бонус или новое открытие применяется после завершения.</p>
          <p>Технология «Экспедиционные протоколы» открывает центр экспедиций и отправку аппаратов.</p>
          <div className="mechanicsTopicActions">{action('Выбрать цель', 'research')}{action('Как открыть экспедиции', 'research:expedition_protocols')}</div>
        </>}
        {topic === 'trade' && <>
          <p>Работающий торговый узел открывает контракты: отдай указанный ресурс и сразу получи кредиты.</p>
          <p>Для рынка игроков дополнительно нужна технология «Межколониальная торговля». Выставленный ресурс ждёт покупателя и занимает место на складе до продажи. Свои предложения можно отменить.</p>
          <div className="mechanicsTopicActions">{action('К контрактам', 'contracts')}{action('На рынок', 'market')}{action('Технология торговли', 'research:trade_network')}</div>
        </>}
        {topic === 'comfort' && <>
          <p>Комфорт — отдельный показатель города от 0 до {COMFORT_MAX}. Его повышает декор на карте; на добычу и плавку он не влияет.</p>
          <p>Первый предмет каждого вида даёт полный комфорт, второй — половину с округлением вниз. Следующие копии украшают город без дополнительных очков. Перемещать декор можно бесплатно.</p>
          <ul className="mechanicsMilestones" aria-label="Награды за комфорт">{COMFORT_MILESTONES.map((milestone) => <li key={milestone.target}><strong>{milestone.target}</strong><span>{milestone.reward}</span></li>)}</ul>
          <p>Достигни порога и забери награду в достижениях. Для награды сохраняется лучший результат города. Технология «Замкнутые биосистемы» открывает гидропонный модуль, а «Среда обитания» — водный рециркулятор и коммуникационный узел.</p>
          {action('Выбрать декор', 'decor')}
        </>}
        {topic === 'friends' && <>
          <p>Отправь другу личную ссылку из раздела «Друзья». Он должен впервые зайти в игру по ней и улучшить центр колонии до уровня {REFERRAL_QUALIFICATION_HQ}.</p>
          <p>После этого каждый из вас может вручную забрать {REFERRAL_BONUS.credits} кредитов и {REFERRAL_BONUS.crystals} кристаллов в разделе «Друзья». Прогресс приглашений и следующие награды видны там же.</p>
          <p>Допуск в закрытую бету сам по себе не засчитывает приглашение и не отменяет условие: нужен настоящий уровень {REFERRAL_QUALIFICATION_HQ} центра.</p>
          {action('К друзьям и наградам', 'friends')}
        </>}
        {topic === 'events' && <>
          <p>После начального обучения в городе появляются небольшие происшествия. Вложи ресурсы ради большей награды или выбери помощь автоматики без затрат. Цена и результат видны заранее.</p>
          <p>Событие ждёт решения, производство продолжает работать. Штрафа за отсутствие нет. Следующее событие может появиться через 12 часов после решения.</p>
          {action('К событиям колонии', 'events')}
        </>}
        {topic === 'offline' && <>
          <p>Готовые здания добывают ресурсы до {DEFAULT_OFFLINE_CAP_HOURS} часов за одно отсутствие. Исследования и Premium могут увеличить лимит. Заполненный склад останавливает поступление своего ресурса.</p>
          <p>Плавка, строительство и исследования продолжаются по своим таймерам. Вернись в колонию или нажми «Обновить», чтобы увидеть результат.</p>
        </>}
      </section>
      <button className="action mechanicsDone" type="button" onClick={onClose}>К колонии<GameIcon name="check" size={18} /></button>
    </div>
  </dialog>;
}
