'use client';

import { availableFoundryLinks } from '@/lib/game/foundry';
import '@/app/production.css';

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
      const links = planningFoundry && !occupied ? availableFoundryLinks({
        id: props.movingBuildingId ?? 'placement-preview', type: 'foundry', status: 'active',
        level: 1, x, y,
      }, props.buildings).filter((link) => link !== 'none') : [];
      const linkDescription = links.map((link) => link === 'ore' ? 'связь с шахтой: расход руды меньше на 15%' : 'связь с электростанцией: расход энергии меньше на 20%').join('; ');
      cells.push(
        <button
          type="button"
          key={`${x}:${y}`}
          className={`cityCell ${b ? 'occupied' : d ? 'decorCell' : 'empty'} ${b?.id === props.selectedId || d?.id === props.selectedDecorId ? 'selected' : ''} ${b?.status !== 'active' && b ? 'busyCell' : ''} ${links.length ? 'linkPreview' : ''}`}
          onClick={() => props.onCell?.(x, y, b, d)}
          disabled={!props.onCell}
          aria-label={b ? `${cfg?.name ?? b.type}, уровень ${b.level}` : d ? `${decorCfg?.name ?? d.type}` : `Пустая клетка ${x + 1}, ${y + 1}${linkDescription ? `; ${linkDescription}` : ''}`}
          title={linkDescription || undefined}
        >
          {b ? <>
            <span className="cityEmoji">{cfg?.emoji ?? '🏗️'}</span>
            <span className="cityLevel">{b.status === 'active' ? `L${b.level}` : '…'}</span>
          </> : d ? <span className="decorEmoji">{decorCfg?.emoji ?? '✨'}</span> : (props.placementMode || props.decorPlacementMode || props.moveMode) ? <span className="cityPlus">+</span> : null}
          {links.length > 0 && <span className="cellLinkMarkers" aria-hidden="true">{links.map((link) => <span key={link}>{link === 'ore' ? '⛏' : '⚡'}</span>)}</span>}
        </button>,
      );
    }
  }

  return <div className={`cityMap ${props.compact ? 'compactMap' : ''} ${props.theme ?? ''} ${props.weather ?? ''}`}>
    <div className="cityMapGrid" style={{ gridTemplateColumns: `repeat(${props.gridSize}, minmax(0, 1fr))` }}>
      {cells}
    </div>
    {planningFoundry && <div className="cityLinkLegend"><strong>Выгодные клетки: ⛏ −15% руды · ⚡ −20% энергии.</strong> Работают соседи по стороне. После постройки выбери одну связь в производстве.</div>}
    {props.weather === 'weather_aurora' && <div className="auroraOverlay" aria-hidden="true" />}
    {props.buildingSkin && <div className={`cityMonument ${props.buildingSkin}`} aria-label="Декоративный объект">
      {props.buildingSkin === 'monument_alliance_relay' ? '🗼' : props.buildingSkin === 'founder_monument' ? '🏛️' : props.buildingSkin === 'monument_network' ? '🗽' : props.buildingSkin === 'relay_legend' ? '📡' : '🏆'}
    </div>}
  </div>;
}
