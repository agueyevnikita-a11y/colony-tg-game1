import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path) {
  const source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { telegramHeaders, botAppLink, playerStartParam, supportsTelegram, waitForTelegram, shareTelegramLink } = await loadTypeScript('../lib/client/telegram.ts');
const { createRequestCoordinator, RequestCancelled, RequestInProgress } = await loadTypeScript('../lib/client/requests.ts');
const ok = (data = {}) => Response.json({ ok: true, ...data });
const client = (extra) => createRequestCoordinator({ headers: () => ({}), onBusy: () => {}, ...extra });

test('production never sends development identity without Telegram authentication', () => {
  assert.throws(() => telegramHeaders('', false), /Telegram/);
  assert.equal(telegramHeaders('', true)['x-dev-user-id'], '10001');
  assert.equal(telegramHeaders('signed-data', false)['x-telegram-init-data'], 'signed-data');
  assert.equal(telegramHeaders('signed-data', true)['x-dev-user-id'], undefined);
});

test('invite links accept valid bot identities and reject placeholders and URL injection', () => {
  assert.equal(botAppLink('@colony_test_bot', 'city_42'), 'https://t.me/colony_test_bot?startapp=city_42');
  for (const bot of [undefined, '', 'YOUR_BOT', 'example_bot', 'replace_me_bot', 'change_me_bot', 'placeholder_bot', 'your_colony_bot', 'bad/bot', 'colony_bot?start=evil', 'https://t.me/colony_bot']) assert.equal(botAppLink(bot), null);
  assert.equal(botAppLink('colony_test_bot', 'city_42&startapp=evil'), null);
  assert.equal(playerStartParam('ref', 42), 'ref_42');
  for (const id of [undefined, -1, 0, 1.5, 'bad', 2 ** 53]) assert.equal(playerStartParam('city', id), undefined);
});

test('SDK method presence alone does not enable capabilities in old Telegram clients', () => {
  assert.equal(supportsTelegram({ initData: 'signed', version: '6.8', requestWriteAccess() {} }, '6.9'), false);
  assert.equal(supportsTelegram({ initData: 'signed', version: '6.10' }, '6.9'), true);
  assert.equal(supportsTelegram({ initData: '', version: '8.0' }, '6.9'), false);
});

test('SDK bootstrap finishes when missing and supports cancellation', async () => {
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await waitForTelegram(aborted.signal, 1_000, () => undefined), undefined);
  assert.equal(await waitForTelegram(new AbortController().signal, 0, () => undefined), undefined);
  const sdk = { initData: 'signed' };
  assert.equal(await waitForTelegram(new AbortController().signal, 0, () => sdk), sdk);
});

test('sharing handles clipboard denial and native cancellation without rejecting', async () => {
  assert.equal(await shareTelegramLink('https://t.me/colony_test_bot', 'Hello', undefined, { clipboard: { writeText: async () => { throw new Error('denied'); } } }), 'manual');
  let copied = false;
  assert.equal(await shareTelegramLink('https://t.me/colony_test_bot', 'Hello', undefined, { share: async () => { throw new DOMException('cancelled', 'AbortError'); }, clipboard: { writeText: async () => { copied = true; } } }), 'cancelled');
  assert.equal(copied, false);
  let shared;
  assert.equal(await shareTelegramLink('https://t.me/colony_test_bot?startapp=ref_42', 'Hello & welcome', { initData: 'signed', version: '8.0', openTelegramLink: (link) => { shared = new URL(link); } }, {}), 'shared');
  assert.equal(shared.searchParams.get('text'), 'Hello & welcome');
  assert.equal(shared.searchParams.get('url'), 'https://t.me/colony_test_bot?startapp=ref_42');
});

test('mutation supersedes an old session response even if fetch ignores cancellation', async () => {
  let finishSession;
  let sessionSignal;
  const coordinator = client({ fetcher: (path, options) => path === '/api/session' ? new Promise((resolve) => { finishSession = resolve; sessionSignal = options.signal; }) : Promise.resolve(ok({ state: { ore: 9 } })) });
  const stale = coordinator.request('/api/session');
  const rejected = assert.rejects(stale, RequestCancelled);
  const mutation = await coordinator.request('/api/game/build');
  assert.equal(mutation.state.ore, 9);
  assert.equal(sessionSignal.aborted, true);
  finishSession(ok({ state: { ore: 100 } }));
  await rejected;
});

test('duplicate mutations and session polling cannot overlap a foreground action', async () => {
  let finish;
  let requests = 0;
  const busy = [];
  const coordinator = client({ onBusy: (value) => busy.push(value), fetcher: () => { requests++; return new Promise((resolve) => { finish = resolve; }); } });
  const action = coordinator.request('/api/game/build');
  await assert.rejects(coordinator.request('/api/game/build'), RequestInProgress);
  await assert.rejects(coordinator.request('/api/session', {}, { background: true }), RequestInProgress);
  assert.equal(requests, 1);
  finish(ok());
  await action;
  assert.deepEqual(busy, [true, false]);
});

test('timeouts abort requests without automatically retrying purchases or actions', async () => {
  let requests = 0;
  const coordinator = client({ timeoutMs: 5, fetcher: (_path, { signal }) => { requests++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); } });
  await assert.rejects(coordinator.request('/api/game/build'), /Действие могло сохраниться/);
  assert.equal(requests, 1);
});

test('offline, expired authentication and non-JSON server failure have actionable messages', async () => {
  await assert.rejects(client({ isOnline: () => false }).request('/api/session'), /Нет подключения/);
  await assert.rejects(client({ fetcher: async () => new Response('', { status: 401 }) }).request('/api/session'), /откройте её снова/);
  await assert.rejects(client({ fetcher: async () => new Response('<html>bad gateway</html>', { status: 502 }) }).request('/api/session'), /Сервер временно недоступен/);
});
