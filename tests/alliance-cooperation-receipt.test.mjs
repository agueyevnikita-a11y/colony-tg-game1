import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';
registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { validCooperationReceipt } = await import('../lib/game/alliance-cooperation-receipt.ts');
const { COOPERATION_ROLES, ALLIANCE_COOPERATION_MAX_UNITS, ALLIANCE_COOPERATION_TECH_COSTS } = await import('../lib/game/alliance-cooperation.ts');

const operationId = '11111111-1111-4111-a111-111111111111';
const contributionId = '22222222-2222-4222-a222-222222222222';
const reward = { ore: 350, credits: 50, science: 5 };
const claim = patch => ({ operationId, count: 1, reward: { ...reward }, ...patch });
const contribution = patch => ({ operationId, contributionId, role: 'drilling', cost: { energy: 100, parts: 10 }, reward: { ...reward }, competition: { points: 10, eligible: true }, ...patch });

test('mining claims require the submitted operation and actual complete resource receipt', () => {
  assert.equal(validCooperationReceipt(claim(), { action: 'claim', operationId }), true);
  assert.equal(validCooperationReceipt(claim(), { action: 'claim', operationId: operationId.toUpperCase() }), true);
  for (const value of [undefined, null, [], {}, claim({ reward: undefined }), claim({ count: 0 }), claim({ count: 1.5 }), claim({ operationId: contributionId }), claim({ reward: { ore: 350, credits: 50 } }), claim({ reward: { ...reward, crystals: 2 } })]) {
    assert.equal(validCooperationReceipt(value, { action: 'claim', operationId }), false);
  }
});

test('unconfirmed previews and malformed resource values cannot become received personal cargo', () => {
  for (const value of ['350', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validCooperationReceipt(claim({ reward: { ...reward, ore: value } }), { action: 'claim', operationId }), false);
  }
  assert.equal(validCooperationReceipt(claim({ reward: { ore: 0, credits: 0, science: 0 } }), { action: 'claim', operationId }), false);
  assert.equal(validCooperationReceipt(claim({ reward: { ore: 0, credits: 50, science: 5 } }), { action: 'claim', operationId }), false);
  assert.equal(validCooperationReceipt(claim({ count: ALLIANCE_COOPERATION_MAX_UNITS + 1 }), { action: 'claim', operationId }), false);
  assert.equal(validCooperationReceipt(claim({ count: 3, reward: { ore: 1260, credits: 150, science: 15 } }), { action: 'claim', operationId }), true,
    'A larger final team bonus is confirmed by the receipt, never compared with an old preliminary share');
});

test('paid shift receipts match the operation and role and separate personal cost from reward', () => {
  const intent = { action: 'contribute', operationId, role: 'drilling' };
  assert.equal(validCooperationReceipt(contribution(), intent), true);
  assert.equal(validCooperationReceipt(contribution({ competition: { points: 0, eligible: false } }), intent), true);
  assert.equal(validCooperationReceipt(contribution({ competition: { points: 0, eligible: true } }), intent), true);
  assert.equal(validCooperationReceipt(contribution({ competition: undefined }), intent), true);
  for (const patch of [{ operationId: contributionId }, { role: 'power' }, { contributionId: 'unknown' }, { cost: null }, { cost: {} }, { cost: { energy: -1 } }, { cost: { energy: 100 } }, { cost: { energy: 100, parts: 11 } }, { cost: { sharedScience: 2 } }, { reward: {} }, { reward: { ore: 0, credits: 0, science: 0 } }, { competition: { points: '10', eligible: true } }, { competition: { points: 100, eligible: true } }, { competition: { points: 100, eligible: false } }, { competition: { points: 10, eligible: false } }, { competition: { points: 10 } }]) {
    assert.equal(validCooperationReceipt(contribution(patch), intent), false);
  }
});

test('all three roles require their exact canonical personal-resource cost', () => {
  for (const role of COOPERATION_ROLES) {
    const intent = { action: 'contribute', operationId, role: role.id };
    const result = contribution({ role: role.id, cost: role.cost, reward: role.reward });
    assert.equal(validCooperationReceipt(result, intent), true, role.id);
    assert.equal(validCooperationReceipt({ ...result, cost: {} }, intent), false);
    assert.equal(validCooperationReceipt({ ...result, cost: { ...role.cost, credits: 1 } }, intent), false);
  }
});

test('a successful free start distinguishes new operation from an already running one', () => {
  for (const started of [true, false]) assert.equal(validCooperationReceipt({ operationId, started, endsAt: '2026-10-24T18:00:00.000Z' }, { action: 'start' }), true);
  for (const patch of [{ operationId: 'old' }, { started: 1 }, { endsAt: 'unknown' }, { endsAt: null }]) {
    assert.equal(validCooperationReceipt({ operationId, started: true, endsAt: '2026-10-24T18:00:00.000Z', ...patch }, { action: 'start' }), false);
  }
});

test('technology confirmation matches exact expected level and common-science result', () => {
  const result = { technologyId: 'analysis', level: 2, cost: 200, sharedScience: 10 };
  const intent = { action: 'research', technologyId: 'analysis', expectedLevel: 1 };
  assert.equal(validCooperationReceipt(result, intent), true);
  for (const patch of [{ technologyId: 'drilling' }, { level: 1 }, { level: 3 }, { cost: 0 }, { cost: 100 }, { cost: 201 }, { cost: '200' }, { sharedScience: -1 }, { sharedScience: undefined }]) {
    assert.equal(validCooperationReceipt({ ...result, ...patch }, intent), false);
  }
  assert.equal(validCooperationReceipt(result, { ...intent, expectedLevel: '1' }), false);
  assert.equal(validCooperationReceipt(result, { ...intent, technologyId: 'unknown' }), false);
  assert.equal(validCooperationReceipt({ ...result, level: 4, cost: 800 }, { ...intent, expectedLevel: 3 }), false);
  ALLIANCE_COOPERATION_TECH_COSTS.forEach((cost, expectedLevel) => {
    assert.equal(validCooperationReceipt({ ...result, cost, level: expectedLevel + 1 }, { ...intent, expectedLevel }), true);
  });
});

test('receipt inspection does not mutate the saved request or confirmed server values', () => {
  const result = contribution(), intent = { action: 'contribute', operationId, role: 'drilling' };
  const before = structuredClone({ result, intent });
  assert.equal(validCooperationReceipt(result, intent), true);
  assert.deepEqual({ result, intent }, before);
  assert.equal(validCooperationReceipt(result, { ...intent, action: 'unknown' }), false);
});
