'use client';

import { useEffect, useId, useRef } from 'react';
import { GameIcon } from '@/components/GameIcon';
import { BUILDINGS, DEFAULT_OFFLINE_CAP_HOURS } from '@/lib/game/config';
import { FOUNDRY_RECIPES, quoteFoundry } from '@/lib/game/foundry';
import '@/app/onboarding.css';

type Props = { open: boolean; onClose: () => void; onNavigate: (action: string) => void };

const STANDARD = FOUNDRY_RECIPES.find((recipe) => recipe.id === 'standard_alloy')!;
const ORE_LINK = quoteFoundry({ level: 1, recipe: STANDARD.id, mode: 'standard', link: 'ore', cycles: 1 });
const ENERGY_LINK = quoteFoundry({ level: 1, recipe: STANDARD.id, mode: 'standard', link: 'energy', cycles: 1 });
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

  return <dialog ref={dialogRef} className="onboardingDialog mechanicsDialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="onboardingDialogBody mechanicsBody">
      <header className="mechanicsHeading"><div><span className="onboardingEyebrow">Справочник колониста</span><h2 id={`${id}-title`}>Как играть в COLONY</h2></div><button ref={closeRef} type="button" className="onboardingClose" aria-label="Закрыть справочник" onClick={onClose}><GameIcon name="close" size={21} /></button></header>
      <p id={`${id}-intro`} className="mechanicsIntro">Строй город, добывай ресурсы, превращай их в детали и вкладывай результат в развитие.</p>
      <section className="mechanicsSection" aria-labelledby={`${id}-resources`}><h3 id={`${id}-resources`}>Что есть у колонии</h3><dl className="mechanicsResources">{RESOURCES.map((resource) => <div key={resource.key}><dt><GameIcon name={resource.key} size={21} /><strong>{resource.name}</strong></dt><dd>{resource.description}</dd></div>)}</dl></section>
      <section className="mechanicsSection" aria-labelledby={`${id}-build`}><h3 id={`${id}-build`}><GameIcon name="city" size={21} />Город и строительство</h3><p>Выбери здание в разделе строительства, затем свободную клетку на карте. Нажми на готовое здание, чтобы увидеть выработку, улучшить или переместить его.</p><p>Литейный цех рядом с действующей шахтой экономит {Math.round((1 - ORE_LINK.ore / STANDARD.ore) * 100)}% руды. Рядом с электростанцией — {Math.round((1 - ENERGY_LINK.energy / STANDARD.energy) * 100)}% энергии. Выбирается одна связь; учитываются соседи по стороне клетки.</p><button type="button" className="action secondary" onClick={() => navigate('build')}>Показать здания<GameIcon name="arrow" size={17} /></button></section>
      <section className="mechanicsSection" aria-labelledby={`${id}-production`}><h3 id={`${id}-production`}><GameIcon name="parts" size={21} />От ресурсов к деталям</h3><p>В панели производства выбери цех, рецепт, режим и количество циклов. Ресурсы списываются сразу, циклы выполняются по очереди. У каждого цеха своя очередь.</p><div className="mechanicsRecipe" aria-label="Базовый рецепт стандартного сплава"><span><GameIcon name="ore" size={18} />{STANDARD.ore}</span><span>+</span><span><GameIcon name="energy" size={18} />{STANDARD.energy}</span><GameIcon name="arrow" size={18} /><span><GameIcon name="parts" size={18} />{STANDARD.parts}</span><small>{Math.ceil(STANDARD.seconds / 60)} мин.</small></div><p className="mechanicsCaption">Первый уровень цеха, обычный режим, без бонусов. Улучшения, технологии и связи меняют расчёт в панели.</p><p>Если склад полон, готовые детали остаются в цехе. Освободи место — при обновлении результат поступит на склад.</p><button type="button" className="action secondary" onClick={() => navigate('production')}>Показать производство<GameIcon name="arrow" size={17} /></button></section>
      <section className="mechanicsSection" aria-labelledby={`${id}-research`}><h3 id={`${id}-research`}><GameIcon name="research" size={21} />Исследования</h3><p>Исследовательский центр открывается на HQ{BUILDINGS.research_lab.unlockHq}. Он производит науку, которую можно вложить в добычу, новые здания и рецепты плавки. У каждой технологии указаны эффект, цена и требования.</p><p>Одновременно идёт одно исследование. После его завершения постоянный бонус применяется автоматически.</p><button type="button" className="action secondary" onClick={() => navigate('research')}>Показать исследования<GameIcon name="arrow" size={17} /></button></section>
      <section className="mechanicsSection" aria-labelledby={`${id}-market`}><h3 id={`${id}-market`}><GameIcon name="market" size={21} />Контракты и рынок</h3><p>Торговый узел открывает NPC-контракты и рынок игроков. Контракт сразу обменивает нужный ресурс на кредиты. Ордер на рынке ждёт покупателя; до сделки ресурс зарезервирован и занимает место на складе.</p><button type="button" className="action secondary" onClick={() => navigate('market')}>Показать торговлю<GameIcon name="arrow" size={17} /></button></section>
      <section className="mechanicsSection" aria-labelledby={`${id}-events`}><h3 id={`${id}-events`}><GameIcon name="info" size={21} />События колонии</h3><p>После начального обучения в городе появляются небольшие происшествия. Выбирай решение по нуждам колонии: вложить ресурсы ради большего результата или поручить задачу автоматике без затрат. Стоимость и награда видны заранее.</p><p>Событие не исчезает, пока ты не примешь решение. Производство продолжает работать; за отсутствие нет штрафа. Следующее событие может появиться через 12 часов после решения.</p><button type="button" className="action secondary" onClick={() => navigate('events')}>Показать события<GameIcon name="arrow" size={17} /></button></section>
      <section className="mechanicsSection mechanicsOffline" aria-labelledby={`${id}-offline`}><h3 id={`${id}-offline`}><GameIcon name="clock" size={21} />Когда игра закрыта</h3><p>Готовые здания продолжают добычу до {DEFAULT_OFFLINE_CAP_HOURS} часов за одно отсутствие. Исследования и Premium могут увеличить лимит; заполненный склад останавливает поступление своего ресурса.</p><p>Плавка, строительство и исследования продолжаются по своим таймерам. Вернись в колонию или нажми «Обновить», чтобы увидеть результат.</p></section>
      <button className="action mechanicsDone" type="button" onClick={onClose}>Понятно, к колонии<GameIcon name="check" size={18} /></button>
    </div>
  </dialog>;
}
