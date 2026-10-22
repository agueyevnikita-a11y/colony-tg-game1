'use client';

import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { CityActionSheet } from '@/components/CityActionSheet';
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
  freeCells?: number;
  onPlace: (type: string, name: string) => void;
  onResearch: (key: string) => void;
  onUpgradeHq: () => void;
  onAchievements?: () => void;
  onOpenMap?: () => void;
};

const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 20 });

export function DecorPanel(props: Props) {
  const id = useId();
  const [view, setView] = useState<'available' | 'locked'>('available');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const comfort = calculateComfort(props.decor);
  const best = Math.min(COMFORT_MAX, Math.max(comfort.score, Number.isFinite(props.highestComfort) ? Number(props.highestComfort) : 0));
  const next = COMFORT_MILESTONES.find(milestone => milestone.target > best);
  const rewardsUnlocked = best >= COMFORT_MILESTONES[0].target;
  const available = props.catalog.filter(item => decorRequirements(item, props.hqLevel, props.completedResearch).unlocked);
  const locked = props.catalog.filter(item => !decorRequirements(item, props.hqLevel, props.completedResearch).unlocked);
  const items = view === 'available' ? available : locked;
  const selected = props.catalog.find(item => item.type === selectedType);
  const credits = Number(props.resources.credits ?? 0);
  const balance = Number.isFinite(credits) ? credits : 0;
  const full = Number.isFinite(props.freeCells) && Number(props.freeCells) <= 0;
  const selectedRequirements = selected ? decorRequirements(selected, props.hqLevel, props.completedResearch) : null;
  const selectedGain = selected ? comfortPlacementGain(props.decor, selected.type) : 0;
  const selectedCount = selected ? comfort.counts[selected.type] ?? 0 : 0;
  const researchName = selected?.researchRequirementName ?? RESEARCH_TREE.find(research => research.key === selected?.unlockResearch)?.name ?? 'нужную технологию';

  function closeThen(action: () => void) {
    // Restore map scroll and focus before the next screen opens.
    flushSync(() => setSelectedType(null));
    action();
  }

  function gainLabel(gain: number) {
    return gain > 0 ? `+${gain} к комфорту` : comfort.score === COMFORT_MAX ? 'Комфорт максимален' : 'Для оформления';
  }

  return <>
    <section className="card decorPanel" data-decor-panel aria-labelledby={`${id}-title`}>
      <div className="decorPanelHeading"><div><h2 id={`${id}-title`}><GameIcon name="tree" />Благоустройство</h2><p>Обустрой лунную базу и открывай награды за комфорт.</p></div><span className="decorComfortValue" aria-label={`Текущий комфорт: ${comfort.score} из ${COMFORT_MAX}`}><GameIcon name="comfort" size={17} /><strong>{comfort.score}</strong><small>/{COMFORT_MAX}</small></span></div>
      <div className="decorComfortTrack" role="progressbar" aria-label="Текущий комфорт колонии" aria-valuemin={0} aria-valuemax={COMFORT_MAX} aria-valuenow={comfort.score}><i style={{ width: `${comfort.score}%` }} /></div>
      <div className="decorComfortSummary"><span>Сейчас {comfort.score} · рекорд {best}</span><span>{comfort.unique} видов · {comfort.total} объектов</span></div>
      <div className="decorNextGoal" data-decor-next-goal>
        {next ? <><span>Следующая награда · рекорд {next.target}</span><strong>{next.reward}</strong><small>{best > comfort.score ? `Рекорд ${best} сохраняется. Для новой награды подними текущий комфорт до ${next.target}: ещё ${next.target - comfort.score} очков.` : `Ещё ${next.target - comfort.score} очков комфорта до открытия.`}</small></> : <><strong><GameIcon name="check" size={15} />Все награды за комфорт открыты</strong><small>Можно забрать неполученные награды в достижениях и продолжать украшать город.</small></>}
      </div>
      {props.onAchievements && rewardsUnlocked && <button type="button" className="miniButton decorRewardsLink" disabled={props.busy} onClick={props.onAchievements}>К наградам за комфорт<GameIcon name="arrow" size={13} /></button>}
      {full && <div className="decorFullMap" role="status"><strong>На карте нет свободных клеток</strong><span>Для нового декора нужно освободить место. На карте можно выбрать объект и посмотреть его действия.</span>{props.onOpenMap && <button type="button" className="miniButton" data-decor-open-map disabled={props.busy} onClick={props.onOpenMap}>Открыть карту<GameIcon name="arrow" size={13} /></button>}</div>}
      <div className="decorFilters" role="group" aria-label="Доступность декора"><button type="button" className={view === 'available' ? 'isActive' : ''} aria-pressed={view === 'available'} onClick={() => setView('available')}>Открыто <span>{available.length}</span></button><button type="button" className={view === 'locked' ? 'isActive' : ''} aria-pressed={view === 'locked'} onClick={() => setView('locked')}>Предстоит открыть <span>{locked.length}</span></button></div>
      <p className="decorCatalogHint">Выбери объект — откроются стоимость и условия размещения.</p>
      <div className="decorItems">{items.map(item => {
        const requirements = decorRequirements(item, props.hqLevel, props.completedResearch);
        const gain = comfortPlacementGain(props.decor, item.type);
        const status = !requirements.hqMet ? `База ур. ${item.unlockHq}` : !requirements.researchMet ? 'Нужна технология' : full ? 'Нужно место на карте' : balance < item.credits ? 'Нужны кредиты' : 'Можно разместить';
        return <button type="button" className={`decorCatalogTile${requirements.unlocked ? '' : ' isLocked'}`} key={item.type} data-decor-type={item.type} aria-haspopup="dialog" onClick={() => setSelectedType(item.type)}>
          <span className="decorItemArt" aria-hidden="true"><DecorArt type={item.type} /></span><strong>{item.name}</strong>
          <span className={`decorItemGain${gain === 0 ? ' isNeutral' : ''}`}>{gainLabel(gain)}</span>
          <span className="decorItemOwned">В городе: {number(comfort.counts[item.type] ?? 0)}</span>
          <span className={`decorTileStatus${status === 'Можно разместить' ? ' isReady' : ''}`}>{status}</span>
        </button>;
      })}</div>
      {items.length === 0 && <p className="decorEmpty">{view === 'locked' ? 'Все виды декора открыты. Комбинируй объекты и выбирай свой облик города.' : 'Сначала выполни условия открытия в соседнем подразделе.'}</p>}
      <details className="decorInstructions"><summary><GameIcon name="help" size={15} />Как работают декор и комфорт</summary><p>Растения и вода находятся в герметичных модулях. Вместе с маяками и настилами они делают лунную базу уютнее — это отражает показатель комфорта.</p><ol><li>Выбери объект и нажми «Разместить».</li><li>На карте нажми свободную клетку. Кредиты спишутся только после размещения; отмена бесплатна.</li><li>Нажми на готовый декор, чтобы бесплатно перенести его. При демонтаже вернётся 50% цены.</li></ol><p>Первый объект каждого вида даёт полный бонус к комфорту, второй — половину. Следующие копии украшают город без дополнительных очков. Положение объектов на комфорт не влияет, соединять здания настилами необязательно.</p><p>Разные объекты открывают разовые награды за рекорд комфорта. Текущий комфорт может уменьшиться при демонтаже, рекорд и открытые достижения сохраняются. Отсутствие в игре на комфорт не влияет.</p><p>Декор не меняет производство и рейтинг города. Платные темы и монументы из магазина на комфорт не влияют.</p><div className="decorMilestones" aria-label="Награды за комфорт">{COMFORT_MILESTONES.map(milestone => <div className={best >= milestone.target ? 'isReached' : ''} key={milestone.target}><strong><GameIcon name={best >= milestone.target ? 'check' : 'comfort'} size={13} />{milestone.target} очков</strong><span>{milestone.reward}</span><small>{best >= milestone.target ? 'Открыта в достижениях' : 'Предстоит открыть'}</small></div>)}</div></details>
    </section>
    <CityActionSheet open={!!selected} title={selected?.name ?? 'Декор'} eyebrow="Объект благоустройства" closeLabel="Закрыть описание декора" onClose={() => setSelectedType(null)}>
      {selected && selectedRequirements && <section className="card decorDetails" data-decor-details={selected.type}>
        <div className="decorDetailHeading"><span className="decorDetailArt" aria-hidden="true"><DecorArt type={selected.type} /></span><div><h2>{selected.name}</h2><span>{gainLabel(selectedGain)} · в городе {number(selectedCount)}</span></div></div>
        <p className="decorDetailDescription">{selected.description}</p>
        <div className="decorDetailCost"><span>Стоимость размещения</span><strong><GameAmount resource="credits">{number(selected.credits)}</GameAmount></strong></div>
        <p className="decorCopyHint">{comfort.score === COMFORT_MAX ? 'Комфорт уже достиг 100. Объект изменит оформление города.' : selectedCount === 0 ? 'Первый объект этого вида даёт полный бонус. Разные виды помогают быстрее повысить комфорт.' : selectedCount === 1 ? 'Это будет второй объект вида: он даёт половину базового бонуса к комфорту.' : 'Два объекта этого вида уже учитываются в комфорте. Новые копии нужны только для оформления.'}</p>
        {selectedRequirements.unlocked ? <>
          <button type="button" className="action" data-decor-place disabled={props.busy || balance < selected.credits || full} onClick={() => closeThen(() => props.onPlace(selected.type, selected.name))}><GameIcon name="build" size={16} />Разместить на карте</button>
          {balance < selected.credits && <p className="decorItemShortage">Не хватает {number(Math.ceil(selected.credits - balance))} кредитов</p>}
          {full ? <div className="decorFullMap"><strong>На карте нет свободных клеток</strong><span>Освободи место для нового объекта.</span>{props.onOpenMap && <button type="button" className="miniButton" data-decor-open-map disabled={props.busy} onClick={() => closeThen(props.onOpenMap!)}>Открыть карту<GameIcon name="arrow" size={13} /></button>}</div> : <p className="decorPlacementHint">Кредиты спишутся после выбора свободной клетки. Отмена и перемещение бесплатны.</p>}
        </> : <div className="decorItemGate">
          {!selectedRequirements.hqMet && <span>Нужна база ур. {selected.unlockHq}</span>}
          {!selectedRequirements.researchMet && <span>Технология «{researchName}»</span>}
          {!selectedRequirements.hqMet ? <button type="button" className="action secondary" data-decor-upgrade disabled={props.busy} onClick={() => closeThen(props.onUpgradeHq)}>Улучшить базу<GameIcon name="arrow" size={15} /></button> : selected.unlockResearch && <button type="button" className="action secondary" data-decor-research disabled={props.busy} onClick={() => closeThen(() => props.onResearch(selected.unlockResearch!))}>К исследованию<GameIcon name="arrow" size={15} /></button>}
        </div>}
      </section>}
    </CityActionSheet>
  </>;
}
