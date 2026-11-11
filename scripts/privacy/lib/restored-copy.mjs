import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import postgres from 'postgres';
import { accountKey } from './case-store.mjs';
import { AccountErasureBlockedError, eraseAccountData } from './account-erasure-data.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const DATABASE = /^colony_privacy_restore_[a-f0-9]{16}$/;
const ERASED = new Set(['active_data_erased', 'copies_pending', 'completed']);
const SQL_OPTIONS = { max: 1, connect_timeout: 10, onnotice() {}, debug: false };
const FAILURE_STAGES = new Set([
  'CONFIGURATION', 'ARCHIVE_VERIFICATION', 'SOURCE_OWNER_VERIFICATION', 'DATABASE_CREATION',
  'DATABASE_ISOLATION', 'PG_RESTORE_START', 'PG_RESTORE_INPUT', 'PG_RESTORE_EXIT', 'ARCHIVE_RECHECK',
  'QUARANTINE_CONNECTION', 'IDENTITY_SCAN', 'ACCOUNT_ERASURE', 'IDENTITY_VERIFICATION',
  'RATE_LIMIT_REMOVAL', 'PROOF_REVOCATION', 'MAINTENANCE_ENFORCEMENT', 'FEATURE_LOCKDOWN',
  'QUARANTINE_VERIFICATION', 'FINAL_ISOLATION', 'QUARANTINE_CLOSE', 'ARCHIVE_CLOSE',
]);
const BLOCKER_CODES = new Set([
  'SCHEMA_REVIEW_REQUIRED', 'ADMIN_ACCOUNT', 'PURCHASE_RECORDS', 'MARKET_HISTORY',
  'OWNED_ALLIANCE_MEMBERS', 'ACTIVE_COOPERATION', 'ACTIVE_NOTIFICATION_DELIVERY',
  'THIRD_PARTY_FEEDBACK', 'THIRD_PARTY_ERRORS', 'THIRD_PARTY_ANALYTICS',
  'VERIFICATION_ACTOR_HISTORY', 'ALLIANCE_ROLE_ANOMALY', 'OWNED_ALLIANCE_SHARED_HISTORY',
  'BETA_CODE_CREATOR_HISTORY',
]);
const EARLY_INPUT_CLOSE = new Set(['EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED']);
const SAFE_STREAM_CODES = new Set([...EARLY_INPUT_CLOSE, 'EBADF', 'EIO', 'ENOMEM', 'ERR_INVALID_STATE']);

function safeRestoreFailure(stage, failure) {
  const safeStage = FAILURE_STAGES.has(stage) ? stage : 'CONFIGURATION';
  const blockerCodes = failure instanceof AccountErasureBlockedError
    ? [...new Set((Array.isArray(failure.blockers) ? failure.blockers : [])
      .map(blocker => blocker?.code).filter(code => BLOCKER_CODES.has(code)))].sort()
    : [];
  const blocked = blockerCodes.length ? `; blockers: ${blockerCodes.join(',')}` : '';
  const error = new Error(`Sanitized restore failed at ${safeStage}${blocked}; no copy was activated`);
  error.code = 'SANITIZED_RESTORE_FAILED';
  error.stage = safeStage;
  if (blockerCodes.length) error.blockerCodes = blockerCodes;
  if (SAFE_STREAM_CODES.has(failure?.restoreStreamCode)) error.restoreStreamCode = failure.restoreStreamCode;
  if (Number.isInteger(failure?.pgRestoreExitCode) && failure.pgRestoreExitCode >= 0 && failure.pgRestoreExitCode <= 255) error.pgRestoreExitCode = failure.pgRestoreExitCode;
  return error;
}

async function descriptorDigest(handle) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
  return hash.digest('hex');
}

function databaseIdentifier(value) {
  if (!DATABASE.test(value)) throw new Error('Invalid quarantine database');
  return `"${value}"`;
}

const samePath = (left, right) => process.platform === 'win32'
  ? path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
  : path.normalize(left) === path.normalize(right);

function absolutePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value)
    || value.split(/[\\/]+/).some(part => part === '.' || part === '..')) throw new Error('Invalid backup path');
  if (process.platform === 'win32' && !/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/.test(value)) throw new Error('Invalid backup path');
  return path.resolve(value);
}

function unchanged(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && right.nlink === 1n;
}

async function openArchive(archive, backupRoot, expectedSha256) {
  if (typeof expectedSha256 !== 'string' || !SHA256.test(expectedSha256)) throw new Error('Invalid archive digest');
  const root = absolutePath(backupRoot);
  const filename = absolutePath(archive);
  if (samePath(path.dirname(root), root) || !samePath(path.dirname(filename), root)) throw new Error('Archive must be directly inside the backup directory');
  const rootStat = await fs.lstat(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !samePath(await fs.realpath(root), root)) throw new Error('Invalid backup directory');
  const named = await fs.lstat(filename, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n) throw new Error('Invalid archive file');
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || !unchanged(named, stat) || !samePath(await fs.realpath(filename), filename)) throw new Error('Archive changed while opening');
    if (await descriptorDigest(handle) !== expectedSha256 || !unchanged(stat, await handle.stat({ bigint: true }))) throw new Error('Archive digest mismatch');
    const currentRoot = await fs.lstat(root, { bigint: true });
    if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink() || rootStat.dev !== currentRoot.dev
      || rootStat.ino !== currentRoot.ino || !samePath(await fs.realpath(root), root)) throw new Error('Backup directory changed');
    return { handle, stat };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

function clientEnvironment(databaseUrl, database) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username
    || !url.pathname.slice(1) || url.hash) throw new Error('Invalid database-owner connection');
  const environment = {};
  // Do not inherit DATABASE_URL, PGOPTIONS, service files or unrelated secrets.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  Object.assign(environment, {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    PGSSLMODE: url.searchParams.get('sslmode') || 'disable',
  });
  if (!['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(environment.PGSSLMODE)) throw new Error('Invalid database TLS configuration');
  if (url.searchParams.has('sslrootcert')) environment.PGSSLROOTCERT = url.searchParams.get('sslrootcert');
  return environment;
}

export async function restoreArchive(handle, databaseUrl, database, expectedSha256, initialStat, setStage = () => {}, spawnProcess = spawn) {
  setStage('PG_RESTORE_START');
  const child = spawnProcess('pg_restore', [
    '--dbname', database, '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl',
  ], { env: clientEnvironment(databaseUrl, database), windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  // PostgreSQL diagnostics can include restored account data. Never forward them.
  child.stderr.resume();
  let pgRestoreExitCode;
  let failedToStart = false;
  let restoreStreamCode;
  let inputClosed = false;
  child.stdin.on('close', () => { inputClosed = true; });
  child.stdin.on('error', error => {
    inputClosed = true;
    restoreStreamCode = error?.code;
    if (!EARLY_INPUT_CLOSE.has(restoreStreamCode)) child.kill('SIGKILL');
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', () => { failedToStart = true; setStage('PG_RESTORE_START'); reject(new Error('Archive restore could not start')); });
    child.once('close', code => {
      pgRestoreExitCode = code;
      if (code === 0) resolve();
      else { if (!failedToStart) setStage('PG_RESTORE_EXIT'); reject(new Error('Archive restore failed')); }
    });
  });
  const hash = crypto.createHash('sha256');
  setStage('PG_RESTORE_INPUT');
  const supplied = (async () => {
    // Do not pipe/destroy a FileHandle ReadStream here: an early stdin close
    // causes pipeline() to destroy its source and close the pinned descriptor.
    // Positional reads preserve that descriptor and hash every archive byte even
    // when a successful pg_restore stops reading before archive trailer bytes.
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (!inputClosed && !child.stdin.destroyed && !child.stdin.writableEnded) {
        await new Promise((resolve, reject) => {
          child.stdin.write(chunk, error => {
            if (error) {
              inputClosed = true;
              restoreStreamCode = error.code;
              if (!EARLY_INPUT_CLOSE.has(restoreStreamCode)) { reject(new Error('Archive input failed')); return; }
            }
            resolve();
          });
        });
      }
      if (restoreStreamCode && !EARLY_INPUT_CLOSE.has(restoreStreamCode)) throw new Error('Archive input failed');
    }
    if (!inputClosed && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
  })().catch(error => {
    if (!restoreStreamCode) restoreStreamCode = error?.code;
    child.kill('SIGKILL');
    throw new Error('Archive input failed');
  });
  try {
    const [toolResult, inputResult] = await Promise.allSettled([exited, supplied]);
    if (toolResult.status !== 'fulfilled' || inputResult.status !== 'fulfilled'
      || (restoreStreamCode && !EARLY_INPUT_CLOSE.has(restoreStreamCode))) throw new Error('Archive restore failed');
    setStage('ARCHIVE_RECHECK');
    // An open descriptor prevents path substitution; rehashing delivered bytes also
    // catches in-place writes between initial verification and restore.
    if (hash.digest('hex') !== expectedSha256 || !unchanged(initialStat, await handle.stat({ bigint: true }))) throw new Error('Archive changed during restore');
  } catch {
    child.kill('SIGKILL');
    await Promise.allSettled([exited, supplied]);
    const error = new Error('Archive restore failed');
    if (SAFE_STREAM_CODES.has(restoreStreamCode)) error.restoreStreamCode = restoreStreamCode;
    if (Number.isInteger(pgRestoreExitCode)) error.pgRestoreExitCode = pgRestoreExitCode;
    throw error;
  }
}

function erasureCases(records, adminTelegramIds) {
  if (!Array.isArray(records) || !Array.isArray(adminTelegramIds)
    || adminTelegramIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid erasure replay configuration');
  const byKey = new Map();
  for (const record of records) {
    if (!record || !ERASED.has(record.status)) continue;
    if (!SHA256.test(record.accountKey || '') || !UUID.test(record.id || '')) throw new Error('Invalid erasure replay case');
    const requests = byKey.get(record.accountKey) || new Set();
    requests.add(record.id);
    byKey.set(record.accountKey, requests);
  }
  // Validate the durable identity configuration before creating any database.
  accountKey(1);
  return byKey;
}

async function sanitize(sql, casesByKey, adminTelegramIds, setStage) {
  return sql.begin(async tx => {
    const requests = new Set();
    setStage('IDENTITY_SCAN');
    const users = await tx`SELECT id,telegram_id FROM public.users ORDER BY id FOR UPDATE`;
    for (const user of users) {
      const cases = casesByKey.get(accountKey(Number(user.telegram_id)));
      if (!cases) continue;
      // Backup UUIDs can predate the current closure record: match durable identity.
      setStage('ACCOUNT_ERASURE');
      await eraseAccountData(tx, user.id, adminTelegramIds);
      for (const id of cases) requests.add(id);
    }
    setStage('IDENTITY_VERIFICATION');
    for (const user of await tx`SELECT id,telegram_id FROM public.users`) {
      if (casesByKey.has(accountKey(Number(user.telegram_id)))) throw new Error('Erased account remains in quarantine');
    }
    setStage('RATE_LIMIT_REMOVAL');
    for(const key of casesByKey.keys()) await tx`DELETE FROM public.api_rate_limits WHERE bucket_key=${`privacy-request:${key}`}`;
    setStage('PROOF_REVOCATION');
    await tx`UPDATE public.account_ownership_proofs SET revoked_at=now() WHERE consumed_at IS NULL AND revoked_at IS NULL`;
    setStage('MAINTENANCE_ENFORCEMENT');
    await tx`INSERT INTO public.system_settings(setting_key,value,updated_at)
      VALUES ('maintenance','{"enabled":true}'::jsonb,now())
      ON CONFLICT(setting_key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
    setStage('FEATURE_LOCKDOWN');
    await tx`INSERT INTO public.feature_flags(flag_key,enabled,rollout_percent)
      VALUES ('notifications',false,0),('stars_shop',false,0)
      ON CONFLICT(flag_key) DO UPDATE SET enabled=false,rollout_percent=0,updated_at=now()`;
    await tx`DELETE FROM public.feature_flag_overrides WHERE enabled=true AND flag_key IN ('notifications','stars_shop')`;
    setStage('QUARANTINE_VERIFICATION');
    const [safety] = await tx`SELECT
      (SELECT value->>'enabled' FROM public.system_settings WHERE setting_key='maintenance')='true' AS maintenance,
      (SELECT count(*) FROM public.feature_flags WHERE flag_key IN ('notifications','stars_shop') AND enabled=false)=2 AS flags_disabled,
      NOT EXISTS(SELECT 1 FROM public.feature_flag_overrides WHERE enabled=true AND flag_key IN ('notifications','stars_shop')) AS overrides_cleared,
      NOT EXISTS(SELECT 1 FROM public.account_ownership_proofs WHERE consumed_at IS NULL AND revoked_at IS NULL) AS proofs_revoked`;
    if (!safety?.maintenance || !safety.flags_disabled || !safety.overrides_cleared || !safety.proofs_revoked) throw new Error('Quarantine safety verification failed');
    return [...requests].sort();
  });
}

/** Creates a private, unactivated copy. It never changes the main database. */
export async function restoreSanitizedCopy({
  databaseUrl, archive, expectedSha256, erasedCases, adminTelegramIds = [], backupRoot = '/var/backups/colony',
}) {
  const database = `colony_privacy_restore_${crypto.randomBytes(8).toString('hex')}`;
  const quotedDatabase = databaseIdentifier(database);
  let verified;
  let owner;
  let restored;
  let created = false;
  let stage = 'CONFIGURATION';
  const setStage = value => { stage = value; };
  try {
    const casesByKey = erasureCases(erasedCases, adminTelegramIds);
    clientEnvironment(databaseUrl, database);
    setStage('ARCHIVE_VERIFICATION');
    verified = await openArchive(archive, backupRoot, expectedSha256);
    setStage('SOURCE_OWNER_VERIFICATION');
    owner = postgres(databaseUrl, SQL_OPTIONS);
    const [identity] = await owner`SELECT current_user AS role,pg_get_userbyid(datdba) AS owner
      FROM pg_database WHERE datname=current_database()`;
    if (!identity || identity.role !== identity.owner) throw new Error('Database-owner connection required');
    setStage('DATABASE_CREATION');
    await owner.unsafe(`CREATE DATABASE ${quotedDatabase} TEMPLATE template0`);
    created = true;
    setStage('DATABASE_ISOLATION');
    await owner.unsafe(`REVOKE ALL PRIVILEGES ON DATABASE ${quotedDatabase} FROM PUBLIC`);
    await restoreArchive(verified.handle, databaseUrl, database, expectedSha256, verified.stat, setStage);
    // Explicit database overrides the URL pathname; no caller target is accepted.
    setStage('QUARANTINE_CONNECTION');
    restored = postgres(databaseUrl, { ...SQL_OPTIONS, database });
    const [{ actual }] = await restored`SELECT current_database() AS actual`;
    if (actual !== database) throw new Error('Unexpected quarantine database');
    const replayedRequests = await sanitize(restored, casesByKey, adminTelegramIds, setStage);
    setStage('FINAL_ISOLATION');
    await owner.unsafe(`REVOKE ALL PRIVILEGES ON DATABASE ${quotedDatabase} FROM PUBLIC`);
    setStage('QUARANTINE_CLOSE');
    await restored.end({ timeout: 3 });
    restored = undefined;
    setStage('ARCHIVE_CLOSE');
    await verified.handle.close();
    verified = undefined;
    return { database, replayedRequests, verifiedAt: new Date().toISOString(), activated: false };
  } catch (failure) {
    const safeFailure = safeRestoreFailure(stage, failure);
    if (restored) { await restored.end({ timeout: 3 }).catch(() => {}); restored = undefined; }
    if (created) {
      try {
        // This identifier was generated here and CREATE succeeded in this call.
        await owner.unsafe(`DROP DATABASE ${quotedDatabase} WITH (FORCE)`);
      } catch {
        const error = new Error(`Sanitized restore failed at ${safeFailure.stage}; quarantine cleanup requires protected operator review: ${database}`);
        error.code = 'RESTORE_QUARANTINE_CLEANUP_FAILED';
        error.database = database;
        error.stage = safeFailure.stage;
        if (safeFailure.blockerCodes) error.blockerCodes = safeFailure.blockerCodes;
        throw error;
      }
    }
    throw safeFailure;
  } finally {
    if (verified) await verified.handle.close().catch(() => {});
    if (restored) await restored.end({ timeout: 3 }).catch(() => {});
    if (owner) await owner.end({ timeout: 3 }).catch(() => {});
  }
}
