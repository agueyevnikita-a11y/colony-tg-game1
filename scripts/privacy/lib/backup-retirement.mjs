import crypto from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ROOT = '/var/backups/colony';
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ITEMS = 100_000;

export class BackupRetirementError extends Error {
  constructor(code, completedPaths = []) {
    super(code);
    this.name = 'BackupRetirementError';
    this.code = code;
    this.completedPaths = [...completedPaths];
    this.count = this.completedPaths.length;
    this.recordedAt = new Date().toISOString();
  }
}

const fail = code => { throw new BackupRetirementError(code); };
const samePath = (left, right) => process.platform === 'win32'
  ? path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
  : path.normalize(left) === path.normalize(right);
const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;
const sortText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) fail('INVALID_DOCUMENT');
}

function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value)
    || value.split(/[\\/]+/).some(part => part === '..' || part === '.')) fail('INVALID_PATH');
  const resolved = path.resolve(value);
  // Windows permits drive-relative rooted paths; require a complete root.
  if (process.platform === 'win32' && !/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/.test(value)) fail('INVALID_PATH');
  return resolved;
}

function rootPath(value) {
  const root = absolute(value);
  if (samePath(path.dirname(root), root)) fail('BACKUP_ROOT_TOO_BROAD');
  return root;
}

function artifactPath(value, root) {
  const file = absolute(value);
  if (!samePath(path.dirname(file), root)) fail('ARTIFACT_OUTSIDE_ROOT');
  return file;
}

function iso(value) {
  if (typeof value !== 'string') fail('INVALID_DATE');
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) fail('INVALID_DATE');
  const normalized = `${match[1]}.${(match[2] || '').padEnd(3, '0')}Z`;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) fail('INVALID_DATE');
  return normalized;
}

function requests(value) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS
    || value.some(id => typeof id !== 'string' || !id || id.length > 200
      || id !== id.trim() || /[\u0000-\u001f\u007f]/.test(id))) fail('INVALID_REQUEST_IDS');
  const ids = [...value].sort(sortText);
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_REQUEST_IDS');
  return ids;
}

function fileMetadata(value, root) {
  if (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)
    || !Number.isSafeInteger(value.size) || value.size < 0) fail('INVALID_FILE_METADATA');
  return { path: artifactPath(value.path, root), sha256: value.sha256, size: value.size };
}

function replacementDocument(value, root, requiredIds) {
  object(value, ['path', 'sha256', 'size', 'restoreVerified', 'erasedRequestIds', 'verifiedAt']);
  const file = fileMetadata(value, root);
  if (!file.path.endsWith('.dump') || value.restoreVerified !== true) fail('REPLACEMENT_NOT_RESTORE_VERIFIED');
  const erasedRequestIds = requests(value.erasedRequestIds);
  const erasedSet = new Set(erasedRequestIds);
  if (requiredIds.some(id => !erasedSet.has(id))) fail('REPLACEMENT_MISSING_REQUESTS');
  return { ...file, restoreVerified: true, erasedRequestIds, verifiedAt: iso(value.verifiedAt) };
}

function kindFor(file) {
  if (file.endsWith('.dump.partial')) return 'partial';
  if (file.endsWith('.dump')) return 'dump';
  if (file.endsWith('.sha256')) return 'checksum';
  return null;
}

function excludedPaths(replacement) {
  return new Set([replacement.path, `${replacement.path}.sha256`, `${replacement.path}.privacy.json`].map(pathKey));
}

function artifactDocument(value, root) {
  object(value, ['path', 'size', 'sha256', 'modifiedAt', 'kind']);
  const file = fileMetadata(value, root);
  if (typeof value.kind !== 'string') fail('INVALID_ARTIFACT_KIND');
  return { path: file.path, size: file.size, sha256: file.sha256, modifiedAt: iso(value.modifiedAt), kind: value.kind };
}

function artifactList(values, root, replacement, excludeReplacement) {
  if (!Array.isArray(values) || values.length > MAX_ITEMS) fail('INVALID_ARTIFACT_LIST');
  const excluded = excludedPaths(replacement);
  const seen = new Set();
  const result = [];
  for (const input of values) {
    const artifact = artifactDocument(input, root);
    const key = pathKey(artifact.path);
    if (seen.has(key)) fail('DUPLICATE_ARTIFACT_PATH');
    seen.add(key);
    if (excluded.has(key)) {
      if (excludeReplacement) continue;
      fail('REPLACEMENT_INCLUDED_FOR_RETIREMENT');
    }
    const kind = kindFor(artifact.path);
    if (!kind || kind !== artifact.kind) fail('INVALID_ARTIFACT_KIND');
    result.push(artifact);
  }
  return result.sort((left, right) => sortText(left.path, right.path));
}

const digestOf = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Prepares data only. It neither checks the filesystem nor authorizes removal. */
export function prepareRetirement({ inventory, replacement, requiredRequestIds, backupRoot = DEFAULT_ROOT } = {}) {
  const root = rootPath(backupRoot);
  const ids = requests(requiredRequestIds);
  object(inventory, ['revision', 'root', 'generatedAt', 'artifacts']);
  if (inventory.revision !== 1 || !samePath(rootPath(inventory.root), root)) fail('INVENTORY_ROOT_MISMATCH');
  iso(inventory.generatedAt);
  const cleanReplacement = replacementDocument(replacement, root, ids);
  const unsigned = {
    version: 1,
    replacement: cleanReplacement,
    requiredRequestIds: ids,
    artifacts: artifactList(inventory.artifacts, root, cleanReplacement, true),
  };
  return { ...unsigned, digest: digestOf(unsigned) };
}

function validatedPlan(input, root) {
  object(input, ['version', 'replacement', 'requiredRequestIds', 'artifacts', 'digest']);
  if (input.version !== 1 || typeof input.digest !== 'string' || !SHA256.test(input.digest)) fail('INVALID_PLAN');
  const ids = requests(input.requiredRequestIds);
  const replacement = replacementDocument(input.replacement, root, ids);
  const unsigned = {
    version: 1, replacement, requiredRequestIds: ids,
    artifacts: artifactList(input.artifacts, root, replacement, false),
  };
  if (digestOf(unsigned) !== input.digest) fail('PLAN_DIGEST_MISMATCH');
  return { ...unsigned, digest: input.digest };
}

function unchanged(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs && before.nlink === after.nlink;
}

async function checkedRoot(root) {
  const stat = await fs.lstat(root, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await fs.realpath(root), root)) fail('UNSAFE_BACKUP_ROOT');
  return stat;
}

async function verifyNamedFile(file, handle, before) {
  const named = await fs.lstat(file, { bigint: true });
  const opened = await handle.stat({ bigint: true });
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n
    || !samePath(await fs.realpath(file), file)
    || !unchanged(before, named) || !unchanged(before, opened)) fail('ARTIFACT_CHANGED');
}

async function openVerified(metadata, handles) {
  const before = await fs.lstat(metadata.path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
    || !samePath(await fs.realpath(metadata.path), metadata.path)) fail('UNSAFE_ARTIFACT');
  if (before.size !== BigInt(metadata.size)) fail('ARTIFACT_SIZE_MISMATCH');
  if (metadata.modifiedAt && new Date(Number(before.mtimeMs)).toISOString() !== metadata.modifiedAt) fail('ARTIFACT_MTIME_MISMATCH');
  const handle = await fs.open(metadata.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  handles.push(handle);
  await verifyNamedFile(metadata.path, handle, before);
  const hash = crypto.createHash('sha256');
  let bytes = 0n;
  if (before.size > 0n) {
    for await (const chunk of handle.createReadStream({ start: 0, end: metadata.size - 1, autoClose: false })) {
      bytes += BigInt(chunk.length);
      hash.update(chunk);
    }
  }
  await verifyNamedFile(metadata.path, handle, before);
  if (bytes !== before.size || hash.digest('hex') !== metadata.sha256) fail('ARTIFACT_HASH_MISMATCH');
  return { metadata, handle, stat: before };
}

/**
 * Irreversibly unlinks only an approved, fully preflighted file list. The
 * caller must authenticate the plan/replacement, own data.lock and persist
 * retire_started intent first. The digest is not a signature or user consent.
 * This is not a filesystem transaction or proof that other copies are gone.
 */
export async function executeRetirement({ plan, confirmation, requiredRequestIds, backupRoot = DEFAULT_ROOT } = {}) {
  const completedPaths = [];
  const handles = [];
  let failure;
  let receipt;
  try {
    const root = rootPath(backupRoot);
    const checked = validatedPlan(plan, root);
    if (confirmation !== `RETIRE ${checked.digest}`) fail('CONFIRMATION_REQUIRED');
    const currentIds = requests(requiredRequestIds);
    if (JSON.stringify(currentIds) !== JSON.stringify(checked.requiredRequestIds)) fail('REQUIRED_REQUESTS_CHANGED');
    const rootStat = await checkedRoot(root);
    const replacement = await openVerified(checked.replacement, handles);
    const artifacts = [];
    for (const artifact of checked.artifacts) artifacts.push(await openVerified(artifact, handles));
    // Recheck EVERY target before the first unlink, including the replacement.
    await verifyNamedFile(replacement.metadata.path, replacement.handle, replacement.stat);
    for (const artifact of artifacts) await verifyNamedFile(artifact.metadata.path, artifact.handle, artifact.stat);
    if (!unchanged(rootStat, await checkedRoot(root))) fail('BACKUP_ROOT_CHANGED');

    for (const artifact of artifacts) {
      const currentRoot = await checkedRoot(root);
      if (currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino) fail('BACKUP_ROOT_CHANGED');
      await verifyNamedFile(replacement.metadata.path, replacement.handle, replacement.stat);
      await verifyNamedFile(artifact.metadata.path, artifact.handle, artifact.stat);
      await fs.unlink(artifact.metadata.path);
      completedPaths.push(artifact.metadata.path);
    }
    await verifyNamedFile(replacement.metadata.path, replacement.handle, replacement.stat);
    receipt = {
      version: 1, scope: 'listed-backup-files-only', planDigest: checked.digest,
      paths: [...completedPaths], count: completedPaths.length, completedAt: new Date().toISOString(),
    };
  } catch (error) {
    failure = new BackupRetirementError(error instanceof BackupRetirementError ? error.code : 'RETIREMENT_IO_FAILED', completedPaths);
  } finally {
    for (const handle of handles.reverse()) {
      try { await handle.close(); }
      catch { if (!failure) failure = new BackupRetirementError('RETIREMENT_HANDLE_CLOSE_FAILED', completedPaths); }
    }
  }
  if (failure) throw failure;
  return receipt;
}
