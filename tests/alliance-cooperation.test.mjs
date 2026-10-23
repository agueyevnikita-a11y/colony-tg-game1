import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLIANCE_COOPERATION_TECH_COSTS, COOPERATION_ROLES,
  cooperationTeamBonus, cooperationModuleReward, cooperationFinalReward, parseAllianceCooperationRequest,
} from '../lib/game/alliance-cooperation.ts';

test('team mining needs different people and roles; bonus is capped without stacking', () => {
  assert.equal(cooperationTeamBonus(1, 3), 0);
  assert.equal(cooperationTeamBonus(3, 1), 0);
  assert.equal(cooperationTeamBonus(2, 2), 10);
  assert.equal(cooperationTeamBonus(2, 3), 10);
  assert.equal(cooperationTeamBonus(3, 2), 10);
  assert.equal(cooperationTeamBonus(3, 3), 20);
  assert.equal(cooperationTeamBonus(30, 3), 20);
});

test('operation technology snapshots affect module output only and keep the three fixed costs', () => {
  const before = structuredClone(COOPERATION_ROLES);
  assert.deepEqual(cooperationModuleReward('drilling', { drilling: 0, analysis: 0 }), { ore: 350, credits: 50, science: 5 });
  assert.deepEqual(cooperationModuleReward('drilling', { drilling: 1, analysis: 2 }), { ore: 367, credits: 50, science: 7 });
  assert.deepEqual(cooperationModuleReward('power', { drilling: 3, analysis: 3 }), { ore: 276, credits: 50, science: 8 });
  assert.deepEqual(cooperationModuleReward('analysis', { drilling: 3, analysis: 3 }), { ore: 276, credits: 120, science: 3 });
  assert.deepEqual(COOPERATION_ROLES, before);
  assert.deepEqual(ALLIANCE_COOPERATION_TECH_COSTS, [100, 200, 400]);
});

test('team ore reward rounds each snapshotted module without multiplying credits or science', () => {
  const module = cooperationModuleReward('drilling', { drilling: 1, analysis: 2 });
  assert.deepEqual(cooperationFinalReward(module, 10), { ore: 403, credits: 50, science: 7 });
  assert.deepEqual(module, { ore: 367, credits: 50, science: 7 });
  assert.deepEqual(cooperationFinalReward({ ore: 240, credits: 120, science: 0 }, 20), { ore: 288, credits: 120, science: 0 });
});

test('cooperation actions require an owned UUID receipt and research expected-level confirmation', () => {
  const requestId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', operationId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
  assert.deepEqual(parseAllianceCooperationRequest({ action: 'contribute', requestId, operationId, role: 'power' }), {
    action: 'contribute', requestId: requestId.toLowerCase(), operationId: operationId.toLowerCase(), role: 'power',
  });
  assert.deepEqual(parseAllianceCooperationRequest({ action: 'research', requestId, technologyId: 'analysis', expectedLevel: 2 }), {
    action: 'research', requestId: requestId.toLowerCase(), technologyId: 'analysis', expectedLevel: 2,
  });
  for (const body of [null, [], {}, { action: 'start', requestId: 'same' },
    { action: 'contribute', requestId, operationId, role: 'both' }, { action: 'claim', requestId, operationId: 'wrong' },
    ...[undefined, -1, .5, 3, '1', null].map(expectedLevel => ({ action: 'research', requestId, technologyId: 'drilling', expectedLevel }))]) {
    assert.throws(() => parseAllianceCooperationRequest(body));
  }
});
