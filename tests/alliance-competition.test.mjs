import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateAlliancePool, competitionWeek, competitionPrize, competitionCosmetics,
} from '../lib/game/alliance-competition.ts';

test('competition weeks use UTC Mondays across midnight, year boundaries and caller timezones', () => {
  const original = new Date('2026-01-04T23:59:59.999Z');
  assert.deepEqual(competitionWeek(original), {
    id: 'cw-2025-12-29', startsAt: '2025-12-29T00:00:00.000Z', endsAt: '2026-01-05T00:00:00.000Z',
  });
  assert.equal(original.toISOString(), '2026-01-04T23:59:59.999Z');
  assert.equal(competitionWeek(new Date('2026-01-05T03:00:00+03:00')).id, 'cw-2026-01-05');
  const start = competitionWeek(Date.parse('2026-01-05T00:00:00Z'));
  assert.equal(new Date(start.endsAt).getTime() - new Date(start.startsAt).getTime(), 7 * 86_400_000);
  assert.throws(() => competitionWeek(NaN), /дата/);
});

test('prize bands include their endpoints and never award an invalid or unplaced rank', () => {
  assert.deepEqual([1, 2, 3, 4, 10, 11, 50].map(rank => competitionPrize(rank)?.personal), [100, 75, 75, 50, 50, 20, 20]);
  assert.deepEqual([1, 2, 3, 4, 10, 11, 50].map(rank => competitionPrize(rank)?.alliancePool), [600, 400, 400, 250, 250, 100, 100]);
  for (const rank of [0, -1, 1.5, 51, NaN, Infinity]) {
    assert.equal(competitionPrize(rank), null);
    assert.deepEqual(competitionCosmetics('personal', rank), []);
    assert.deepEqual(competitionCosmetics('alliance', rank), []);
  }
});

test('team pool gives forty percent equally and sixty percent for recorded qualified contribution', () => {
  const result = allocateAlliancePool(600, [{ userId: 'a', points: 30 }, { userId: 'b', points: 70 }, { userId: 'idle', points: 10 }]);
  assert.deepEqual(result, [{ userId: 'a', points: 30, crystals: 228 }, { userId: 'b', points: 70, crystals: 372 }]);
  assert.equal(result.reduce((sum, member) => sum + member.crystals, 0), 600);
  assert.deepEqual(allocateAlliancePool(600, [{ userId: 'idle', points: 0 }, { userId: 'one-unit', points: 10 }]), []);
});

test('largest remainders preserve the exact pool and deterministic ties independently of membership order', () => {
  const members = [{ userId: 'c', points: 20 }, { userId: 'a', points: 20 }, { userId: 'b', points: 20 }];
  const values = rows => Object.fromEntries(rows.map(row => [row.userId, row.crystals]));
  assert.deepEqual(values(allocateAlliancePool(1, members)), { c: 0, a: 1, b: 0 });
  assert.deepEqual(values(allocateAlliancePool(1, [...members].reverse())), { b: 0, a: 1, c: 0 });
  for (let count = 1; count <= 30; count++) for (const pool of [0, 1, 7, 100, 250, 400, 600]) {
    const contributors = Array.from({ length: count }, (_, index) => ({ userId: String(index).padStart(2, '0'), points: (index + 2) * 10 }));
    const result = allocateAlliancePool(pool, contributors);
    assert.equal(result.reduce((sum, member) => sum + member.crystals, 0), pool, `${count} contributors / ${pool} crystals`);
    assert.ok(result.every(member => Number.isSafeInteger(member.crystals) && member.crystals >= 0));
    assert.deepEqual(values(result), values(allocateAlliancePool(pool, [...contributors].reverse())));
  }
});

test('pool validation rejects negative or fractional funds and duplicated identities', () => {
  for (const pool of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => allocateAlliancePool(pool, []), /фонд/);
  assert.throws(() => allocateAlliancePool(100, [{ userId: 'same', points: 20 }, { userId: 'same', points: 30 }]), /Повторный/);
  assert.deepEqual(allocateAlliancePool(100, [{ userId: 'bad', points: NaN }]), []);
});
