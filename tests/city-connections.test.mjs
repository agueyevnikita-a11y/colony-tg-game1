import assert from 'node:assert/strict';
import test from 'node:test';
import { createCityConnections, connectedCityDirections } from '../lib/game/city-connections.ts';

const directions = (value) => connectedCityDirections(value);

test('cardinal road-to-building approaches are reciprocal without connecting neighboring buildings', () => {
  const connections = createCityConnections([{ x: 2, y: 1 }, { x: 3, y: 1 }], [{ type: 'road', x: 2, y: 2 }], 6);
  assert.deepEqual(directions(connections.road(2, 2)), ['north']);
  assert.deepEqual(directions(connections.building(2, 1)), ['south']);
  assert.deepEqual(directions(connections.building(3, 1)), []);
  assert.deepEqual(directions(connections.road(1, 2)), []);
});

test('road junctions support every side, plazas and building endpoints while excluding other decor and diagonals', () => {
  const connections = createCityConnections([{ x: 3, y: 2 }, { x: 1, y: 1 }], [
    { type: 'road', x: 2, y: 2 }, { type: 'road', x: 2, y: 1 },
    { type: 'plaza', x: 2, y: 3 }, { type: 'road', x: 1, y: 2 },
    { type: 'tree', x: 0, y: 2 },
  ], 6);
  assert.deepEqual(directions(connections.road(2, 2)), ['north', 'east', 'south', 'west']);
  assert.deepEqual(directions(connections.road(2, 3)), ['north']);
  assert.deepEqual(directions(connections.road(1, 2)), ['north', 'east']);
  assert.deepEqual(directions(connections.building(3, 2)), ['west']);
});

test('map borders, malformed coordinates and overlapping invisible decor cannot create phantom connections', () => {
  const connections = createCityConnections([{ x: 0, y: 0 }, { x: 0, y: -1 }, { x: .5, y: 1 }], [
    { type: 'road', x: 0, y: 0 }, { type: 'road', x: 1, y: 0 },
    { type: 'road', x: 2, y: 0 }, { type: 'road', x: NaN, y: 0 },
    { type: 'road', x: -1, y: 0 },
  ], 2);
  assert.deepEqual(directions(connections.road(1, 0)), ['west']);
  assert.deepEqual(directions(connections.building(0, 0)), ['east']);
  assert.deepEqual(directions(connections.road(0, 0)), []);
  assert.deepEqual(directions(connections.road(2, 0)), []);
  for (const size of [0, -1, NaN, 2.5]) assert.deepEqual(directions(createCityConnections([{ x: 0, y: 0 }], [{ type: 'road', x: 1, y: 0 }], size).road(1, 0)), []);
});

test('moving or removing an object rebuilds only visual connections and leaves input state unchanged', () => {
  const buildings = [{ x: 1, y: 1 }], road = { type: 'road', x: 1, y: 2 };
  const before = structuredClone({ buildings, road });
  const original = createCityConnections(buildings, [road], 5);
  const moved = createCityConnections([{ x: 3, y: 1 }], [road], 5);
  const removed = createCityConnections(buildings, [], 5);
  assert.deepEqual(directions(original.road(1, 2)), ['north']);
  assert.deepEqual(directions(moved.road(1, 2)), []);
  assert.deepEqual(directions(removed.building(1, 1)), []);
  assert.deepEqual({ buildings, road }, before);
  const returned = original.road(1, 2); returned.east = true;
  assert.deepEqual(directions(original.road(1, 2)), ['north']);
});
