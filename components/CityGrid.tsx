'use client';

import { useEffect, useRef, useState } from 'react';
import { createProductionNetwork, type ProductionEdge, type ProductionResource } from '@/lib/game/production-network';
import { cityProductionStatuses, type CityProductionStatus } from '@/lib/game/city-production-status';
import type { FoundryJob } from '@/lib/game/foundry';
import { durationText } from '@/lib/game/format';
import { BuildingArt } from '@/components/BuildingArt';
import { GameIcon } from '@/components/GameIcon';
import { DecorArt } from '@/components/DecorArt';
import { CityConnections } from '@/components/CityConnections';
import { CityActivity } from '@/components/CityActivity';
import { createCityConnections, connectedCityDirections } from '@/lib/game/city-connections';
import { CosmeticAtmosphere, CosmeticBadge, CosmeticMonument, cosmeticFrameClass } from '@/components/CosmeticAppearance';
import '@/app/production.css';
import '@/app/city-art.css';
import '@/app/production-network.css';
import '@/app/city-production-status.css';

const PRODUCTION_STATUS = {
  idle: { label: 'Свободен', icon: 'foundry' }, running: { label: 'Плавка', icon: 'parts' },
  queued: { label: 'Ожидает старта', icon: 'clock' }, ready: { label: 'К выдаче', icon: 'check' },
  blocked: { label: 'Нужно место', icon: 'warehouse' }, check: { label: 'Проверить', icon: 'refresh' },
  building: { label: 'Строится', icon: 'clock' }, upgrading: { label: 'Улучшается', icon: 'upgrade' },
};

function productionDescription(item: CityProductionStatus, now: number) {
  const queue = item.occupied !== null && item.capacity !== null ? ` Очередь ${item.occupied} из ${item.capacity}.` : '';
  const works = item.buildingStatus === 'upgrading' ? ' Цех улучшается; оплаченные циклы продолжаются.' : '';
  const running = item.running ? ` Плавка: ${Math.floor(item.running.progress * 100)}%, ещё ${durationText(Math.max(0, Math.ceil((item.running.completesAt - now) / 1000))).replace(/\.$/, '')}.` : '';
  if (item.status === 'check') return `Проверь состояние очереди.${queue}${works}`;
  if (item.status === 'blocked') return `Готовых циклов: ${item.readyCount}; по текущему складу помещается ${item.collectableCount}. Остальные ждут места, детали ещё не выданы.${queue}${works}${running}`;
  if (item.status === 'ready') return `К проверке выдачи готово циклов: ${item.readyCount}, деталей: ${item.readyParts}. Они ещё не выданы.${queue}${works}${running}`;
  if (item.status === 'idle') return `Цех свободен. Можно подготовить новую партию.${queue}`;
  if (item.status === 'queued') return `Оплаченные циклы ожидают времени старта.${queue}`;
  if (item.status === 'running') return `${running.trim()}${queue}`;
  return `${PRODUCTION_STATUS[item.status].label}.${queue}${works}${running}`;
}

type Building = {
  id: string;
  type: string;
  level: number;
  x: number;
  y: number;
  status: string;
  target_level?: number | null;
};

type Decor = { id: string; type: string; x: number; y: number };
type CatalogItem = { type: string; name: string; emoji: string };
type DecorCatalogItem = { type: string; name: string; emoji: string };

export function CityGrid(props: {
  buildings: Building[];
  decor?: Decor[];
  catalog: CatalogItem[];
  decorCatalog?: DecorCatalogItem[];
  gridSize: number;
  selectedId?: string | null;
  selectedDecorId?: string | null;
  decorFocus?: { id: string; requestId: number } | null;
  onDecorFocused?: (requestId: number, found: boolean) => void;
  placementMode?: boolean;
  decorPlacementMode?: boolean;
  moveMode?: boolean;
  planningType?: string;
  movingBuildingId?: string;
  productionNetwork?: boolean;
  production?: { jobs?: readonly FoundryJob[]; currentParts: unknown; partsCapacity?: number };
  onFoundryQueue?: (buildingId: string) => void;
  planningCell?: { x: number; y: number } | null;
  theme?: string;
  weather?: string;
  buildingSkin?: string;
  frame?: string;
  effect?: string;
  badge?: string;
  onCell?: (x: number, y: number, building?: Building, decor?: Decor) => void;
  compact?: boolean;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const mapPlanning = Boolean(props.placementMode || props.decorPlacementMode || props.moveMode);
  const hasProduction = Boolean(props.production && !props.compact);
  const showProduction = hasProduction && !mapPlanning;
  const timedProduction = hasProduction && (props.production?.jobs ?? []).some(job =>
    Date.parse(job.completes_at) > Date.now() || Date.parse(job.started_at) > Date.now());
  useEffect(() => {
    if (!hasProduction) return;
    setNow(Date.now());
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener('visibilitychange', tick);
    const timer = timedProduction ? window.setInterval(tick, 1000) : null;
    return () => { if (timer !== null) window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [hasProduction, timedProduction, props.production?.jobs]);
  const productionStatuses = hasProduction && props.production ? cityProductionStatuses({ buildings: props.buildings,
    ...props.production, now }) : [];
  const statusById = new Map(productionStatuses.map(item => [item.buildingId, item]));
  const focusRequest = props.decorFocus;
  useEffect(() => {
    if (!focusRequest || props.compact) return;
    // Wait for the parent's section navigation and scroll restoration first.
    const frame = window.requestAnimationFrame(() => {
      const cell = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-city-decor-id]') ?? [])]
        .find(element => element.dataset.cityDecorId === focusRequest.id);
      const found = !!cell && cell.isConnected && !cell.disabled;
      if (found) {
        cell.focus({ preventScroll: true });
        cell.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
      props.onDecorFocused?.(focusRequest.requestId, found);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, props.compact]);
  const byCell = new Map(props.buildings.map((b) => [`${b.x}:${b.y}`, b]));
  const decorByCell = new Map((props.decor ?? []).map((d) => [`${d.x}:${d.y}`, d]));
  const connections = createCityConnections(props.buildings, props.decor ?? [], props.gridSize);
  const production = createProductionNetwork(props.buildings, props.decor ?? [], props.gridSize);
  const movingBuilding = props.buildings.find((building) => building.id === props.movingBuildingId);
  const planningFoundry = !props.compact && ((props.placementMode && props.planningType === 'foundry')
    || (props.moveMode && movingBuilding?.type === 'foundry'));
  const showNetwork = Boolean(props.productionNetwork && !props.compact);
  const candidate = planningFoundry && props.planningCell
    ? production.placement(props.planningCell.x, props.planningCell.y, props.movingBuildingId) : null;
  const placements = new Map<string, ReturnType<typeof production.placement>>();
  const supplierResources = new Map<string, Set<ProductionResource>>();
  function addResource(map: Map<string, Set<ProductionResource>>, id: string, resource: ProductionResource) {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id)!.add(resource);
  }
  if (planningFoundry) {
    for (let y = 0; y < props.gridSize; y++) for (let x = 0; x < props.gridSize; x++) {
      const placement = production.placement(x, y, props.movingBuildingId);
      placements.set(`${x}:${y}`, placement);
      for (const edge of placement.edges) addResource(supplierResources, edge.supplierId, edge.resource);
    }
  }
  const currentEdges = showNetwork ? production.edges.filter(edge => !planningFoundry || edge.foundryId !== props.movingBuildingId) : [];
  const planningEdges = candidate?.available ? candidate.edges : [];
  const nodeResources = new Map<string, Set<ProductionResource>>();
  for (const edge of [...currentEdges, ...planningEdges]) {
    addResource(nodeResources, edge.foundryId, edge.resource);
    addResource(supplierResources, edge.supplierId, edge.resource);
  }
  const hasOverlay = currentEdges.length > 0 || planningEdges.length > 0;
  function edgeGraphic(edge: ProductionEdge, planning = false) {
    const x1 = (edge.from.x + .5) * 100, y1 = (edge.from.y + .5) * 100;
    const x2 = (edge.to.x + .5) * 100, y2 = (edge.to.y + .5) * 100;
    const path = `M${x1} ${y1}L${x2} ${y2}`;
    return <g key={`${edge.foundryId}:${edge.supplierId}:${edge.resource}:${planning}`}
      className={`cityProductionEdge ${edge.resource === 'energy' ? 'isEnergy' : 'isOre'} ${planning ? 'isPlanning' : ''}`}
      data-production-edge={planning ? 'planning' : 'available'} data-production-resource={edge.resource}>
      <path className="productionEdgeBed" d={path} />
      <path className="productionEdgeLine" d={path} />
      <circle className="productionEdgePort" cx={x1} cy={y1} r={4} />
      <circle className="productionEdgePort" cx={x2} cy={y2} r={4} />
    </g>;
  }
  const cells = [];
  for (let y = 0; y < props.gridSize; y++) {
    for (let x = 0; x < props.gridSize; x++) {
      const b = byCell.get(`${x}:${y}`);
      const d = decorByCell.get(`${x}:${y}`);
      const cfg = b ? props.catalog.find((c) => c.type === b.type) : undefined;
      const decorCfg = d ? props.decorCatalog?.find((c) => c.type === d.type) : undefined;
      const occupied = !!b || !!d;
      const selected = Boolean((b && b.id === props.selectedId) || (d && d.id === props.selectedDecorId));
      const chosenCandidate = Boolean(candidate?.available && props.planningCell?.x === x && props.planningCell?.y === y);
      const constructing = b && b.status !== 'active';
      const productionStatus = b && showProduction ? statusById.get(b.id) : undefined;
      const activityStatus = b ? statusById.get(b.id) : undefined;
      const opensQueue = Boolean(productionStatus && props.onFoundryQueue && (b?.status === 'active' || (productionStatus.occupied ?? 0) > 0));
      const productionHint = productionStatus ? productionDescription(productionStatus, now) : '';
      const roadConnections = connections.road(x, y);
      const arrivalConnections = b ? connections.building(x, y) : d?.type === 'plaza' ? roadConnections : {};
      const arrivalCount = connectedCityDirections(arrivalConnections).length;
      const links = planningFoundry && !occupied ? placements.get(`${x}:${y}`)?.links ?? [] : [];
      const linkDescription = links.map((link) => link === 'ore' ? 'доступна связь с шахтой для экономии руды' : 'доступна связь с энергетикой для экономии энергии').join('; ');
      const supplierLinks = b ? [...(supplierResources.get(b.id) ?? [])] : [];
      const foundryLinks = b ? [...(nodeResources.get(b.id) ?? [])] : [];
      const nodeLinks = b?.type === 'foundry' ? foundryLinks : supplierLinks;
      const nodeDescription = nodeLinks.length ? b?.type === 'foundry'
        ? `; доступны связи: ${nodeLinks.map(resource => resource === 'ore' ? 'руда' : 'энергия').join(', ')}. В новом заказе можно выбрать одну связь`
        : `; поставщик ${nodeLinks[0] === 'ore' ? 'руды' : 'энергии'} для связи цеха` : '';
      cells.push(
        <button
          type="button"
          key={`${x}:${y}`}
          className={`cityCell ${b ? 'occupied' : d ? `decorCell decor-${d.type}` : `empty terrain-${(x * 11 + y * 7) % 9}`} ${selected ? 'selected' : ''} ${constructing ? 'busyCell' : ''} ${links.length ? 'linkPreview' : ''} ${chosenCandidate ? 'cityPlanningCandidate' : ''} ${supplierLinks.length ? `productionSupplier ${supplierLinks[0] === 'ore' ? 'isOreSupplier' : 'isEnergySupplier'}` : ''} ${foundryLinks.length ? 'productionFoundry' : ''}`}
          onClick={() => opensQueue && b ? props.onFoundryQueue?.(b.id) : props.onCell?.(x, y, b, d)}
          disabled={!props.onCell && !opensQueue}
          aria-pressed={(occupied || planningFoundry) && props.onCell ? selected || chosenCandidate : undefined}
          aria-label={b ? `${cfg?.name ?? b.type}, уровень ${b.level}${constructing ? b.status === 'upgrading' ? ', улучшение' : ', строительство' : ''}${nodeDescription}${productionHint ? `. ${productionHint}` : ''}${opensQueue ? ' Открыть очередь этого цеха.' : ''}` : d ? `${decorCfg?.name ?? d.type}, клетка ${x + 1}:${y + 1}` : `${chosenCandidate ? 'Выбрано место для цеха' : 'Пустая клетка'} ${x + 1}, ${y + 1}${linkDescription ? `; ${linkDescription}` : ''}`}
          data-city-foundry-id={productionStatus ? b?.id : undefined}
          data-production-open-queue={opensQueue || undefined}
          data-city-decor-id={b ? undefined : d?.id}
          title={productionHint || linkDescription || undefined}
          data-connected-road-count={b || d?.type === 'plaza' ? arrivalCount : undefined}
          data-production-node={nodeLinks.length ? nodeLinks.join(' ') : undefined}
          data-production-candidate={chosenCandidate ? true : undefined}
          aria-description={arrivalCount ? 'Настил автоматически соединён с модулем. Это оформление, производство не меняется.' : undefined}
        >
          {b ? <>
            <CityConnections connections={arrivalConnections} active={b.status === 'active'} />
            <BuildingArt type={b.type} className="cityBuildingArt" />
            {constructing && <span className="cityConstruction" aria-hidden="true" />}
            <CityActivity type={b.type} active={b.type === 'foundry' && hasProduction ? Boolean(activityStatus?.running) : !constructing} />
            <span className="cityLevel" aria-hidden="true">{b.status === 'active' ? `L${b.level}` : <GameIcon name="clock" size={9} />}</span>
            {productionStatus && <>
              <span className={`cityFoundryStatus is-${productionStatus.status}`} data-city-production-status={productionStatus.status} aria-hidden="true"><GameIcon name={PRODUCTION_STATUS[productionStatus.status].icon} size={12} />{productionStatus.readyCount > 0 && <b>{productionStatus.readyCount}</b>}</span>
              {productionStatus.running && <span className="cityFoundryProgress" aria-hidden="true"><i style={{ width: `${Math.floor(productionStatus.running.progress * 100)}%` }} /></span>}
            </>}
          </> : d ? <>
            {d.type === 'plaza' && <CityConnections connections={arrivalConnections} />}
            <DecorArt type={d.type} className="cityDecorArt" connections={roadConnections} />
            {d.type !== 'road' && <CityActivity type={d.type} kind="decor" />}
          </>
            : chosenCandidate ? <>
              <span className="cityPlanningGhost" aria-hidden="true"><BuildingArt type="foundry" className="cityBuildingArt" /></span>
              <span className="cityPlanningGhostLabel" aria-hidden="true"><GameIcon name="check" size={11} /></span>
            </> : (props.placementMode || props.decorPlacementMode || props.moveMode) ? <span className="cityPlus" aria-hidden="true" /> : null}
          {nodeLinks.length > 0 && !productionStatus && <span className="cityProductionNode" aria-hidden="true">{nodeLinks.map(resource => <GameIcon key={resource} name={resource} size={14} />)}</span>}
          {links.length > 0 && <span className="cellLinkMarkers" aria-hidden="true">{links.map((link) => <span key={link}><GameIcon name={link === 'ore' ? 'ore' : 'energy'} size={16} /></span>)}</span>}
        </button>,
      );
    }
  }

  return <div ref={gridRef} className={`cityMap cityArtMap cosmeticSurface ${cosmeticFrameClass(props.frame)} ${props.placementMode || props.decorPlacementMode || props.moveMode ? 'isPlanning' : ''} ${hasOverlay ? 'hasProductionNetwork' : ''} ${props.compact ? 'compactMap' : ''} ${props.theme ?? ''} ${props.weather ?? ''}`}>
    <div className="cityTerrain" aria-hidden="true"><i /><i /><i /><i /></div>
    <CosmeticAtmosphere weather={props.weather} effect={props.effect} />
    <div className="cityMapGrid" style={{ gridTemplateColumns: `repeat(${props.gridSize}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${props.gridSize}, minmax(0, 1fr))` }}>
      {hasOverlay && <svg className="cityProductionOverlay" viewBox={`0 0 ${props.gridSize * 100} ${props.gridSize * 100}`} aria-hidden="true" focusable="false">
        {currentEdges.map(edge => edgeGraphic(edge))}
        {planningEdges.map(edge => edgeGraphic(edge, true))}
      </svg>}
      {cells}
    </div>
    {showProduction && productionStatuses.length > 0 && <details className="cityFoundryLegend" data-city-production-legend><summary>Производство на карте<GameIcon name="arrow" size={14} /></summary>
      <div>{(Object.keys(PRODUCTION_STATUS) as (keyof typeof PRODUCTION_STATUS)[]).filter(status => productionStatuses.some(item => item.status === status)).map(status => <span key={status} className={`is-${status}`}><GameIcon name={PRODUCTION_STATUS[status].icon} size={15} />{PRODUCTION_STATUS[status].label}</span>)}</div>
      <p>{props.onFoundryQueue ? 'Нажми на цех — откроется его очередь. Действия со зданием доступны в производстве через «На карте».' : 'Значки показывают состояние оплаченной очереди. Нажми на здание, чтобы проверить его действия.'} Готовность по таймеру требует проверки выдачи; переход сам ничего не запускает.</p>
    </details>}
    {(planningFoundry || showNetwork) && <div className="cityProductionLegend">
      <span><GameIcon name="ore" size={15} />Шахта → цех</span><span><GameIcon name="energy" size={15} />Энергетика → цех</span>
      <small>{planningFoundry ? 'Значки отмечают выгодные клетки. ' : !currentEdges.length ? 'Доступных связей пока нет. ' : 'Линии показывают доступное соседство. '}
        Работают соседи по стороне. <strong>Одна связь на новый заказ.</strong></small>
    </div>}
    {(props.badge || props.buildingSkin) && <div className="cityCosmeticFooter">
      {props.badge && <div className="cityCosmeticBadge"><CosmeticBadge id={props.badge} /><span>{props.badge === 'founder_badge' ? 'Основатель' : 'Знак колонии'}</span></div>}
      {props.buildingSkin && <div className={`cityMonumentDisplay ${props.buildingSkin}`}>
        <span>{props.buildingSkin === 'founder_monument' ? 'Монумент основателя' : props.buildingSkin === 'monument_network' ? 'Монумент сети' : props.buildingSkin === 'relay_legend' ? 'Маяк легенды' : 'Монумент колонии'}</span>
        <CosmeticMonument id={props.buildingSkin} />
      </div>}
    </div>}
  </div>;
}
