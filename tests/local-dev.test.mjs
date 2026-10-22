import assert from 'node:assert/strict';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import {
  LOCAL_APP_PORT, LOCAL_PG_PORT, LOCAL_DATABASE, LOCAL_TEST_DATABASE,
  LOCAL_DEV_ID, LOCAL_POSTGRES_MAJOR, createLocalConfig, validateLocalConfig,
  localDatabaseUrl, localChildEnv, localPaths,
} from '../scripts/local-dev-config.mjs';

test('local setup generates independent strong passwords and pins its runtime identity', () => {
  const first = createLocalConfig(), second = createLocalConfig();
  assert.match(first.password, /^[a-f0-9]{64}$/);
  assert.notEqual(first.password, second.password);
  assert.deepEqual({ ...first, password: undefined }, {
    schemaVersion: 1, postgresMajor: LOCAL_POSTGRES_MAJOR,
    appPort: LOCAL_APP_PORT, pgPort: LOCAL_PG_PORT,
    database: LOCAL_DATABASE, user: LOCAL_DATABASE, password: undefined,
  });
  const validated = validateLocalConfig(first);
  assert.deepEqual(validated, first);
  assert.notEqual(validated, first, 'Validation returns a plain copy without changing the original config');
});

test('edited local configuration cannot redirect a launcher or schema setup', () => {
  const config = createLocalConfig();
  for (const changed of [
    null, [], {}, new Date(), Object.create(config),
    { ...config, host: 'remote-db.invalid' },
    { ...config, DATABASE_URL: 'postgres://remote-db.invalid/production' },
    { ...config, schemaVersion: 2 }, { ...config, schemaVersion: '1' },
    { ...config, postgresMajor: 17 }, { ...config, postgresMajor: '16' },
    { ...config, appPort: 3000 }, { ...config, appPort: String(LOCAL_APP_PORT) },
    { ...config, pgPort: 5432 }, { ...config, pgPort: String(LOCAL_PG_PORT) },
    { ...config, database: 'production' }, { ...config, database: '../colony_local' },
    { ...config, user: 'postgres' }, { ...config, password: 'short' },
    { ...config, password: 'a'.repeat(63) }, { ...config, password: 'g'.repeat(64) },
    { ...config, password: null }, { ...config, [Symbol('hidden')]: 'value' },
  ]) assert.throws(() => validateLocalConfig(changed));
  for (const key of Object.keys(config)) {
    const missing = { ...config };
    delete missing[key];
    assert.throws(() => validateLocalConfig(missing));
  }
  let getterCalled = false;
  const accessor = { ...config };
  Object.defineProperty(accessor, 'password', { enumerable: true, get() { getterCalled = true; return config.password; } });
  assert.throws(() => validateLocalConfig(accessor));
  assert.equal(getterCalled, false, 'Do not execute accessors from an untrusted config object');
});

test('database URLs permit only isolated databases and always address loopback', () => {
  const config = createLocalConfig();
  for (const database of [undefined, LOCAL_DATABASE, LOCAL_TEST_DATABASE]) {
    const url = new URL(localDatabaseUrl(config, database));
    assert.equal(url.protocol, 'postgres:');
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, String(LOCAL_PG_PORT));
    assert.equal(url.username, LOCAL_DATABASE);
    assert.equal(url.password, config.password);
    assert.equal(url.pathname, `/${database ?? LOCAL_DATABASE}`);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  }
  for (const name of ['postgres', 'production', '../colony_local', 'colony_local?host=remote.invalid', '', null, 1]) {
    assert.throws(() => localDatabaseUrl(config, name));
  }
  assert.throws(() => localDatabaseUrl({ ...config, pgPort: 5432 }));
});

test('local child environment overrides production values without mutating its parent', () => {
  const config = createLocalConfig();
  const inherited = {
    PATH: 'keep-local-runtime-path', SystemRoot: 'keep-system-directory',
    NODE_ENV: 'production', NODE_OPTIONS: '--import=untrusted-hook.mjs', NODE_PATH: 'external-modules',
    ALLOW_DEV_AUTH: 'false', DATABASE_URL: 'postgres://remote-db.invalid/production',
    POSTGRES_PASSWORD: 'production-password-sentinel',
    PGHOST: 'remote-db.invalid', PGHOSTADDR: '203.0.113.1', PGPORT: '5432',
    PGDATABASE: 'production', PGUSER: 'production-user', PGPASSWORD: 'production-pg-password',
    PGSERVICE: 'production-service', PGSERVICEFILE: 'production-services.conf',
    PGPASSFILE: 'production-pgpass', PGOPTIONS: '-c search_path=production',
    BOT_TOKEN: 'production-bot-sentinel', BOT_USERNAME: 'live_game_bot',
    NEXT_PUBLIC_BOT_USERNAME: 'live_game_bot', TELEGRAM_WEBHOOK_SECRET: 'production-webhook-sentinel',
    CRON_SECRET: 'production-cron-sentinel', SUPPORT_URL: 'https://support.invalid',
    ADMIN_TELEGRAM_IDS: '987654321', APP_URL: 'https://production.invalid',
    PORT: '3000', COLONY_TEST_DATABASE: '1', NEXT_PUBLIC_LOCAL_DEV: 'false', NEXT_TELEMETRY_DISABLED: '0',
  };
  const snapshot = structuredClone(inherited);
  const env = localChildEnv(config, { baseEnv: inherited });
  assert.deepEqual(inherited, snapshot);
  assert.equal(env.PATH, inherited.PATH);
  assert.equal(env.SystemRoot, inherited.SystemRoot);
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.NODE_OPTIONS, '');
  assert.equal(env.NODE_PATH, '');
  assert.equal(env.ALLOW_DEV_AUTH, 'true');
  assert.equal(env.DATABASE_URL, localDatabaseUrl(config));
  assert.equal(env.POSTGRES_PASSWORD, config.password);
  assert.equal(env.PGHOST, '127.0.0.1');
  assert.equal(env.PGHOSTADDR, '127.0.0.1');
  assert.equal(env.PGPORT, String(LOCAL_PG_PORT));
  assert.equal(env.PGDATABASE, LOCAL_DATABASE);
  assert.equal(env.PGUSER, LOCAL_DATABASE);
  assert.equal(env.PGPASSWORD, config.password);
  assert.equal(env.PGSSLMODE, 'disable');
  for (const key of ['BOT_TOKEN', 'BOT_USERNAME', 'NEXT_PUBLIC_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET',
    'CRON_SECRET', 'SUPPORT_URL', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'COLONY_TEST_DATABASE']) {
    assert.equal(env[key], '', `${key} must not be inherited or loaded from a project env file`);
  }
  assert.equal(env.ADMIN_TELEGRAM_IDS, String(LOCAL_DEV_ID));
  assert.equal(env.APP_URL, `http://127.0.0.1:${LOCAL_APP_PORT}`);
  assert.equal(env.PORT, String(LOCAL_APP_PORT));
  assert.equal(env.NEXT_PUBLIC_LOCAL_DEV, 'true');
  assert.equal(env.NEXT_TELEMETRY_DISABLED, '1');
});

test('mixed-case Windows environment entries cannot override forced local settings', () => {
  const config = createLocalConfig();
  const env = localChildEnv(config, { baseEnv: {
    Database_Url: 'postgres://remote-db.invalid/production',
    Bot_Token: 'production-bot-sentinel', pGhoST: 'remote-db.invalid',
    pGHOSTADDR: '203.0.113.1', Node_Options: '--import=untrusted-hook.mjs',
    Next_Public_Bot_Username: 'live_game_bot',
  } });
  for (const key of ['Database_Url', 'Bot_Token', 'pGhoST', 'pGHOSTADDR', 'Node_Options', 'Next_Public_Bot_Username']) {
    assert.equal(Object.hasOwn(env, key), false);
  }
  assert.equal(env.BOT_TOKEN, '');
  assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1');
});

test('invalid configuration is rejected before constructing a child environment', () => {
  const config = createLocalConfig();
  assert.throws(() => localChildEnv({ ...config, database: 'production' }));
  assert.throws(() => localChildEnv(config, { baseEnv: null }));
  const leaked = 'do-not-print-this-invalid-secret';
  assert.throws(() => validateLocalConfig({ ...config, password: leaked }), error => {
    assert.equal(error.message.includes(leaked), false);
    return true;
  });
});

test('local paths keep generated credentials, data and tools in dedicated workspace directories', () => {
  const root = resolve('local-workspace-fixture');
  const paths = localPaths(root);
  const base = join(root, '.local-data', 'local-dev');
  assert.equal(paths.baseDir, base);
  for (const key of ['configFile', 'stateFile', 'logFile', 'dataDir', 'pgLogFile']) {
    assert.ok(relative(base, paths[key]) && !relative(base, paths[key]).startsWith('..'));
  }
  assert.equal(paths.pgToolsDir, join(root, '.local-tools', 'postgresql', 'pgsql'));
  assert.equal(paths.archiveFile, join(root, '.local-tools', 'postgresql-binaries.zip'));
  for (const invalid of [undefined, null, '', ' ', 123]) assert.throws(() => localPaths(invalid));
});
