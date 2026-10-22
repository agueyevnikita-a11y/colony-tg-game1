// Windows-only local sandbox. Never reads project env files or accepts a DB URL.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, appendFile, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { createLocalConfig, validateLocalConfig, localPaths, localDatabaseUrl, localChildEnv, LOCAL_APP_PORT, LOCAL_PG_PORT, LOCAL_TEST_DATABASE } from './local-dev-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const paths = localPaths(root);
const executable = fileURLToPath(import.meta.url);
const exec = promisify(execFile);
const CONTROL_PORT = 43116;
const origin = `http://127.0.0.1:${LOCAL_APP_PORT}`;
const archiveUrl = 'https://get.enterprisedb.com/postgresql/postgresql-16.15-5-windows-x64-binaries.zip';
const archiveHash = '43bb45f173a6f08cf1d29a97a6d8deb119e8e8093a24c00d2d1001a0ccaa8281';
const lockFile = join(paths.baseDir, 'setup.lock');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pgBin = name => join(paths.pgToolsDir, 'bin', `${name}.exe`);
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function config() {
  await mkdir(paths.baseDir, { recursive: true });
  if (!await exists(paths.configFile)) await writeFile(paths.configFile, JSON.stringify(createLocalConfig(), null, 2), { flag: 'wx', mode: 0o600 });
  return validateLocalConfig(await readJson(paths.configFile));
}
async function run(command, args, env) {
  // pg_ctl's background server can inherit its pipes on Windows. Wait for the
  // command's exit, then close our readers instead of waiting for that server.
  const result = await new Promise(resolve => {
    let stdout = '', stderr = '';
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-16000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.once('error', error => resolve({ code: -1, stdout, stderr: error.message }));
    child.once('exit', code => {
      child.stdout.destroy(); child.stderr.destroy();
      resolve({ code, stdout, stderr });
    });
  });
  if (result.code !== 0) {
    let diagnostic = `${new Date().toISOString()} ${command.split(/[\\/]/).at(-1)}\n${result.stdout}\n${result.stderr}\n`;
    if (env?.PGPASSWORD) diagnostic = diagnostic.replaceAll(env.PGPASSWORD, '[local password]');
    diagnostic = diagnostic.replace(/postgres(?:ql)?:\/\/[^\s@]+@/g, 'postgres://[credentials]@');
    await appendFile(join(paths.baseDir, 'setup.log'), diagnostic);
    throw new Error(`Не удалось выполнить ${command.split(/[\\/]/).at(-1)}. Подробности — в .local-data/local-dev/setup.log; рабочая база не используется.`);
  }
  return result;
}
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = netServer();
    server.once('error', () => reject(new Error(`Локальный порт ${port} занят. Другой процесс не будет остановлен.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function runtime(env) {
  if (await exists(pgBin('pg_ctl'))) {
    const { stdout } = await run(pgBin('pg_ctl'), ['--version'], env);
    if (!/\b16\./.test(stdout)) throw new Error('В папке локального стенда требуется PostgreSQL 16.');
    return;
  }
  await mkdir(dirname(paths.archiveFile), { recursive: true });
  if (!await exists(paths.archiveFile) || await hashFile(paths.archiveFile) !== archiveHash) {
    console.log('Загрузка официального PostgreSQL 16.15 (около 356 МБ, только при первой настройке)…');
    const response = await fetch(archiveUrl, { redirect: 'error', signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error('Не удалось загрузить официальный архив PostgreSQL.');
    const hash = createHash('sha256');
    const temporary = `${paths.archiveFile}.download`;
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } }), createWriteStream(temporary));
    if (hash.digest('hex') !== archiveHash) { await unlink(temporary); throw new Error('Контрольная сумма PostgreSQL не совпала. Архив не запущен.'); }
    await rename(temporary, paths.archiveFile);
  }
  console.log('Распаковка переносного PostgreSQL…');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', join(root, 'scripts/local-postgres-extract.ps1'), '-Archive', paths.archiveFile, '-Destination', dirname(paths.pgToolsDir)], env);
  const { stdout } = await run(pgBin('pg_ctl'), ['--version'], env);
  if (!/\b16\.15\b/.test(stdout)) throw new Error('Архив не содержит ожидаемую версию PostgreSQL.');
}
async function pgRunning(env) {
  if (!await exists(pgBin('pg_ctl')) || !await exists(join(paths.dataDir, 'PG_VERSION'))) return false;
  try { await exec(pgBin('pg_ctl'), ['-D', paths.dataDir, 'status'], { env, windowsHide: true }); return true; }
  catch { return false; }
}
async function setup(cfg) {
  const env = localChildEnv(cfg);
  await runtime(env);
  const pgVersion = join(paths.dataDir, 'PG_VERSION');
  if (!await exists(pgVersion)) {
    const passwordFile = join(paths.baseDir, 'init-password');
    await writeFile(passwordFile, cfg.password, { mode: 0o600 });
    try {
      console.log('Создание отдельной локальной базы…');
      await run(pgBin('initdb'), ['-D', paths.dataDir, '-U', cfg.user, `--pwfile=${passwordFile}`, '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C'], env);
    } finally { await unlink(passwordFile).catch(() => {}); }
    await appendFile(join(paths.dataDir, 'postgresql.conf'), `\n# COLONY isolated local sandbox\nlisten_addresses = '127.0.0.1'\nport = ${LOCAL_PG_PORT}\n`);
  }
  if ((await readFile(pgVersion, 'utf8')).trim() !== '16') throw new Error('Файлы локальной базы имеют несовместимую версию. Они сохранены без изменений.');
  if (!await pgRunning(env)) {
    await portFree(LOCAL_PG_PORT);
    await run(pgBin('pg_ctl'), ['-D', paths.dataDir, '-l', paths.pgLogFile, '-o', `-h 127.0.0.1 -p ${LOCAL_PG_PORT}`, '-w', '-t', '30', 'start'], env);
  }
  const maintenance = new URL(localDatabaseUrl(cfg));
  maintenance.pathname = '/postgres'; // Only this generated local cluster, for CREATE DATABASE.
  const admin = postgres(maintenance.toString(), { max: 1, connect_timeout: 5 });
  try {
    const databases = await admin`SELECT datname FROM pg_database WHERE datname=${cfg.database}`;
    if (!databases.length) await admin.unsafe('CREATE DATABASE colony_local');
  } finally { await admin.end({ timeout: 2 }); }
  await run(process.execPath, [join(root, 'scripts/db-init.mjs')], env);
  const db = postgres(localDatabaseUrl(cfg), { max: 1, connect_timeout: 5 });
  try {
    await db`UPDATE feature_flags SET enabled=false WHERE flag_key IN ('stars_shop','notifications')`;
    await db`UPDATE system_settings SET value='{"enabled":false}'::jsonb WHERE setting_key='beta_required'`;
  } finally { await db.end({ timeout: 2 }); }
}
async function readState() {
  if (!await exists(paths.stateFile)) return null;
  const state = await readJson(paths.stateFile);
  if (!Number.isSafeInteger(state.pid) || state.pid <= 0 || !/^[a-f0-9]{64}$/.test(state.token) || state.root !== root) throw new Error('Некорректный файл состояния локального стенда.');
  return state;
}
async function control(state, action = 'status') {
  const response = await fetch(`http://127.0.0.1:${CONTROL_PORT}/${action}`, { method: action === 'stop' ? 'POST' : 'GET', headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error('Локальный управляющий процесс не подтвердил запрос.');
  const result = await response.json();
  if (result.pid !== state.pid || result.root !== root) throw new Error('Ответил другой локальный процесс.');
  return result;
}
async function status() {
  const state = await readState();
  if (state) {
    try { const result = await control(state); console.log(`COLONY ${version}: ${result.phase}\n${origin}\nПрогресс: .local-data/local-dev`); return result; }
    catch { if (alive(state.pid)) throw new Error('Локальный управляющий процесс запущен, но не отвечает. Проверь .local-data/local-dev/app.log.'); }
  }
  console.log('Локальная игра остановлена. Прогресс сохранён в .local-data/local-dev.');
  return null;
}
async function stopPg(cfg) {
  const env = localChildEnv(cfg);
  if (await pgRunning(env)) await run(pgBin('pg_ctl'), ['-D', paths.dataDir, '-m', 'fast', '-w', '-t', '30', 'stop'], env);
}
async function stop(cfg) {
  const state = await readState();
  if (state) {
    try {
      await control(state, 'stop');
      for (let attempt = 0; attempt < 90; attempt++) {
        if (!await exists(paths.stateFile)) { console.log('Локальная игра и база остановлены. Прогресс сохранён.'); return; }
        const current = await control(state).catch(() => null);
        if (current?.phase === 'error') throw new Error('Остановка не завершена. Процессы не удалены из состояния; проверь локальный журнал.');
        await delay(500);
      }
      throw new Error('Остановка ещё не завершилась. Проверь локальный журнал.');
    } catch (error) { if (alive(state.pid)) throw error; }
  }
  await stopPg(cfg);
  await unlink(paths.stateFile).catch(() => {});
  console.log('Локальная база остановлена. Прогресс сохранён.');
}
async function locked(action) {
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = await readJson(lockFile).catch(() => ({}));
    if (!Number.isSafeInteger(previous.pid) || alive(previous.pid)) throw new Error('Настройка локального стенда уже выполняется.');
    await unlink(lockFile);
    lock = await open(lockFile, 'wx', 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  try { return await action(); }
  finally { await lock.close(); await unlink(lockFile).catch(() => {}); }
}
async function start(cfg) {
  const existing = await readState();
  if (existing) {
    try {
      const current = await control(existing);
      if (current.phase === 'error') throw new Error('Предыдущий локальный запуск завершился с ошибкой. Используй local:stop, затем local:start.');
      console.log(`Локальная игра уже запущена: ${origin}`); return;
    }
    catch { if (alive(existing.pid)) throw new Error('Предыдущий локальный запуск ещё работает. Используй npm run local:status.'); }
  }
  await portFree(LOCAL_APP_PORT);
  await portFree(CONTROL_PORT);
  await setup(cfg);
  const token = randomBytes(32).toString('hex');
  const log = await open(paths.logFile, 'a', 0o600);
  const worker = spawn(process.execPath, [executable, 'serve'], { cwd: root, detached: true, windowsHide: true, env: { ...localChildEnv(cfg), COLONY_LOCAL_CONTROL_TOKEN: token }, stdio: ['ignore', log.fd, log.fd] });
  worker.unref();
  await log.close();
  console.log('Запуск COLONY…');
  for (let attempt = 0; attempt < 120; attempt++) {
    await delay(500);
    const state = await readState();
    if (!state || state.token !== token) continue;
    const current = await control(state).catch(() => null);
    if (current?.phase === 'ready') { console.log(`Готово: ${origin}\nОстановка: npm run local:stop\nПрогресс сохраняется в .local-data/local-dev.`); return; }
    if (current?.phase === 'error') throw new Error('Приложение не запустилось. Проверь .local-data/local-dev/app.log.');
  }
  throw new Error('Запуск занимает больше минуты. Используй npm run local:status; повторный сервер не запускай.');
}
async function serve(cfg) {
  const token = process.env.COLONY_LOCAL_CONTROL_TOKEN;
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw new Error('Управляющий запуск разрешён только через local:start.');
  let phase = 'starting';
  let stopping = false;
  let application;
  const state = { pid: process.pid, token, root, startedAt: new Date().toISOString() };
  async function cleanup() {
    if (stopping) return;
    stopping = true; phase = 'stopping';
    try {
      // Only terminate the live child created by this worker, never a PID read from disk.
      if (application && application.exitCode === null && application.signalCode === null) {
        try { await exec('taskkill.exe', ['/PID', String(application.pid), '/T', '/F'], { windowsHide: true }); }
        catch { if (application.exitCode === null && application.signalCode === null) throw new Error('Не удалось остановить собственный процесс приложения.'); }
        for (let attempt = 0; attempt < 30 && application.exitCode === null && application.signalCode === null; attempt++) await delay(100);
        if (application.exitCode === null && application.signalCode === null) throw new Error('Процесс приложения ещё не завершён.');
      }
      await portFree(LOCAL_APP_PORT);
      await stopPg(cfg);
      if (await pgRunning(localChildEnv(cfg))) throw new Error('Локальная база ещё не остановлена.');
      const current = await readState();
      if (current?.token === token && current.pid === process.pid) await unlink(paths.stateFile);
      server.close(); process.exit(0);
    } catch { phase = 'error'; stopping = false; console.error('Не удалось завершить локальную остановку. Состояние сохранено; повтори local:stop после проверки журнала.'); }
  }
  const server = httpServer((request, response) => {
    const authorization = request.headers.authorization ?? '';
    const expected = `Bearer ${token}`;
    const suppliedBytes = Buffer.from(authorization), expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) { response.writeHead(403).end(); return; }
    if (!((request.method === 'GET' && request.url === '/status') || (request.method === 'POST' && request.url === '/stop'))) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ pid: process.pid, root, phase, version }));
    if (request.method === 'POST') setImmediate(() => void cleanup());
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(CONTROL_PORT, '127.0.0.1', resolve); });
  await writeFile(paths.stateFile, JSON.stringify(state), { mode: 0o600 });
  const env = localChildEnv(cfg);
  delete env.COLONY_LOCAL_CONTROL_TOKEN;
  application = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(LOCAL_APP_PORT)], { cwd: root, windowsHide: true, env, stdio: 'inherit' });
  application.once('error', () => { phase = 'error'; });
  application.once('exit', () => { if (!stopping) { phase = 'error'; console.error('Локальное приложение остановилось. Используй local:stop, затем local:start.'); } });
  process.on('SIGINT', () => void cleanup());
  process.on('SIGTERM', () => void cleanup());
  for (let attempt = 0; attempt < 100 && phase === 'starting'; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) });
      const health = await response.json();
      if (response.ok && health.service === 'colony' && health.database === 'ok') { phase = 'ready'; break; }
    } catch { /* Compilation takes a few seconds on the first request. */ }
    await delay(500);
  }
  if (phase === 'starting') { phase = 'error'; console.error('Локальное приложение не прошло проверку запуска.'); }
}

async function testLocal(cfg) {
  const state = await readState();
  if (state && alive(state.pid)) throw new Error('Перед тестами останови локальную игру: npm run local:stop. Город сохранится.');
  await setup(cfg);
  const adminUrl = new URL(localDatabaseUrl(cfg));
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5 });
  try {
    if (!(await admin`SELECT datname FROM pg_database WHERE datname=${LOCAL_TEST_DATABASE}`).length) await admin.unsafe('CREATE DATABASE colony_test');
  } finally { await admin.end({ timeout: 2 }); }
  const env = { ...localChildEnv(cfg), DATABASE_URL: localDatabaseUrl(cfg, LOCAL_TEST_DATABASE), NODE_ENV: 'production', ALLOW_DEV_AUTH: 'false', NEXT_PUBLIC_LOCAL_DEV: 'false', NEXT_PUBLIC_BOT_USERNAME: 'colony_ci_bot', COLONY_TEST_DATABASE: '1' };
  try {
    console.log('Отдельная база colony_test: схема, типы, тесты, production-сборка…');
    await run(process.execPath, [join(root, 'scripts/db-init.mjs')], env);
    await run(process.execPath, [join(root, 'scripts/db-init.mjs')], env);
    await run(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'typegen'], env);
    await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], env);
    const unit = await run(process.execPath, ['--test', 'tests/*.test.mjs'], env);
    console.log(unit.stdout.split(/\r?\n/).filter(line => /^# (tests|pass|fail) /.test(line)).join('\n'));
    await run(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'build'], env);
    console.log('Проверка production API на PostgreSQL…');
    const integration = await run(process.execPath, ['--test', 'tests/launch.integration.mjs'], env);
    console.log(integration.stdout.split(/\r?\n/).filter(line => /^# (tests|pass|fail) /.test(line)).join('\n'));
    console.log('Проверки завершены. Игровая база colony_local не использовалась для тестов.');
  } finally { await stopPg(cfg); }
}

try {
  if (process.platform !== 'win32') throw new Error('Этот переносной запуск предназначен для Windows. Для других систем см. README: local development / Docker.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 18) throw new Error('Нужен Node.js 22.18 или новее.');
  const action = process.argv[2];
  if (!['setup', 'start', 'stop', 'status', 'serve', 'test'].includes(action)) throw new Error('Команды: local:setup, local:start, local:stop, local:status, local:test.');
  const cfg = await config();
  if (action === 'serve') await serve(cfg);
  else if (action === 'status') await status();
  else if (action === 'stop') await stop(cfg);
  else await locked(async () => {
    if (action === 'setup') { await setup(cfg); console.log('Локальная база готова. Запуск игры: npm run local:start'); }
    else if (action === 'test') await testLocal(cfg);
    else await start(cfg);
  });
} catch (error) {
  // Do not echo errors from database drivers or env files, which may contain credentials.
  const message = error instanceof Error && /^[А-Яа-яЁё]/.test(error.message) ? error.message : 'Ошибка локального стенда. Проверь .local-data/local-dev/app.log и postgresql.log.';
  console.error(message);
  process.exitCode = 1;
}
