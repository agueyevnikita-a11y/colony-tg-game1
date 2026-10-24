import assert from 'node:assert/strict';
import test from 'node:test';
import { premiumDisplayStatus, recoveryReceiptMessage } from '../lib/game/shop-status.ts';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const future = '2030-02-01T12:00:00.000Z';
const past = '2030-01-01T11:59:59.999Z';

test('a future subscription date cannot activate Premium against the server flag', () => {
  for (const deadline of [future, past, new Date(now).toISOString(), null, undefined, 'invalid']) {
    assert.deepEqual(premiumDisplayStatus(false, deadline, now), { active: false, expiredNeedsRefresh: false, expiresAt: null });
  }
});

test('a known Premium deadline expires at the exact boundary and requires a refreshed snapshot', () => {
  assert.deepEqual(premiumDisplayStatus(true, future, now), { active: true, expiredNeedsRefresh: false, expiresAt: future });
  for (const deadline of [past, new Date(now).toISOString()]) {
    assert.deepEqual(premiumDisplayStatus(true, deadline, now), { active: false, expiredNeedsRefresh: true, expiresAt: deadline });
  }
  assert.deepEqual(premiumDisplayStatus(true, future, Date.parse(future) - 1), { active: true, expiredNeedsRefresh: false, expiresAt: future });
  assert.deepEqual(premiumDisplayStatus(true, future, Date.parse(future)), { active: false, expiredNeedsRefresh: true, expiresAt: future });
});

test('missing or malformed expiry preserves server-confirmed Premium without inventing a deadline', () => {
  for (const deadline of [undefined, null, '', 'invalid', 0, now, {}, [], new Date(future)]) {
    assert.deepEqual(premiumDisplayStatus(true, deadline, now), { active: true, expiredNeedsRefresh: false, expiresAt: null });
  }
  assert.deepEqual(premiumDisplayStatus(true, future, NaN), { active: true, expiredNeedsRefresh: false, expiresAt: future }, 'An invalid client clock does not override server authority');
});

test('a zero recovery count does not claim a grant or clear an awaiting payment', () => {
  const receipt = Object.freeze({ ok: true, recovered: 0, scanned: 0, stateUpdated: true, message: 'Все покупки активированы' });
  const text = recoveryReceiptMessage(receipt);
  assert.match(text, /Новых подтверждённых покупок не найдено/);
  assert.match(text, /Ожидающая оплата может ещё обрабатываться/);
  assert.doesNotMatch(text, /Восстановлено|Все покупки активированы|уже получен/);
  assert.equal(receipt.recovered, 0);
});

test('confirmed recoveries show their own count independently of raw API messages', () => {
  for (const recovered of [1, 2, 50]) {
    const text = recoveryReceiptMessage({ recovered, scanned: 300, stateUpdated: true, message: 'unsafe <script> raw text' });
    assert.match(text, new RegExp(`Восстановлено покупок: ${recovered}\\.`));
    assert.match(text, /Данные колонии обновлены/);
    assert.doesNotMatch(text, /unsafe|script|raw text|применено|Premium активен/);
  }
});

test('a failed session refresh preserves the recovery result and explicitly asks to update the view', () => {
  for (const recovered of [0, 2]) {
    const text = recoveryReceiptMessage({ ok: true, recovered, scanned: 100, stateUpdated: false });
    assert.match(text, recovered ? /Восстановлено покупок: 2/ : /Новых подтверждённых покупок не найдено/);
    assert.match(text, /Данные колонии пока не обновлены/);
    assert.match(text, /Обнови данные, чтобы проверить покупки/);
    assert.doesNotMatch(text, /Данные колонии обновлены/);
  }
});

test('unknown receipts and noncanonical counts stay neutral instead of inventing payment success', () => {
  for (const receipt of [undefined, null, [], {}, 'paid', 3, { recovered: 1 }, { recovered: 1, stateUpdated: 'true' },
    ...[-1, 1.5, 51, Infinity, NaN, '2', null, undefined].map(recovered => ({ recovered, scanned: 10, stateUpdated: true })),
    ...[-1, 1.5, 301, Infinity, NaN, '10', null, undefined].map(scanned => ({ recovered: 1, scanned, stateUpdated: true })),
    { recovered: 1, scanned: 10, stateUpdated: true, ok: false },
    Object.create({ recovered: 2, stateUpdated: true }),
  ]) assert.equal(recoveryReceiptMessage(receipt), 'Проверка завершена.');
});

test('an unrecognized receipt can still disclose a known failed state refresh without claiming a grant', () => {
  const receipt = Object.freeze({ recovered: '1', stateUpdated: false, message: 'Активировано' });
  const text = recoveryReceiptMessage(receipt);
  assert.match(text, /^Проверка завершена\./);
  assert.match(text, /Данные колонии пока не обновлены/);
  assert.doesNotMatch(text, /Восстановлено|Активировано/);
  assert.equal(receipt.recovered, '1');
});
