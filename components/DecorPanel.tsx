'use client';

import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CityActionSheet } from '@/components/CityActionSheet';
import { DecorArt } from '@/components/DecorArt';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import { COMFORT_MAX, COMFORT_MILESTONES, calculateComfort, comfortAvailableCeiling, comfortPlacementGain } from '@/lib/game/comfort';
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
  onFindOnMap?: (decorId: string) => void;
};

const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 20 });

export function DecorPanel(props: Props) {
  const id = useId();
  const [view, setView] = useState<'available' | 'comfort' | 'placed' | 'locked'>('available');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedPlacedId, setSelectedPlacedId] = useState<string | null>(null);
  const lockedFilterRef = useRef<HTMLButtonElement>(null);
  const comfort = calculateComfort(props.decor);
  const best = Math.min(COMFORT_MAX, Math.max(comfort.score, Number.isFinite(props.highestComfort) ? Number(props.highestComfort) : 0));
  const next = COMFORT_MILESTONES.find(milestone => milestone.target > best);
  const rewardsUnlocked = best >= COMFORT_MILESTONES[0].target;
  const placedCounts = new Map<string, number>();
  for (const item of props.decor) placedCounts.set(item.type, (placedCounts.get(item.type) ?? 0) + 1);
  const available = props.catalog.filter(item => decorRequirements(item, props.hqLevel, props.completedResearch).unlocked);
  const locked = props.catalog.filter(item => !decorRequirements(item, props.hqLevel, props.completedResearch).unlocked);
  const comfortItems = available.filter(item => comfortPlacementGain(props.decor, item.type) > 0);
  const placedTypes = props.catalog.filter(item => (placedCounts.get(item.type) ?? 0) > 0);
  const availableCeiling = comfortAvailableCeiling(available.map(item => item.type));
  const items = { available, comfort: comfortItems, placed: placedTypes, locked }[view];
  const selected = props.catalog.find(item => item.type === selectedType);
  const selectedPlaced = selected ? props.decor.filter(item => item.type === selected.type)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id)) : [];
  const chosenPlacedId = selectedPlaced.find(item => item.id === selectedPlacedId)?.id ?? selectedPlaced[0]?.id ?? '';
  const credits = Number(props.resources.credits ?? 0);
  const balance = Number.isFinite(credits) ? credits : 0;
  const full = Number.isFinite(props.freeCells) && Number(props.freeCells) <= 0;
  const selectedRequirements = selected ? decorRequirements(selected, props.hqLevel, props.completedResearch) : null;
  const selectedGain = selected ? comfortPlacementGain(props.decor, selected.type) : 0;
  const selectedCount = selectedPlaced.length;
  const researchName = selected?.researchRequirementName ?? RESEARCH_TREE.find(research => research.key === selected?.unlockResearch)?.name ?? 'нужную технологию';
  const copyHint = comfort.score === COMFORT_MAX ? 'Комфорт уже достиг 100. Новая копия изменит оформление города.'
    : selectedCount >= 2 ? 'В комфорте учитываются не более двух объектов одного вида. Новые копии нужны только для оформления.'
      : `${selectedCount === 0 ? 'Первый объект этого вида' : 'Второй объект этого вида'} даст сейчас +${selectedGain} к комфорту.${selected && selectedGain < (selectedCount === 0 ? selected.comfort : Math.floor(selected.comfort / 2)) ? ' Прирост ограничен общим пределом 100 очков.' : selectedCount === 0 ? ' Разные виды помогают быстрее повысить комфорт.' : ' Это половина базового бонуса вида.'}`;

  function closeThen(action: () => void) {
    // Restore map scroll and focus before the next screen opens.
    flushSync(() => setSelectedType(null));
    action();
  }

  function gainLabel(gain: number) {
    return gain > 0 ? `+${gain} к комфорту` : comfort.score === COMFORT_MAX ? 'Комфорт максимален' : 'Для оформления';
  }

  function showLockedTypes() {
    setView('locked');
    lockedFilterRef.current?.focus({ preventScroll: true });
    lockedFilterRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  return <>
    <section className="card decorPanel" data-decor-panel aria-labelledby={`${id}-title`}>
      <div className="decorPanelHeading"><div><h2 id={`${id}-title`}><GameIcon name="decor" />Благоустройство</h2><p>Обустрой лунную базу и открывай награды за комфорт.</p></div><span className="decorComfortValue" aria-label={`Текущий комфорт: ${comfort.score} из ${COMFORT_MAX}`}><GameIcon name="comfort" size={17} /><strong>{comfort.score}</strong><small>/{COMFORT_MAX}</small></span></div>
      <div className="decorComfortTrack" role="progressbar" aria-label="Текущий комфорт колонии" aria-valuemin={0} aria-valuemax={COMFORT_MAX} aria-valuenow={comfort.score}><i style={{ width: `${comfort.score}%` }} /></div>
      <div className="decorComfortSummary"><span>Сейчас {comfort.score} · рекорд {best}</span><span>{comfort.unique} видов · {comfort.total} объектов</span></div>
      <div className="decorNextGoal" data-decor-next-goal>
        {next ? <><span>Следующая награда · рекорд {next.target}</span><strong>{next.reward}</strong><small>{best > comfort.score ? `Рекорд ${best} сохраняется. Для новой награды подними текущий комфорт до ${next.target}: ещё ${next.target - comfort.score} очков.` : `Ещё ${next.target - comfort.score} очков комфорта до открытия.`}</small></> : <><strong><GameIcon name="check" size={15} />Все награды за комфорт открыты</strong><small>Можно забрать неполученные награды в достижениях и продолжать украшать город.</small></>}
        <small data-decor-available-ceiling>Открытые виды дают до {availableCeiling}/{COMFORT_MAX} комфорта при двух объектах каждого вида. Для размещения нужны кредиты и свободные клетки.</small>
        {next && next.target > availableCeiling && locked.length > 0 && <div className="decorGoalUnlock" data-decor-goal-unlock><small>Для рекорда {next.target} понадобятся новые виды декора: этот предел уже учитывает по две копии каждого открытого вида.</small><button type="button" className="miniButton" data-decor-show-locked onClick={showLockedTypes}>Посмотреть условия открытия · бесплатно<GameIcon name="arrow" size={13} /></button></div>}
      </div>
      {props.onAchievements && rewardsUnlocked && <button type="button" className="miniButton decorRewardsLink" disabled={props.busy} onClick={props.onAchievements}>К наградам за комфорт<GameIcon name="arrow" size={13} /></button>}
      {full && <div className="decorFullMap" role="status"><strong>На карте нет свободных клеток</strong><span>Для нового декора нужно освободить место. На карте можно выбрать объект и посмотреть его действия.</span>{props.onOpenMap && <button type="button" className="miniButton" data-decor-open-map disabled={props.busy} onClick={props.onOpenMap}>Открыть карту<GameIcon name="arrow" size={13} /></button>}</div>}
      <MechanicGuide steps={[
        'Выбор объекта и переход к выбору клетки бесплатны. Кредиты спишутся, когда нажмёшь свободную клетку на карте. До этого можно отменить размещение.',
        'Первый объект вида даёт полный бонус к комфорту, второй — половину. Остальные копии нужны для оформления. Максимум — 100 очков.',
        'Награды открываются за рекорд комфорта и забираются в достижениях. Перенос бесплатный; демонтаж возвращает половину цены и может снизить текущий комфорт, сохраняя рекорд.',
      ]} />
      <p className="decorShopDifference">Декор за кредиты ставится на клетки и учитывается в комфорте. Темы меняют облик колонии; монументы из магазина стоят под картой, не занимают клетки и не добавляют комфорт.</p>
      <div className="decorFilters" role="group" aria-label="Виды декора">{([
        ['available', 'Открыто', available.length], ['comfort', 'Для комфорта', comfortItems.length],
        ['placed', 'В городе', placedTypes.length], ['locked', 'Закрыто', locked.length],
      ] as const).map(([key, label, count]) => <button key={key} ref={key === 'locked' ? lockedFilterRef : undefined} type="button" data-decor-view={key} className={view === key ? 'isActive' : ''} aria-pressed={view === key} onClick={() => setView(key)}>{label} <span>{count}</span></button>)}</div>
      <p className="decorCatalogHint">{view === 'comfort' ? 'Эти открытые виды повысят комфорт новой копией. Для покупки всё равно нужны кредиты и свободная клетка.' : view === 'placed' ? 'Здесь уже установленный декор. Открой описание и выбери объект, чтобы бесплатно найти его на карте.' : 'Цена указана за один новый объект. Выбери декор — откроются подробности и условия размещения.'}</p>
      <div className="decorItems" data-decor-catalog-view={view}>{items.map(item => {
        const requirements = decorRequirements(item, props.hqLevel, props.completedResearch);
        const gain = comfortPlacementGain(props.decor, item.type);
        const count = placedCounts.get(item.type) ?? 0;
        const status = view === 'placed' ? 'Выбрать объект на карте' : !requirements.hqMet ? `Центр ур. ${item.unlockHq}` : !requirements.researchMet ? 'Нужна технология' : full ? 'Нужно место на карте' : balance < item.credits ? 'Нужны кредиты' : 'Можно разместить';
        return <button type="button" className={`decorCatalogTile${requirements.unlocked || view === 'placed' ? '' : ' isLocked'}`} key={item.type} data-decor-type={item.type} aria-haspopup="dialog" onClick={() => setSelectedType(item.type)}>
          <span className="decorItemArt" aria-hidden="true"><DecorArt type={item.type} /></span><strong>{item.name}</strong>
          <span className="decorItemPrice" data-decor-price={item.type}>{count > 0 && 'Новая копия · '}<GameAmount resource="credits">{number(item.credits)}</GameAmount></span>
          <span className={`decorItemGain${gain === 0 ? ' isNeutral' : ''}`}>{view === 'placed' && 'Новая копия: '}{gainLabel(gain)}</span>
          <span className="decorItemOwned">В городе: {number(count)}</span>
          <span className={`decorTileStatus${status === 'Можно разместить' || view === 'placed' ? ' isReady' : ''}`}>{status}</span>
        </button>;
      })}</div>
      {items.length === 0 && <div className="decorEmpty" role="status"><p>{view === 'locked' ? 'Закрытых видов нет. Доступный декор находится в разделе «Открыто».' : view === 'placed' ? 'В городе пока нет декора из каталога. Выбери открытый вид и размести его на свободной клетке.' : view === 'comfort' ? comfort.score === COMFORT_MAX ? 'Комфорт уже достиг 100. Можно оформить город по своему вкусу или найти установленный декор.' : 'Новые копии открытых видов сейчас не добавят комфорта. Для дальнейшего роста понадобятся другие виды.' : locked.length > 0 ? 'Открытых видов пока нет. Посмотри условия открытия декора.' : 'Каталог декора пока пуст.'}</p><div className="decorEmptyActions">{view !== 'available' && available.length > 0 && <button type="button" className="miniButton" data-decor-show-available onClick={() => setView('available')}>Посмотреть открытые виды<GameIcon name="arrow" size={13} /></button>}{view !== 'locked' && locked.length > 0 && <button type="button" className="miniButton" data-decor-empty-locked onClick={showLockedTypes}>Посмотреть закрытые виды<GameIcon name="arrow" size={13} /></button>}</div></div>}
      <details className="decorInstructions"><summary><GameIcon name="comfort" size={15} />Правила комфорта и все награды</summary><p>Растения и вода находятся в герметичных модулях. Вместе с маяками и настилами они делают лунную базу уютнее — это отражает показатель комфорта.</p><p>Положение объектов на комфорт не влияет, соединять здания настилами необязательно. Отсутствие в игре на комфорт не влияет.</p><p>Декор не меняет производство и рейтинг города. Платные темы и монументы из магазина на комфорт не влияют.</p><div className="decorMilestones" aria-label="Награды за комфорт">{COMFORT_MILESTONES.map(milestone => <div className={best >= milestone.target ? 'isReached' : ''} key={milestone.target}><strong><GameIcon name={best >= milestone.target ? 'check' : 'comfort'} size={13} />{milestone.target} очков</strong><span>{milestone.reward}</span><small>{best >= milestone.target ? 'Открыта в достижениях' : 'Предстоит открыть'}</small></div>)}</div></details>
    </section>
    <CityActionSheet open={!!selected} title={selected?.name ?? 'Декор'} eyebrow="Объект благоустройства" closeLabel="Закрыть описание декора" onClose={() => setSelectedType(null)}>
      {selected && selectedRequirements && <section className="card decorDetails" data-decor-details={selected.type}>
        <div className="decorDetailHeading"><span className="decorDetailArt" aria-hidden="true"><DecorArt type={selected.type} /></span><div><h2>{selected.name}</h2><span>{gainLabel(selectedGain)} · в городе {number(selectedCount)}</span></div></div>
        <p className="decorDetailDescription">{selected.description}</p>
        {selectedPlaced.length > 0 && <div className="decorPlacedObjects" data-decor-placed-objects><h3>Уже в городе · {number(selectedPlaced.length)}</h3>{selectedPlaced.length === 1 ? <p>Клетка {selectedPlaced[0].x + 1}:{selectedPlaced[0].y + 1}</p> : <label htmlFor={`${id}-placed`}>Какой объект показать<select id={`${id}-placed`} data-decor-placed-select value={chosenPlacedId} onChange={event => setSelectedPlacedId(event.target.value)}>{selectedPlaced.map(item => <option key={item.id} value={item.id}>Клетка {item.x + 1}:{item.y + 1}</option>)}</select></label>}{props.onFindOnMap && <button type="button" className="action secondary" data-decor-find={chosenPlacedId} disabled={props.busy} onClick={() => { if (props.busy || !selectedPlaced.some(item => item.id === chosenPlacedId)) return; closeThen(() => props.onFindOnMap?.(chosenPlacedId)); }}>Показать на карте · бесплатно<GameIcon name="arrow" size={15} /></button>}<p>Для переноса нажми выделенный объект на карте и открой его действия. Перенос бесплатный.</p></div>}
        <div className="decorDetailCost"><span>{selectedCount > 0 ? 'Новая копия · размещение на клетке' : 'Размещение на клетке'}</span><strong><GameAmount resource="credits">{number(selected.credits)}</GameAmount></strong></div>
        <p className="decorCopyHint">{copyHint}</p>
        {selectedRequirements.unlocked ? <>
          <button type="button" className="action" data-decor-place disabled={props.busy || balance < selected.credits || full} onClick={() => closeThen(() => props.onPlace(selected.type, selected.name))}><GameIcon name="build" size={16} />{selectedCount > 0 ? 'Выбрать клетку для новой копии' : 'Выбрать клетку'}</button>
          {balance < selected.credits && <p className="decorItemShortage" role="status">Не хватает <GameAmount resource="credits">{number(Math.ceil(selected.credits - balance))}</GameAmount></p>}
          {full ? <div className="decorFullMap"><strong>На карте нет свободных клеток</strong><span>Освободи место для нового объекта.</span>{props.onOpenMap && <button type="button" className="miniButton" data-decor-open-map disabled={props.busy} onClick={() => closeThen(props.onOpenMap!)}>Открыть карту<GameIcon name="arrow" size={13} /></button>}</div> : <p className="decorPlacementHint">Переход на карту бесплатный. Нажатие свободной клетки спишет <GameAmount resource="credits">{number(selected.credits)}</GameAmount>. До этого можно отменить размещение.</p>}
        </> : <div className="decorItemGate">
          {!selectedRequirements.hqMet && <span>Нужен центр колонии ур. {selected.unlockHq}</span>}
          {!selectedRequirements.researchMet && <span>Технология «{researchName}»</span>}
          {!selectedRequirements.hqMet ? <button type="button" className="action secondary" data-decor-upgrade disabled={props.busy} onClick={() => closeThen(props.onUpgradeHq)}>К центру колонии<GameIcon name="arrow" size={15} /></button> : selected.unlockResearch && <button type="button" className="action secondary" data-decor-research disabled={props.busy} onClick={() => closeThen(() => props.onResearch(selected.unlockResearch!))}>К исследованию<GameIcon name="arrow" size={15} /></button>}
        </div>}
        {props.busy && <p className="decorPlacementHint" role="status">Дождись завершения текущего действия колонии.</p>}
      </section>}
    </CityActionSheet>
  </>;
}
