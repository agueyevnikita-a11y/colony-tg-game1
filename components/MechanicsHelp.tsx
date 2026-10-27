'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { BUILDINGS, DEFAULT_OFFLINE_CAP_HOURS } from '@/lib/game/config';
import { FOUNDRY_RECIPES, quoteFoundry } from '@/lib/game/foundry';
import { COMFORT_MAX, COMFORT_MILESTONES } from '@/lib/game/comfort';
import { REFERRAL_BONUS, REFERRAL_QUALIFICATION_HQ } from '@/lib/game/referrals';
import { ALLIANCE_CREATE_COST, ALLIANCE_CREATE_CURRENCY, ALLIANCE_CREATE_HQ, ALLIANCE_JOIN_HQ } from '@/lib/game/alliance';
import { SUPPLY_PROJECT_REQUIRED_HQ } from '@/lib/game/supply-projects';
import '@/app/onboarding.css';

type Props = { open: boolean; onClose: () => void; onNavigate: (action: string) => void };

const STANDARD = FOUNDRY_RECIPES.find((recipe) => recipe.id === 'standard_alloy')!;
const ORE_LINK = quoteFoundry({ level: 1, recipe: STANDARD.id, mode: 'standard', link: 'ore', cycles: 1 });
const ENERGY_LINK = quoteFoundry({ level: 1, recipe: STANDARD.id, mode: 'standard', link: 'energy', cycles: 1 });
const TOPICS = [
  { key: 'resources', title: 'Ресурсы', icon: 'ore' },
  { key: 'city', title: 'Город', icon: 'city' },
  { key: 'production', title: 'Производство', icon: 'foundry' },
  { key: 'supplies', title: 'Поставки', icon: 'contracts' },
  { key: 'research', title: 'Исследования', icon: 'research' },
  { key: 'expeditions', title: 'Экспедиции', icon: 'rocket' },
  { key: 'trade', title: 'Торговля', icon: 'market' },
  { key: 'comfort', title: 'Комфорт', icon: 'comfort' },
  { key: 'friends', title: 'Друзья', icon: 'network' },
  { key: 'alliance', title: 'Альянс', icon: 'shield' },
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
  { key: 'crystals', name: 'Кристаллы', description: 'Награда за задания, достижения и другие игровые цели. Нужны для создания своего альянса и предложений магазина за кристаллы.' },
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
          <p>Для выбранного проекта снабжения цех учитывает детали на складе и во всех оплаченных очередях. Подстановка нужных циклов меняет только план: оплачивать запуск и доставлять детали нужно отдельными действиями.</p>
          {action('К производству', 'production')}
        </>}
        {topic === 'supplies' && <>
          <p>Долгосрочные проекты находятся в «Город → Поставки → Проекты». Для доставки нужен центр колонии уровня {SUPPLY_PROJECT_REQUIRED_HQ} и работающий логистический центр.</p>
          <p>Выбери цель и доставляй руду, энергию и детали частями. Цена и награды всех трёх этапов видны заранее. Нет срока выполнения и штрафа за отсутствие; переключение целей сохраняет поставки каждого проекта.</p>
          <p>Когда этап заполнен, отдельно забери награду. Даже во время улучшения логистики готовая награда остаётся доступна. Каждый проект конечный: повторно проходить его ради призов нельзя.</p>
          <p>Это поставки оборудования: они не размещают здания на карте автоматически. Кредиты и наука помогают развивать твой город; за завершение есть кристаллы и постоянный титул.</p>
          {action('Выбрать проект', 'supplies')}
        </>}
        {topic === 'research' && <>
          <p>Улучши центр колонии до уровня {BUILDINGS.research_lab.unlockHq} и построй исследовательский центр. Он производит науку для технологий.</p>
          <p>Выбери цель в плане развития: игра покажет нужные технологии и ближайшее действие. Четыре направления помогают выбирать: ресурсы, производство, экспедиции и город со связями.</p>
          <p>Одновременно идёт одно исследование. Его постоянный бонус или новое открытие применяется после завершения.</p>
          <p>Технология «Экспедиционные протоколы» открывает центр экспедиций и отправку аппаратов.</p>
          <div className="mechanicsTopicActions">{action('Выбрать цель', 'research')}{action('Как открыть экспедиции', 'research:expedition_protocols')}</div>
        </>}
        {topic === 'expeditions' && <>
          <p>Изучи «Экспедиционные протоколы» и построй центр экспедиций. Стоимость вылета списывается при запуске. Аппарат летит и при закрытой игре; после возвращения забери груз отдельной кнопкой.</p>
          <p>Локальная разведка удобна для частых заходов. Более длинные маршруты приносят больше за один запуск и открывают редкие находки. Звёздная карта встречается в «Орбитальных руинах» и «Дальнем сигнале», квантовая линза — только в «Дальнем сигнале».</p>
          <p>Происшествие предлагает дополнительную награду сверх основного груза. У каждого есть вариант без затрат; провала или потери груза за долгое отсутствие нет. Если не хватает ресурсов на решение или места на складе, результат подождёт.</p>
          <p>Четыре разных артефакта открывают постоянную рамку в достижениях. Повторы остаются в коллекции и не дают производственных бонусов. Готовые вылеты занимают слот, пока груз не получен.</p>
          <div className="mechanicsTopicActions">{action('К экспедициям', 'expeditions')}{action('Посмотреть коллекцию', 'artifacts')}{action('К достижениям', 'achievements')}</div>
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
        {topic === 'alliance' && <>
          <p>Вступление в существующий альянс бесплатно с уровня {ALLIANCE_JOIN_HQ} центра колонии. Создание собственного доступно с уровня {ALLIANCE_CREATE_HQ} и стоит <GameAmount resource={ALLIANCE_CREATE_CURRENCY}>{ALLIANCE_CREATE_COST}</GameAmount> кристаллов. Это разовая плата, она не возвращается при выходе.</p>
          <p>Кристаллы можно заработать ежедневными и недельными заданиями, достижениями и проектами снабжения. Покупать их для участия в альянсах не обязательно.</p>
          <p>Вместе выполняйте общие цели, стройте ретранслятор и участвуйте в совместной добыче. Награда зависит от правил конкретной цели и твоего вклада: одно вступление не выдаёт призы автоматически.</p>
          <p>После выхода или исключения действует пауза перед следующим вступлением. Уже заработанные призы и оплаченные доли добычи сохраняются; внесённые в проект ресурсы не возвращаются.</p>
          <div className="mechanicsTopicActions">{action('Найти альянс', 'alliance')}{action('Заработать кристаллы', 'daily')}</div>
        </>}
        {topic === 'events' && <>
          <p>После первых шагов обучения и центра ур. 2 в колонии появляются ситуации с выбором. Сравни нужный тебе ресурс, затраты и условия решения. Автоматика предлагает вариант без затрат.</p>
          <p>Событие ждёт решения, производство продолжает работать. Штрафа за отсутствие нет. Следующее событие появится не раньше чем через 12 часов после решения, если есть подходящее действующее здание. Пропущенные события не накапливаются.</p>
          <p>Награда разовая. Она помогает развивать колонию, но решение само по себе не даёт SP и не засчитывается как строительство, исследование или цикл цеха. Наука из события поступает в твой личный запас.</p>
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
