'use client';

import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import type { BuildingConfig, ResourceCost } from '@/lib/game/config';
import { BuildingArt } from '@/components/BuildingArt';
import { CityActionSheet } from '@/components/CityActionSheet';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { ResourceShortage } from '@/components/ResourceShortage';
import '@/app/building-catalog.css';

export type BuildingCategory = 'resources' | 'production' | 'development' | 'appearance';
export type CatalogBuilding = BuildingConfig & {
  type: string;
  unlockedByResearch?: boolean;
  researchRequirementName?: string | null;
};

type Props = {
  catalog: CatalogBuilding[];
  buildings: { type: string; status: string }[];
  hqLevel: number;
  resources: Record<string, unknown>;
  busy: boolean;
  category: BuildingCategory;
  onCategoryChange: (category: BuildingCategory) => void;
  onBuild: (type: string, name: string) => void;
  onPlanResearch: (key: string) => void;
  onUpgradeHq: () => void;
};

const CATEGORIES: { key: BuildingCategory; name: string; hint: string; types: string[] }[] = [
  { key: 'resources', name: 'Добыча', hint: 'Руда, энергия и кредиты поступают автоматически. Выбирай, чего не хватает колонии.', types: ['mine', 'solar', 'deep_mine', 'solar_array', 'habitat'] },
  { key: 'production', name: 'Цеха', hint: 'Производи детали, храни запасы и доставляй ресурсы для развития колонии.', types: ['foundry', 'warehouse', 'logistics'] },
  { key: 'development', name: 'Развитие', hint: 'Открывай исследования, торговлю и экспедиции — у каждого здания своя возможность.', types: ['research_lab', 'trade_hub', 'expedition_center'] },
  { key: 'appearance', name: 'Облик', hint: 'Эти здания развивают облик и рейтинг города. Отдельных производственных бонусов у них пока нет.', types: ['alliance_hub', 'observatory'] },
];

const ROLES: Record<string, string> = {
  mine: 'Добывает руду', solar: 'Даёт энергию', deep_mine: 'Больше руды с клетки',
  solar_array: 'Больше энергии с клетки', habitat: 'Приносит кредиты',
  foundry: 'Производит детали', warehouse: 'Вмещает больше ресурсов',
  research_lab: 'Наука и технологии', trade_hub: 'Контракты и рынок', expedition_center: 'Полёты за добычей',
  logistics: 'Проекты снабжения', alliance_hub: 'Облик и рейтинг', observatory: 'Облик и рейтинг',
};

function number(value: number) { return value.toLocaleString('ru-RU', { maximumFractionDigits: 20 }); }

function duration(seconds: number) {
  const total = Math.max(1, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const rest = total % 60;
  return [hours && `${hours} ч.`, minutes && `${minutes} мин.`, rest && `${rest} сек.`].filter(Boolean).join(' ');
}

function canAfford(cost: ResourceCost, resources: Record<string, unknown>) {
  return Object.entries(cost).every(([resource, required]) => Number(resources[resource] ?? 0) >= Number(required));
}

export function BuildingCatalog(props: Props) {
  const id = useId();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const selected = props.catalog.find((item) => item.type === selectedType);
  const category = CATEGORIES.find((item) => item.key === props.category) ?? CATEGORIES[0];
  const items = category.types.flatMap((type) => props.catalog.filter((item) => item.type === type));
  const available = items.filter((item) => props.hqLevel >= item.unlockHq);
  const future = items.filter((item) => props.hqLevel < item.unlockHq);
  const owned = (type: string) => props.buildings.filter((building) => building.type === type).length;
  const hqReady = selected ? props.hqLevel >= selected.unlockHq : false;
  const researchReady = selected?.unlockedByResearch !== false;

  function closeThen(action: () => void) {
    // Restore the page scroll and focus before a map or research navigation runs.
    flushSync(() => setSelectedType(null));
    action();
  }

  function tile(item: CatalogBuilding) {
    const status = props.hqLevel < item.unlockHq ? `База ур. ${item.unlockHq}`
      : item.unlockedByResearch === false ? 'Нужна технология'
      : canAfford(item.baseBuildCost, props.resources) ? 'Хватает ресурсов' : 'Нужны ресурсы';
    return <button key={item.type} type="button" className="buildingCatalogTile" data-building-type={item.type}
      aria-haspopup="dialog" onClick={() => setSelectedType(item.type)}>
      <span className="buildingCatalogTileArt" aria-hidden="true"><BuildingArt type={item.type} /></span>
      <strong>{item.name}</strong>
      <span className="buildingCatalogRole">{ROLES[item.type] ?? 'Здание колонии'}</span>
      <span className="buildingCatalogOwned">В колонии: {owned(item.type)}</span>
      <span className={`buildingCatalogStatus ${status === 'Хватает ресурсов' ? 'isReady' : ''}`}>{status}</span>
    </button>;
  }

  return <>
    <div className="buildingCatalogHeading">
      <h2><GameIcon name="build" />Строительство</h2>
      <button type="button" className="buildingCatalogHq" disabled={props.busy} onClick={props.onUpgradeHq}>
        <GameIcon name="upgrade" size={15} />База ур. {props.hqLevel}
      </button>
    </div>
    <p className="buildingCatalogIntro">Выбери назначение здания. Стоимость и условия откроются по нажатию.</p>
    <div className="buildingCatalogCategories" role="group" aria-label="Назначение постройки" aria-describedby={`${id}-hint`}>
      {CATEGORIES.map((item) => <button type="button" key={item.key}
        className={`buildingCatalogCategory ${category.key === item.key ? 'isSelected' : ''}`} data-building-category={item.key}
        aria-pressed={category.key === item.key} onClick={() => props.onCategoryChange(item.key)}>{item.name}</button>)}
    </div>
    <p className="buildingCatalogHint" id={`${id}-hint`}>{category.hint}</p>
    {available.length ? <div className="buildingCatalogGrid">{available.map(tile)}</div>
      : <p className="buildingCatalogEmpty">{future.length
        ? `Постройки этого раздела откроются с базы уровня ${Math.min(...future.map((item) => item.unlockHq))}. Посмотри их условия ниже или выбери другое назначение.`
        : 'В этом разделе пока нет доступных построек.'}</p>}
    {future.length > 0 && <details className="buildingCatalogFuture" key={category.key} data-building-future>
      <summary>Позже с развитием базы ({future.length})</summary>
      <div className="buildingCatalogGrid">{future.map(tile)}</div>
    </details>}
    <p className="buildingCatalogQueueHint">Одновременно можно вести 2 стройки, с Premium — 3.</p>
    <CityActionSheet open={Boolean(selected)} title={selected?.name ?? 'Постройка'} eyebrow="Строительство" closeLabel="Закрыть карточку постройки" onClose={() => setSelectedType(null)}>
      {selected && <div className="buildingCatalogDetail" data-building-detail={selected.type}>
        <div className="buildingCatalogDetailHeading">
          <BuildingArt type={selected.type} />
          <div><h3>{selected.name}</h3><span>В колонии: {owned(selected.type)}</span></div>
        </div>
        <p className="buildingCatalogPurpose">{selected.description ?? ROLES[selected.type] ?? 'Постройка для развития колонии.'}</p>
        <dl className="buildingCatalogFacts">
          <div><dt>Стоимость строительства</dt><dd className="buildingCatalogCost">
            {Object.entries(selected.baseBuildCost).filter(([, amount]) => Number(amount) > 0).map(([resource, amount]) =>
              <GameAmount key={resource} resource={resource}>{number(Number(amount))}</GameAmount>)}
          </dd></div>
          <div><dt><GameIcon name="clock" size={14} />Базовое время</dt><dd>{duration(selected.baseBuildTimeSec)}</dd></div>
        </dl>
        {(!hqReady || selected.unlockResearch) && <div className="buildingCatalogRequirements">
          <strong>Условия открытия</strong>
          <p><GameIcon name={hqReady ? 'check' : 'upgrade'} size={14} />База ур. {selected.unlockHq}{hqReady ? ' — достигнут' : ` · сейчас ур. ${props.hqLevel}`}</p>
          {selected.unlockResearch && <p><GameIcon name={researchReady ? 'check' : 'research'} size={14} />
            {researchReady ? 'Изучено: ' : 'Нужна технология: '}«{selected.researchRequirementName ?? selected.unlockResearch}»
          </p>}
        </div>}
        <div className="buildingCatalogActions">
          {!hqReady ? <button type="button" className="action" disabled={props.busy} onClick={() => closeThen(props.onUpgradeHq)}>
            <GameIcon name="upgrade" size={18} />Улучшить базу
          </button> : !researchReady && selected.unlockResearch ? <button type="button" className="action" disabled={props.busy}
            onClick={() => closeThen(() => props.onPlanResearch(selected.unlockResearch!))}>
            <GameIcon name="research" size={18} />План открытия
          </button> : <>
            <div aria-live="polite"><ResourceShortage cost={selected.baseBuildCost} resources={props.resources} /></div>
            <button type="button" className="action" disabled={props.busy} onClick={() => closeThen(() => props.onBuild(selected.type, selected.name))}>
              <GameIcon name="build" size={18} />Выбрать место
            </button>
            <p className="buildingCatalogPaymentHint">{selected.type === 'foundry' ? 'Выбери клетку, сравни связи и подтверди строительство. Ресурсы спишутся по кнопке «Построить здесь».' : 'Ресурсы спишутся только после выбора свободной клетки.'}</p>
          </>}
          {!hqReady && !researchReady && selected.unlockResearch && <button type="button" className="miniButton" disabled={props.busy}
            onClick={() => closeThen(() => props.onPlanResearch(selected.unlockResearch!))}><GameIcon name="research" size={15} />План исследования</button>}
        </div>
      </div>}
    </CityActionSheet>
  </>;
}
