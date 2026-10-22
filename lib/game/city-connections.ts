export type CityDirection = 'north' | 'east' | 'south' | 'west';
export type RoadConnections = Partial<Record<CityDirection, boolean>>;
type Cell = { x: number; y: number };
type DecorCell = Cell & { type: string };

export const CITY_DIRECTIONS = [
  { key: 'north', dx: 0, dy: -1, rotation: 0 },
  { key: 'east', dx: 1, dy: 0, rotation: 90 },
  { key: 'south', dx: 0, dy: 1, rotation: 180 },
  { key: 'west', dx: -1, dy: 0, rotation: 270 },
] as const;

const key = (x: number, y: number) => `${x}:${y}`;
const empty = (): RoadConnections => ({ north: false, east: false, south: false, west: false });

/** A visual index only: roads never affect production, cost or comfort rules. */
export function createCityConnections(buildings: readonly Cell[], decor: readonly DecorCell[], gridSize: number) {
  const valid = (x: number, y: number) => Number.isInteger(gridSize) && gridSize > 0
    && Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < gridSize && y < gridSize;
  const buildingCells = new Set(buildings.filter(cell => valid(cell.x, cell.y)).map(cell => key(cell.x, cell.y)));
  // Match CityGrid's building-first occupancy if malformed overlapping rows occur.
  const roadCells = new Set(decor.filter(cell => valid(cell.x, cell.y)
    && (cell.type === 'road' || cell.type === 'plaza') && !buildingCells.has(key(cell.x, cell.y))).map(cell => key(cell.x, cell.y)));
  function neighbors(x: number, y: number, includeBuildings: boolean) {
    const result = empty();
    if (!valid(x, y)) return result;
    for (const direction of CITY_DIRECTIONS) {
      const nx = x + direction.dx, ny = y + direction.dy;
      result[direction.key] = valid(nx, ny) && (roadCells.has(key(nx, ny)) || includeBuildings && buildingCells.has(key(nx, ny)));
    }
    return result;
  }
  return {
    road: (x: number, y: number) => roadCells.has(key(x, y)) ? neighbors(x, y, true) : empty(),
    building: (x: number, y: number) => buildingCells.has(key(x, y)) ? neighbors(x, y, false) : empty(),
  };
}

export function connectedCityDirections(connections: RoadConnections) {
  return CITY_DIRECTIONS.filter(direction => connections[direction.key]).map(direction => direction.key);
}
