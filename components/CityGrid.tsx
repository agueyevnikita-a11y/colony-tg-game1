'use client';

import { availableFoundryLinks } from '@/lib/game/foundry';
import { BuildingArt } from '@/components/BuildingArt';
import { GameIcon } from '@/components/GameIcon';
import '@/app/production.css';
import '@/app/city-art.css';

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
  placementMode?: boolean;
  decorPlacementMode?: boolean;
  moveMode?: boolean;
  planningType?: string;
  movingBuildingId?: string;
  theme?: string;
  weather?: string;
  buildingSkin?: string;
  onCell?: (x: number, y: number, building?: Building, decor?: Decor) => void;
  compact?: boolean;
}) {
  const byCell = new Map(props.buildings.map((b) => [`${b.x}:${b.y}`, b]));
  const decorByCell = new Map((props.decor ?? []).map((d) => [`${d.x}:${d.y}`, d]));
  const movingBuilding = props.buildings.find((building) => building.id === props.movingBuildingId);
  const planningFoundry = (props.placementMode && props.planningType === 'foundry')
    || (props.moveMode && movingBuilding?.type === 'foundry');
  const cells = [];
  for (let y = 0; y < props.gridSize; y++) {
    for (let x = 0; x < props.gridSize; x++) {
      const b = byCell.get(`${x}:${y}`);
      const d = decorByCell.get(`${x}:${y}`);
      const cfg = b ? props.catalog.find((c) => c.type === b.type) : undefined;
      const decorCfg = d ? props.decorCatalog?.find((c) => c.type === d.type) : undefined;
      const occupied = !!b || !!d;
      const selected = Boolean((b && b.id === props.selectedId) || (d && d.id === props.selectedDecorId));
      const constructing = b && b.status !== 'active';
      const links = planningFoundry && !occupied ? availableFoundryLinks({
        id: props.movingBuildingId ?? 'placement-preview', type: 'foundry', status: 'active',
        level: 1, x, y,
      }, props.buildings).filter((link) => link !== 'none') : [];
      const linkDescription = links.map((link) => link === 'ore' ? 'связь с шахтой: расход руды меньше на 15%' : 'связь с электростанцией: расход энергии меньше на 20%').join('; ');
      cells.push(
        <button
          type="button"
          key={`${x}:${y}`}
          className={`cityCell ${b ? 'occupied' : d ? 'decorCell' : 'empty'} ${selected ? 'selected' : ''} ${constructing ? 'busyCell' : ''} ${links.length ? 'linkPreview' : ''}`}
          onClick={() => props.onCell?.(x, y, b, d)}
          disabled={!props.onCell}
          aria-pressed={occupied && props.onCell ? selected : undefined}
          aria-label={b ? `${cfg?.name ?? b.type}, уровень ${b.level}` : d ? `${decorCfg?.name ?? d.type}` : `Пустая клетка ${x + 1}, ${y + 1}${linkDescription ? `; ${linkDescription}` : ''}`}
          title={linkDescription || undefined}
        >
          {b ? <>
            <BuildingArt type={b.type} className="cityBuildingArt" />
            {constructing ? <span className="cityConstruction" aria-hidden="true" /> : <span className={`cityActivityLight ${b.type === 'foundry' ? 'isFoundry' : ''}`} aria-hidden="true" />}
            <span className="cityLevel" aria-hidden="true">{b.status === 'active' ? `L${b.level}` : <GameIcon name="clock" size={9} />}</span>
          </> : d ? d.type === 'park' || d.type === 'statue'
            ? <BuildingArt type={d.type} className="cityBuildingArt" />
            : <span className="cityDecorIcon"><GameIcon name={d.type} size={28} /></span>
            : (props.placementMode || props.decorPlacementMode || props.moveMode) ? <span className="cityPlus" aria-hidden="true" /> : null}
          {links.length > 0 && <span className="cellLinkMarkers" aria-hidden="true">{links.map((link) => <span key={link}><GameIcon name={link === 'ore' ? 'ore' : 'energy'} size={16} /></span>)}</span>}
        </button>,
      );
    }
  }

  return <div className={`cityMap cityArtMap ${props.placementMode || props.decorPlacementMode || props.moveMode ? 'isPlanning' : ''} ${props.compact ? 'compactMap' : ''} ${props.theme ?? ''} ${props.weather ?? ''}`}>
    <div className="cityMapGrid" style={{ gridTemplateColumns: `repeat(${props.gridSize}, minmax(0, 1fr))` }}>
      {cells}
    </div>
    {planningFoundry && <div className="cityLinkLegend"><strong>Выгодные клетки: <GameIcon name="ore" size={14} /> −15% руды · <GameIcon name="energy" size={14} /> −20% энергии.</strong> Работают соседи по стороне. После постройки выбери одну связь в производстве.</div>}
    {props.weather === 'weather_aurora' && <div className="auroraOverlay" aria-hidden="true" />}
    {props.buildingSkin && <div className={`cityMonument ${props.buildingSkin}`}>
      <BuildingArt type="statue" decorative={false} label="Декоративный объект" />
    </div>}
  </div>;
}
