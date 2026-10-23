import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { researchRouteOutcome } = await import('../lib/game/research-outcome.ts');
const { EXPEDITIONS } = await import('../lib/game/expeditions.ts');
const { RESEARCH_TREE } = await import('../lib/game/research.ts');

test('route discoveries explain their actual HQ and separate access/building requirements', () => {
  const orbital = researchRouteOutcome('deep_navigation');
  assert.equal(orbital.routeKey, 'orbital_ruins');
  assert.equal(orbital.requiredHq, 3);
  const deep = researchRouteOutcome('deep_space_protocol');
  assert.equal(deep.routeKey, 'deep_signal');
  assert.equal(deep.requiredHq, 5);
  for (const outcome of [orbital, deep]) {
    assert.match(outcome.requirementsText, /работающий центр экспедиций/);
    assert.match(outcome.requirementsText, /Если экспедиции ещё закрыты.*Экспедиционные протоколы/);
    assert.doesNotMatch(outcome.requirementsText, /уже действует|можно отправлять|запущен/);
  }
});

test('passive bonuses, recipe unlocks and unknown keys do not become expedition routes', () => {
  for (const key of ['basic_theory', 'extraction_ai', 'precision_casting', 'expedition_protocols', 'autonomous_drones', 'unknown', 'constructor', '__proto__']) {
    assert.equal(researchRouteOutcome(key), null);
  }
});

test('showing completed research outcomes does not change route rules or research prerequisites', () => {
  const before = structuredClone({ routes: EXPEDITIONS, research: RESEARCH_TREE });
  for (const item of RESEARCH_TREE) researchRouteOutcome(item.key);
  assert.deepEqual({ routes: EXPEDITIONS, research: RESEARCH_TREE }, before);
});
