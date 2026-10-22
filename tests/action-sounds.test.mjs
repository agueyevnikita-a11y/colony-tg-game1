import assert from 'node:assert/strict';
import test from 'node:test';
import { actionSound } from '../lib/client/action-sounds.ts';

test('only confirmed foreground game mutations receive an action sound', () => {
  assert.equal(actionSound('/api/game/build'), 'build');
  assert.equal(actionSound('/api/game/building/upgrade'), 'build');
  for (const path of ['/api/game/decor/place', '/api/game/research/start', '/api/game/foundry/start', '/api/game/contracts/complete', '/api/season/claim', '/api/shop/equip']) {
    assert.equal(actionSound(path), 'success');
    assert.equal(actionSound(path, true), null);
  }
  assert.equal(actionSound('/api/game/build', true), null);
});

test('polling, reads, invoice creation and payment recovery never sound like a successful purchase', () => {
  for (const path of ['/api/session', '/api/social/city', '/api/inbox/list', '/api/inbox/read', '/api/payments/invoice', '/api/payments/recover', '/api/admin/dashboard', '/api/local/profiles', '/api/game/unknown', '/api/game/build?retry=1', '']) {
    assert.equal(actionSound(path), null, path);
  }
});
