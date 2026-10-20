'use client';

import { useState } from 'react';
import { DecorArt } from '@/components/DecorArt';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { COMFORT_MAX, COMFORT_MILESTONES, calculateComfort, comfortPlacementGain } from '@/lib/game/comfort';
import { decorRequirements, type DecorCatalogItem } from '@/lib/game/decor';
import { RESEARCH_TREE } from '@/lib/game/research';
import '@/app/decor.css';

type Props = {
  catalog: DecorCatalogItem[];
  decor: { id: string; type: string; x: number; y: number }[];
  hqLevel: number;
  completedResearch: string[];
  resources: { credits?: number };
  busy: boolean;
  highestComfort?: number;
  onPlace: (type: string, name: string) => void;
  onResearch: (key: string) => void;
  onUpgradeHq: () => void;
  onAchievements?: () => void;
};

const number = (value: number) => value.toLocaleString('ru-RU');

export function DecorPanel(props: Props) {
  const [view, setView] = useState<'available' | 'locked'>('available');
  const comfort = calculateComfort(props.decor);
  const best = Math.max(comfort.score, Number.isFinite(props.highestComfort) ? Number(props.highestComfort) : 0);
  const available = props.catalog.filter(item => decorRequirements(item, props.hqLevel, props.completedResearch).unlocked);
  const locked = props.catalog.filter(item => !decorRequirements(item, props.hqLevel, props.completedResearch).unlocked);
  const items = view === 'available' ? available : locked;

  return <section className="card decorPanel" aria-labelledby="decor-panel-title">
    <div className="decorPanelHeading"><div><h2 id="decor-panel-title"><GameIcon name="tree" />Благоустройство</h2><p>Сделай промышленную базу городом для жителей.</p></div><span className="decorComfortValue" aria-label={`Комфорт: ${comfort.score} из ${COMFORT_MAX}`}><GameIcon name="comfort" size={17} /><strong>{comfort.score}</strong><small>/{COMFORT_MAX}</small></span></div>
    <div className="decorComfortTrack" role="progressbar" aria-label="Комфорт колонии" aria-valuemin={0} aria-valuemax={COMFORT_MAX} aria-valuenow={comfort.score}><i style={{ width: `${comfort.score}%` }} /></div>
    <div className="decorComfortSummary"><span>Комфорт колонии</span><span>{comfort.unique} видов · {comfort.total} объектов</span></div>
    <p className="decorPurpose">Разные объекты повышают комфорт и открывают разовые награды в достижениях. Производство и рейтинг города остаются прежними.</p>
    <div className="decorMilestones" aria-label="Награды за комфорт">{COMFORT_MILESTONES.map(milestone => <div className={best >= milestone.target ? 'isReached' : ''} key={milestone.target}><strong><GameIcon name={best >= milestone.target ? 'check' : 'comfort'} size={13} />{milestone.target} очков</strong><span>{milestone.target === 25 ? <GameAmount resource="crystals">10</GameAmount> : milestone.target === 80 ? <GameAmount resource="crystals">25</GameAmount> : 'Рамка «Живая колония»'}</span></div>)}</div>
    {props.onAchievements && <button type="button" className="miniButton decorRewardsLink" disabled={props.busy} onClick={props.onAchievements}>Забрать награды в достижениях<GameIcon name="arrow" size={13} /></button>}
    <details className="decorInstructions"><summary><GameIcon name="help" size={15} />Как пользоваться декором</summary><ol><li>Выбери объект и нажми «Разместить».</li><li>На карте нажми свободную клетку. Кредиты спишутся только после размещения; отмена бесплатна.</li><li>Нажми на готовый декор, чтобы бесплатно перенести его. При демонтаже вернётся 50% цены.</li></ol><p>Первый объект каждого вида даёт полный бонус к комфорту, второй — половину. Следующие копии украшают город без дополнительных очков. Положение объектов на комфорт не влияет, дорогами не обязательно соединять здания.</p><p>Комфорт не уменьшается из-за отсутствия в игре. Уже открытые достижения сохраняются после перестройки. Платные темы и монументы из магазина на комфорт не влияют.</p></details>
    <div className="decorFilters" aria-label="Доступность декора"><button type="button" className={view === 'available' ? 'isActive' : ''} aria-pressed={view === 'available'} onClick={() => setView('available')}>Можно разместить <span>{available.length}</span></button><button type="button" className={view === 'locked' ? 'isActive' : ''} aria-pressed={view === 'locked'} onClick={() => setView('locked')}>Предстоит открыть <span>{locked.length}</span></button></div>
    <div className="decorItems">{items.map(item => {
      const requirements = decorRequirements(item, props.hqLevel, props.completedResearch);
      const credits = Number(props.resources.credits ?? 0);
      const affordable = Number.isFinite(credits) && credits >= item.credits;
      const gain = comfortPlacementGain(props.decor, item.type);
      const count = comfort.counts[item.type] ?? 0;
      const researchName = item.researchRequirementName ?? RESEARCH_TREE.find(research => research.key === item.unlockResearch)?.name ?? 'нужную технологию';
      return <article className={`decorItem ${requirements.unlocked ? '' : 'isLocked'}`} key={item.type}>
        <div className="decorItemArt"><DecorArt type={item.type} /></div><h3>{item.name}</h3>
        <span className={`decorItemGain ${gain === 0 ? 'isNeutral' : ''}`}>{gain > 0 ? `+${gain} к комфорту` : comfort.score === COMFORT_MAX ? 'Комфорт уже максимален' : 'Только для оформления'}</span>
        <span className="decorItemOwned">В городе: {number(count)}</span>
        <p>{item.description}</p>
        <div className="decorItemCost"><GameAmount resource="credits">{number(item.credits)}</GameAmount><span>за объект</span></div>
        {requirements.unlocked ? <>
          <button type="button" className="action secondary" disabled={props.busy || !affordable} onClick={() => props.onPlace(item.type, item.name)}><GameIcon name="build" size={14} />Разместить</button>
          {!affordable && <small className="decorItemShortage">Не хватает {number(Math.ceil(item.credits - (Number.isFinite(credits) ? credits : 0)))} кредитов</small>}
        </> : <div className="decorItemGate">
          {!requirements.hqMet && <span>Нужна база ур. {item.unlockHq}</span>}
          {!requirements.researchMet && <span>Технология «{researchName}»</span>}
          <button type="button" className="miniButton" disabled={props.busy} onClick={!requirements.hqMet ? props.onUpgradeHq : () => item.unlockResearch && props.onResearch(item.unlockResearch)}>{!requirements.hqMet ? 'Улучшить базу' : 'К исследованию'}<GameIcon name="arrow" size={12} /></button>
        </div>}
      </article>;
    })}</div>
    {items.length === 0 && <p className="decorEmpty">{view === 'locked' ? 'Все виды декора открыты. Комбинируй объекты и выбирай свой облик города.' : 'Сначала выполни условия открытия в соседнем подразделе.'}</p>}
  </section>;
}
