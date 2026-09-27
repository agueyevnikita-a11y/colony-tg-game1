import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

// Node strips TypeScript syntax; resolve the extensionless imports used by Next.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { calculatePassiveGain } = await import('../lib/game/economy.ts');
const { validateMarketOrder } = await import('../lib/game/market.ts');
const { allianceCode } = await import('../lib/game/alliance.ts');

test('30-second ticks retain production below one resource unit', () => {
  const gain = calculatePassiveGain({
    buildings: [
      { type: 'habitat', level: 1, status: 'active' },
      { type: 'solar', level: 1, status: 'active' },
    ],
    hoursElapsed: 30 / 3600,
    premium: false,
  });
  assert.equal(gain.credits, 0.5);
  assert.ok(Math.abs(gain.energy - 5 / 6) < 1e-12);
});

test('frequent ticks produce the same total as a single hourly tick', () => {
  const params = {
    buildings: [
      { type: 'mine', level: 1, status: 'active' },
      { type: 'solar', level: 1, status: 'active' },
      { type: 'habitat', level: 1, status: 'active' },
      { type: 'habitat', level: 1, status: 'active' },
      { type: 'mine', level: 20, status: 'building' },
    ],
    premium: true,
    resourceMultipliers: { ore: 1.07, energy: 1.07 },
  };
  const smallTick = calculatePassiveGain({ ...params, hoursElapsed: 30 / 3600 });
  const hourly = calculatePassiveGain({ ...params, hoursElapsed: 1 });
  for (const resource of ['ore', 'energy', 'credits']) {
    assert.ok(Math.abs(smallTick[resource] * 120 - hourly[resource]) < 1e-10);
  }
});

test('offline production respects the free and premium research caps', () => {
  const params = { buildings: [{ type: 'mine', level: 1, status: 'active' }], hoursElapsed: 24 };
  assert.equal(calculatePassiveGain({ ...params, premium: false }).ore, 120 * 8);
  assert.equal(calculatePassiveGain({ ...params, premium: true, offlineCapBonusHours: 2 }).ore, 120 * 12 * 1.05);
  assert.equal(calculatePassiveGain({ ...params, premium: false, hoursElapsed: -1 }).ore, 0);
});

test('market accepts supported resources and rejects inherited object keys', () => {
  for (const resource of ['ore', 'energy', 'parts']) {
    assert.doesNotThrow(() => validateMarketOrder(resource, 50, 5));
  }
  for (const resource of ['__proto__', 'constructor', 'toString', 'credits']) {
    assert.throws(() => validateMarketOrder(resource, 50, 5), /нельзя продавать/);
  }
  assert.throws(() => validateMarketOrder('ore', 0, 5));
  assert.throws(() => validateMarketOrder('ore', 50, Infinity));
});

test('alliance codes are safe Telegram start parameters for non-Latin names', () => {
  const salt = '12345678-1234-1234-1234-123456789abc';
  for (const name of ['Новый Байконур', '東京', 'Alpha Base', 'Étoile']) {
    const code = allianceCode(name, salt);
    assert.match(code, /^[A-Z0-9]{1,8}$/);
    assert.ok(code.endsWith('89ABC'));
  }
});
