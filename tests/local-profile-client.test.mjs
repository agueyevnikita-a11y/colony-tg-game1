import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts')) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { selectedLocalProfile, localProfileHeaders } = await import('../lib/client/local-profile.ts');

test('local profile URLs select only known test identities and reject ambiguous values', () => {
  assert.equal(selectedLocalProfile('').id, 10001);
  assert.equal(selectedLocalProfile('?local_profile=new').id, 11001);
  assert.equal(selectedLocalProfile('?local_profile=developed').id, 11002);
  for (const search of ['?local_profile=unknown', '?local_profile=1', '?local_profile=__proto__', '?local_profile=developed&local_profile=personal', '?local_profile=', '?other=developed']) {
    assert.equal(selectedLocalProfile(search).id, 10001);
  }
});

test('local identity changes are confined to unsigned sandbox headers without mutating callers', () => {
  const original = { 'content-type': 'application/json', 'x-dev-user-id': '10001' };
  const selected = localProfileHeaders(original, '?local_profile=developed', true);
  assert.equal(selected['x-dev-user-id'], '11002');
  assert.equal(original['x-dev-user-id'], '10001');
  assert.equal(localProfileHeaders(original, '?local_profile=developed', false), original);
  const signed = { 'x-telegram-init-data': 'signed-payload', 'content-type': 'application/json' };
  assert.equal(localProfileHeaders(signed, '?local_profile=developed', true), signed);
  assert.equal(Object.hasOwn(signed, 'x-dev-user-id'), false);
});
