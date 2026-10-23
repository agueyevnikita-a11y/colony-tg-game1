import { availableFoundryLinks, quoteFoundry, type FoundryBuilding, type FoundryMode, type FoundryRecipeKey } from './foundry';

export type ProductionResource = 'ore' | 'energy';
type Cell = { x: number; y: number };
export type ProductionEdge = {
  foundryId: string;
  supplierId: string;
  resource: ProductionResource;
  from: Cell;
  to: Cell;
};
export type FoundryLinksPreview = {
  base: { ore: number; energy: number };
  options: { link: ProductionResource; resource: ProductionResource; before: number; after: number; saving: number; supplierIds: string[] }[];
};
type QuoteOptions = { recipe?: FoundryRecipeKey; mode?: FoundryMode; partsMultiplier?: number };
const supplierResource = (type: string): ProductionResource | null => type === 'mine' || type === 'deep_mine' ? 'ore'
  : type === 'solar' || type === 'solar_array' ? 'energy' : null;

function suppliers(foundry: FoundryBuilding, buildings: readonly FoundryBuilding[]) {
  return buildings.filter(other => other.id !== foundry.id && other.status === 'active' && supplierResource(other.type)
    && Math.abs(other.x - foundry.x) + Math.abs(other.y - foundry.y) === 1);
}

/** One-cycle alternatives, never combined. Values come from the actual paid-order quote. */
export function foundryLinksPreview(foundry: FoundryBuilding, buildings: readonly FoundryBuilding[], options: QuoteOptions = {}): FoundryLinksPreview | null {
  if (foundry.type !== 'foundry' || foundry.status !== 'active' || !Number.isInteger(foundry.level) || foundry.level < 1 || foundry.level > 15) return null;
  const parameters = { level: foundry.level, recipe: options.recipe ?? 'standard_alloy', mode: options.mode ?? 'standard', cycles: 1, partsMultiplier: options.partsMultiplier ?? 1 };
  const base = quoteFoundry({ ...parameters, link: 'none' });
  const neighbors = suppliers(foundry, buildings);
  const links = availableFoundryLinks(foundry, [...buildings]).filter((link): link is ProductionResource => link !== 'none');
  return { base: { ore: base.ore, energy: base.energy }, options: links.map(link => {
    const quote = quoteFoundry({ ...parameters, link });
    return { link, resource: link, before: base[link], after: quote[link], saving: base[link] - quote[link],
      supplierIds: neighbors.filter(other => supplierResource(other.type) === link).map(other => other.id) };
  }) };
}

/** Availability overlay only. Roads and existing paid orders never participate. */
export function createProductionNetwork(buildings: readonly FoundryBuilding[], decor: readonly Cell[], gridSize: number) {
  const valid = (x: number, y: number) => Number.isInteger(gridSize) && gridSize > 0 && Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && y >= 0 && x < gridSize && y < gridSize;
  // Match CityGrid's last-building-wins occupancy for an overlapping malformed snapshot.
  const byCell = new Map(buildings.filter(building => valid(building.x, building.y)).map(building => [`${building.x}:${building.y}`, building]));
  const visible = [...byCell.values()];
  const decorCells = new Set(decor.filter(cell => valid(cell.x, cell.y)).map(cell => `${cell.x}:${cell.y}`));
  function edgesFor(foundry: FoundryBuilding, rows: readonly FoundryBuilding[]): ProductionEdge[] {
    if (foundry.type !== 'foundry' || foundry.status !== 'active') return [];
    const links = availableFoundryLinks(foundry, [...rows]);
    return suppliers(foundry, rows).flatMap(other => {
      const resource = supplierResource(other.type);
      return resource && links.includes(resource) ? [{ foundryId: foundry.id, supplierId: other.id, resource,
        from: { x: other.x, y: other.y }, to: { x: foundry.x, y: foundry.y } }] : [];
    });
  }
  const edges = visible.flatMap(foundry => edgesFor(foundry, visible));
  return {
    edges,
    placement(x: number, y: number, movingFoundryId?: string) {
      const moving = movingFoundryId ? visible.find(building => building.id === movingFoundryId) : undefined;
      if (!valid(x, y) || byCell.has(`${x}:${y}`) || decorCells.has(`${x}:${y}`)
        || (movingFoundryId && (!moving || moving.type !== 'foundry' || moving.status !== 'active'))) {
        return { available: false, foundry: null, links: [] as ProductionResource[], edges: [] as ProductionEdge[] };
      }
      const foundry: FoundryBuilding = { id: moving?.id ?? 'placement-preview', type: 'foundry', status: 'active', level: moving?.level ?? 1, x, y };
      const rows = visible.filter(building => building.id !== foundry.id);
      const candidateEdges = edgesFor(foundry, rows);
      return { available: true, foundry, links: [...new Set(candidateEdges.map(edge => edge.resource))], edges: candidateEdges };
    },
  };
}
