import assert from 'node:assert/strict';
import test from 'node:test';
import { cosmeticInventory } from '../lib/game/cosmetic-inventory.ts';

const now = Date.parse('2030-01-01T00:00:00Z');
const short = '2030-01-02T00:00:00Z', long = '2030-02-01T00:00:00Z';
const row = (extra = {}) => ({ cosmetic_id: 'theme_neon', name: 'Неоновый город', category: 'theme', acquired_at: '2029-12-01T00:00:00Z', expires_at: null, equipped: false, ...extra });

test('permanent access does not hide the shorter expiry of the applied temporary copy', () => {
  const permanent = row(), temporary = row({ expires_at: short, equipped: true, acquired_at: '2029-12-02T00:00:00Z' });
  for (const copies of [[permanent, temporary], [temporary, permanent]]) {
    const [item] = cosmeticInventory(copies, [], now);
    assert.equal(item.expiresAt, null);
    assert.equal(item.equipped, true);
    assert.equal(item.appliedExpiresAt, short);
    assert.equal(item.needsLongerApplication, true);
  }
});

test('a permanent applied copy already covers every temporary right', () => {
  const [item] = cosmeticInventory([row({ equipped: true }), row({ expires_at: long })], [], now);
  assert.equal(item.equipped, true);
  assert.equal(item.appliedExpiresAt, null);
  assert.equal(item.needsLongerApplication, false);
});

test('the longest temporary access stays separate from a shorter applied copy in any row order', () => {
  const early = row({ expires_at: long }), recent = row({ expires_at: short, equipped: true, acquired_at: '2029-12-03T00:00:00Z' });
  for (const copies of [[early, recent], [recent, early]]) {
    const [item] = cosmeticInventory(copies, [], now);
    assert.equal(item.expiresAt, long);
    assert.equal(item.appliedExpiresAt, short);
    assert.equal(item.needsLongerApplication, true);
  }
});

test('equal access durations need no reapplication even if another copy is newer', () => {
  for (const expires_at of [null, long]) {
    const [item] = cosmeticInventory([row({ expires_at, equipped: true }), row({ expires_at, acquired_at: '2029-12-04T00:00:00Z' })], [], now);
    assert.equal(item.needsLongerApplication, false);
    assert.equal(item.appliedExpiresAt, expires_at);
  }
});

test('expired applied access never makes an unselected permanent copy appear applied', () => {
  const [item] = cosmeticInventory([row(), row({ equipped: true, expires_at: new Date(now).toISOString() })], [], now);
  assert.equal(item.expiresAt, null);
  assert.equal(item.equipped, false);
  assert.equal(item.appliedExpiresAt, undefined);
  assert.equal(item.needsLongerApplication, false);
});

test('unapplied access remains unapplied and missing or invalid ownership never creates an item', () => {
  const [item] = cosmeticInventory([row({ expires_at: long })], [], now);
  assert.equal(item.equipped, false);
  assert.equal(item.appliedExpiresAt, undefined);
  assert.equal(item.needsLongerApplication, false);
  assert.deepEqual(cosmeticInventory([{ cosmetic_id: '', expires_at: null }, row({ expires_at: 'invalid' }), row({ expires_at: '2029-12-31T00:00:00Z' })], [], now), []);
  assert.deepEqual(cosmeticInventory([row()], [], NaN), []);
});

test('metadata falls back to the canonical catalog and output is stable without mutating inputs', () => {
  const rows = Object.freeze([Object.freeze({ cosmetic_id: 'frame_orbit', expires_at: null }), Object.freeze({ id: 'theme_neon', expires_at: new Date(long) })]);
  const catalog = Object.freeze([{ id: 'frame_orbit', name: 'Орбитальная рамка', category: 'frame' }, { id: 'theme_neon', name: 'Неоновый город', category: 'theme' }]);
  const before = JSON.stringify(rows);
  const result = cosmeticInventory(rows, catalog, now);
  assert.deepEqual(result.map(item => item.id), ['frame_orbit', 'theme_neon']);
  assert.deepEqual(result.map(item => item.name), ['Орбитальная рамка', 'Неоновый город']);
  assert.equal(result[1].expiresAt, new Date(long).toISOString());
  assert.deepEqual(cosmeticInventory([...rows].reverse(), catalog, now), result);
  assert.equal(JSON.stringify(rows), before);
});

test('the newest acquisition supplies metadata only after the ownership durations match', () => {
  const [item] = cosmeticInventory([row({ name: 'Раннее название', expires_at: long }), row({ name: 'Текущее название', expires_at: long, acquired_at: '2029-12-05T00:00:00Z' })], [], now);
  assert.equal(item.name, 'Текущее название');
});
