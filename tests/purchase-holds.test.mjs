import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePremiumHold, premiumHoldConfirmed } from '../lib/client/purchase-holds.ts';

const purchaseId = 'a114bcdf-940d-43b4-ae77-b357bf7c664f';
const otherId = 'fb2e97e3-ad07-4d1e-9098-de8698a6dc3a';

test('Premium holds parse storage and objects into one canonical UUID', () => {
  for (const raw of [{ purchaseId }, { purchaseId: purchaseId.toUpperCase() }, JSON.stringify({ purchaseId }), JSON.stringify({ purchaseId: purchaseId.toUpperCase() })]) {
    assert.deepEqual(parsePremiumHold(raw), { purchaseId });
  }
});

test('invalid, legacy or malformed Premium holds never become payment confirmations', () => {
  const malformed = [null, undefined, '', purchaseId, 'broken JSON', '{}', 'null', '[]', '42', 42, true, [], {},
    { purchaseId: 12 }, { purchaseId: '' }, { purchaseId: ` ${purchaseId}` }, { purchaseId: `${purchaseId}\n` }, { purchaseId: `${purchaseId}\r\n` },
    { purchaseId: '00000000-0000-0000-0000-000000000000' }, { purchaseId: 'a114bcdf-940d-03b4-ae77-b357bf7c664f' },
    { purchaseId: 'a114bcdf-940d-43b4-7e77-b357bf7c664f' }, { purchaseId: `${purchaseId}x` },
    { purchaseId, premium_until: '2099-01-01' }, { premium_until: '2099-01-01' }, Object.create({ purchaseId })];
  for (const raw of malformed) assert.equal(parsePremiumHold(raw), null, String(raw));
  assert.equal(parsePremiumHold({ get purchaseId() { throw new Error('Invalid storage'); } }), null);
});

test('a pending Premium renewal clears only for its exact paid receipt', () => {
  const hold = { purchaseId };
  for (const paidIds of [undefined, null, [], [otherId], ['premium_30d'], [true], [{ purchaseId }],
    { premium: true }, { premium_until: '2099-01-01', recovered: 1 }, { recovered: 100 }, { paidPremiumPurchaseIds: [purchaseId] }]) {
    assert.equal(premiumHoldConfirmed(hold, paidIds), false);
  }
  assert.equal(premiumHoldConfirmed(hold, [otherId, purchaseId]), true);
  assert.equal(premiumHoldConfirmed(parsePremiumHold(JSON.stringify({ purchaseId: purchaseId.toUpperCase() })), [purchaseId]), true);
  assert.equal(premiumHoldConfirmed(hold, [purchaseId.toUpperCase()]), false, 'The server contract supplies canonical UUIDs');
  assert.equal(premiumHoldConfirmed(null, [purchaseId]), false);
  assert.equal(premiumHoldConfirmed({ purchaseId: 'invalid' }, ['invalid']), false);
});
