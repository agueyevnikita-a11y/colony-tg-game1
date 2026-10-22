import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

export const LOCAL_APP_PORT = 3015;
export const LOCAL_PG_PORT = 55432;
export const LOCAL_DATABASE = 'colony_local';
export const LOCAL_TEST_DATABASE = 'colony_test';
export const LOCAL_DEV_ID = 10001;
export const LOCAL_POSTGRES_MAJOR = 16;

const CONFIG_KEYS = ['schemaVersion', 'postgresMajor', 'appPort', 'pgPort', 'database', 'user', 'password'];

export function localPaths(rootDir) {
  if (typeof rootDir !== 'string' || !rootDir.trim()) throw new Error('Local workspace path is required.');
  const root = resolve(rootDir);
  const baseDir = join(root, '.local-data', 'local-dev');
  return {
    baseDir,
    configFile: join(baseDir, 'config.json'),
    stateFile: join(baseDir, 'state.json'),
    logFile: join(baseDir, 'app.log'),
    dataDir: join(baseDir, 'pgdata'),
    pgLogFile: join(baseDir, 'postgresql.log'),
    pgToolsDir: join(root, '.local-tools', 'postgresql', 'pgsql'),
    archiveFile: join(root, '.local-tools', 'postgresql-binaries.zip'),
  };
}

export function createLocalConfig() {
  return {
    schemaVersion: 1,
    postgresMajor: LOCAL_POSTGRES_MAJOR,
    appPort: LOCAL_APP_PORT,
    pgPort: LOCAL_PG_PORT,
    database: LOCAL_DATABASE,
    user: LOCAL_DATABASE,
    password: randomBytes(32).toString('hex'),
  };
}

/** Refuse edited connection targets instead of ever accepting a remote database. */
export function validateLocalConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(config))) {
    throw new Error('Invalid local configuration.');
  }
  const keys = Reflect.ownKeys(config);
  if (keys.length !== CONFIG_KEYS.length || keys.some(key => !CONFIG_KEYS.includes(key))
    || CONFIG_KEYS.some(key => !Object.hasOwn(config, key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(config, key), 'value'))) {
    throw new Error('Unexpected local configuration fields.');
  }
  if (config.schemaVersion !== 1) throw new Error('Unsupported local configuration version.');
  if (config.postgresMajor !== LOCAL_POSTGRES_MAJOR) throw new Error('Unsupported local PostgreSQL version.');
  if (config.appPort !== LOCAL_APP_PORT) throw new Error('Invalid local application port.');
  if (config.pgPort !== LOCAL_PG_PORT) throw new Error('Invalid local PostgreSQL port.');
  if (config.database !== LOCAL_DATABASE || config.user !== LOCAL_DATABASE) {
    throw new Error('Invalid local database identity.');
  }
  if (typeof config.password !== 'string' || !/^[a-f0-9]{64}$/.test(config.password)) {
    throw new Error('Invalid local database password.');
  }
  return Object.fromEntries(CONFIG_KEYS.map(key => [key, config[key]]));
}

export function localDatabaseUrl(config, database) {
  const validated = validateLocalConfig(config);
  const name = database === undefined ? validated.database : database;
  if (name !== LOCAL_DATABASE && name !== LOCAL_TEST_DATABASE) {
    throw new Error('Only the isolated local databases are allowed.');
  }
  return `postgres://${validated.user}:${validated.password}@127.0.0.1:${validated.pgPort}/${name}`;
}

/** Existing environment files cannot supply production secrets to local children. */
export function localChildEnv(config, { baseEnv = process.env } = {}) {
  const validated = validateLocalConfig(config);
  if (!baseEnv || typeof baseEnv !== 'object' || Array.isArray(baseEnv)) throw new Error('Invalid child environment.');
  const overrides = {
    NODE_ENV: 'development',
    NODE_OPTIONS: '',
    NODE_PATH: '',
    ALLOW_DEV_AUTH: 'true',
    DATABASE_URL: localDatabaseUrl(validated),
    POSTGRES_PASSWORD: validated.password,
    PGHOST: '127.0.0.1',
    PGHOSTADDR: '127.0.0.1',
    PGPORT: String(validated.pgPort),
    PGDATABASE: validated.database,
    PGUSER: validated.user,
    PGPASSWORD: validated.password,
    PGSSLMODE: 'disable',
    PGCONNECT_TIMEOUT: '5',
    PGCLIENTENCODING: 'UTF8',
    PGAPPNAME: 'colony-local',
    PGSERVICE: '',
    PGSERVICEFILE: '',
    PGPASSFILE: '',
    PGOPTIONS: '',
    COLONY_TEST_DATABASE: '',
    BOT_TOKEN: '',
    BOT_USERNAME: '',
    NEXT_PUBLIC_BOT_USERNAME: '',
    TELEGRAM_WEBHOOK_SECRET: '',
    CRON_SECRET: '',
    ADMIN_TELEGRAM_IDS: String(LOCAL_DEV_ID),
    SUPPORT_URL: '',
    APP_URL: `http://127.0.0.1:${validated.appPort}`,
    PORT: String(validated.appPort),
    NEXT_PUBLIC_LOCAL_DEV: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  const managedKeys = new Set(Object.keys(overrides));
  // Windows treats environment names case-insensitively. Remove differently
  // cased inherited names as well, so child_process cannot choose them first.
  const preserved = Object.entries(baseEnv).filter(([key]) => {
    const upper = key.toUpperCase();
    return !managedKeys.has(upper) && !upper.startsWith('PG');
  });
  return { ...Object.fromEntries(preserved), ...overrides };
}
