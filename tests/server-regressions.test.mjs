import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path) {
  const source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { accrueIncome } = await loadTypeScript('../lib/server/passive-income.ts');
const { validateTelegramInitData, getInitDataFromRequest } = await loadTypeScript('../lib/server/telegram-auth.ts');
const testToken = 'test-only-placeholder';

function signedData(overrides = {}) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 42, first_name: 'Test' }),
    ...overrides,
  });
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(testToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(data).digest('hex'));
  return params;
}

test('fractional income survives 120 refreshes every 30 seconds', () => {
  for (const rate of [18, 60, 100]) {
    let state = { amount: 0, carry: 0 };
    for (let tick = 0; tick < 120; tick++) {
      state = accrueIncome({ current: state.amount, gain: rate / 120, carry: state.carry });
    }
    assert.equal(state.amount, rate);
    assert.ok(state.carry < 1e-9);
  }
});

test('income capped at storage does not retain overflowing carry', () => {
  assert.deepEqual(accrueIncome({ current: 99, gain: 1.75, carry: 0.5, capacity: 100 }), { amount: 100, carry: 0 });
});

test('Telegram authentication rejects malformed and expired signed data', (t) => {
  const previous = process.env.BOT_TOKEN;
  process.env.BOT_TOKEN = testToken;
  t.after(() => { if (previous === undefined) delete process.env.BOT_TOKEN; else process.env.BOT_TOKEN = previous; });
  assert.equal(validateTelegramInitData(signedData().toString()).user.id, 42);
  const tampered = signedData();
  tampered.set('user', JSON.stringify({ id: 43, first_name: 'Test' }));
  assert.throws(() => validateTelegramInitData(tampered.toString()), /signature/);
  const malformedHash = signedData();
  malformedHash.set('hash', `${malformedHash.get('hash')}garbage`);
  assert.throws(() => validateTelegramInitData(malformedHash.toString()), /signature/);
  const duplicate = signedData();
  duplicate.append('user', duplicate.get('user'));
  assert.throws(() => validateTelegramInitData(duplicate.toString()), /Duplicate/);
  assert.throws(() => validateTelegramInitData(signedData({ auth_date: String(Math.floor(Date.now() / 1000) - 3601) }).toString()), /expired/);
  assert.throws(() => validateTelegramInitData(signedData({ auth_date: String(Math.floor(Date.now() / 1000) + 60) }).toString()), /expired/);
  assert.throws(() => validateTelegramInitData(signedData({ user: JSON.stringify({ id: -1, first_name: 'Test' }) }).toString()), /Invalid Telegram user/);
});

test('development authentication cannot bypass production authentication', (t) => {
  const previous = { NODE_ENV: process.env.NODE_ENV, ALLOW_DEV_AUTH: process.env.ALLOW_DEV_AUTH };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.ALLOW_DEV_AUTH = 'true';
  process.env.NODE_ENV = 'production';
  assert.throws(() => getInitDataFromRequest(new Request('https://example.test')), /Unauthorized/);
  process.env.NODE_ENV = 'development';
  assert.equal(getInitDataFromRequest(new Request('https://example.test')).user.id, 10001);
  assert.throws(() => getInitDataFromRequest(new Request('https://example.test', { headers: { 'x-dev-user-id': '-1' } })), /Invalid development user ID/);
});
