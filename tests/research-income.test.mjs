import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { calculateResearchIncome, calculateResearchIncomeSegments } = await import('../lib/game/research-income.ts');
const { sciencePerHour } = await import('../lib/game/research.ts');
const { storageCaps } = await import('../lib/game/economy.ts');
const { accrueIncome } = await import('../lib/server/passive-income.ts');
const anchor = Date.UTC(2026, 0, 1);
const hour = (hours) => new Date(anchor + hours * 3_600_000);
const mine = { type: 'mine', level: 1, status: 'active' };
const lab = { type: 'research_lab', level: 1, status: 'active' };
const income = (options = {}) => calculateResearchIncome({ from: hour(0), to: hour(1), premium: false, buildings: [mine], research: [], ...options });
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${expected}, received ${actual}`);
const settleStoredResource = (resource, current, options, escrow = 0, carry = 0) => {
  let result = { amount: current, carry };
  const segments = calculateResearchIncomeSegments({ from: hour(0), to: hour(1), premium: false, buildings: [mine], research: [], ...options });
  for (const segment of segments) {
    const capacity = Math.max(0, Math.floor(storageCaps(segment.warehouseLevels)[resource] * segment.storageMultiplier) - escrow);
    result = accrueIncome({ current: result.amount, carry: result.carry, gain: segment[resource], capacity: Math.max(result.amount, capacity) });
  }
  return result;
};

test('extraction completed halfway through an offline hour only boosts the second half', () => {
  const gain = income({ research: [{ key: 'extraction_ai', completedAt: hour(0.5) }] });
  closeTo(gain.ore, 124.2);
  assert.notEqual(gain.ore, 128.4);
  closeTo(income({ research: [{ key: 'extraction_ai', completedAt: hour(-1) }] }).ore, 128.4);
});

test('science preserves the full 19.8 hourly rate and fractional income across frequent ticks', () => {
  closeTo(sciencePerHour([1], new Set(['basic_theory'])), 19.8);
  const research = [{ key: 'basic_theory', completedAt: hour(-1) }];
  closeTo(income({ buildings: [lab], research }).science, 19.8);
  let amount = 0;
  let carry = 0;
  for (let minute = 0; minute < 60; minute++) {
    const tick = income({ from: hour(minute / 60), to: hour((minute + 1) / 60), buildings: [lab], research });
    const result = accrueIncome({ current: amount, carry, gain: tick.science });
    amount = result.amount;
    carry = result.carry;
  }
  assert.equal(amount, 19);
  closeTo(carry, 0.8);
});

test('a newly completed lab earns no science before construction finishes', () => {
  const buildingLab = { ...lab, level: 0, status: 'building', target_level: 1, created_at: hour(-1), completes_at: hour(1 / 3) };
  const research = [{ key: 'basic_theory', completedAt: hour(0.5) }];
  // 20 minutes without a lab, 10 minutes at 18/h, 30 minutes at 19.8/h.
  closeTo(income({ buildings: [buildingLab], research }).science, 12.9);
  closeTo(income({ buildings: [{ ...buildingLab, completes_at: hour(2) }], research }).science, 0);
  closeTo(income({ buildings: [], research }).science, 0);
});

test('passive buildings activate at completion and upgrades resume at the target level', () => {
  closeTo(income({ buildings: [{ ...mine, level: 0, status: 'building', target_level: 1, completes_at: hour(0.5) }] }).ore, 60);
  closeTo(income({ buildings: [{ ...lab, status: 'upgrading', target_level: 2, completes_at: hour(0.5) }] }).science, 12);
  closeTo(income({ buildings: [{ ...mine, created_at: hour(0.5) }] }).ore, 60);
});

test('base and Premium offline caps bound all resource and science production', () => {
  const options = { to: hour(30), buildings: [mine, lab] };
  const base = income(options);
  closeTo(base.ore, 120 * 8);
  closeTo(base.science, 18 * 8);
  const premium = income({ ...options, premium: true });
  closeTo(premium.ore, 120 * 10 * 1.05);
  closeTo(premium.science, 18 * 10);
});

test('Archive extends the offline horizon only after completion and never restores an earlier gap', () => {
  const archive = (at) => ({ key: 'archive_network', completedAt: hour(at) });
  closeTo(income({ to: hour(20), research: [archive(-1)] }).ore, 120 * 10);
  closeTo(income({ to: hour(20), research: [archive(7)] }).ore, 120 * 10);
  // Eight base hours, one missed hour, then hour 9–10 inside the extended horizon.
  closeTo(income({ to: hour(20), research: [archive(9)] }).ore, 120 * 9);
  closeTo(income({ to: hour(20), research: [archive(11)] }).ore, 120 * 8);
  closeTo(income({ to: hour(20), premium: true, research: [archive(-1)] }).ore, 120 * 12 * 1.05);
});

test('future or invalid intervals pay nothing and a legacy completed research remains effective', () => {
  assert.deepEqual(income({ from: hour(2) }), { ore: 0, energy: 0, credits: 0, science: 0 });
  assert.deepEqual(income({ from: 'invalid' }), { ore: 0, energy: 0, credits: 0, science: 0 });
  closeTo(income({ research: [{ key: 'extraction_ai', completedAt: null }] }).ore, 128.4);
  closeTo(income({ research: [{ key: 'extraction_ai', completedAt: hour(2) }] }).ore, 120);
});

test('storage research cannot recover production lost before the capacity increase', () => {
  const options = { research: [{ key: 'compact_storage', completedAt: hour(0.5) }] };
  // 1999 + 60 saturates at 2000; only the next 60 fits after storage expands.
  assert.deepEqual(settleStoredResource('ore', 1999, options, 0, 0.9), { amount: 2060, carry: 0 });
  const energy = settleStoredResource('energy', 1199, { ...options, buildings: [{ type: 'solar', level: 1, status: 'active' }] });
  assert.equal(energy.amount, 1250);
});

test('warehouse completion expands capacity only for subsequent production, including escrow reservations', () => {
  const warehouse = { type: 'warehouse', level: 0, status: 'building', target_level: 1, completes_at: hour(0.5) };
  const options = { buildings: [mine, warehouse] };
  assert.equal(settleStoredResource('ore', 1999, options).amount, 2060);
  // Reserved stock occupies 100 units throughout both segments.
  assert.equal(settleStoredResource('ore', 1899, options, 100).amount, 1960);
});

test('upgrading a warehouse preserves existing stock and resumes income only when capacity returns', () => {
  const warehouse = { type: 'warehouse', level: 1, status: 'upgrading', target_level: 2, completes_at: hour(2) };
  assert.equal(settleStoredResource('ore', 3000, { buildings: [mine, warehouse] }).amount, 3000);
  warehouse.completes_at = hour(0.5);
  assert.equal(settleStoredResource('ore', 3000, { buildings: [mine, warehouse] }).amount, 3060);
});
