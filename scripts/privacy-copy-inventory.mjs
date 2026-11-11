import crypto from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ROOT = process.platform === 'win32'
  ? 'D:\\colony\\.local-data\\migration'
  : '/var/backups/colony';

export class CopyInventoryError extends Error {
  constructor(code) { super(code); this.name = 'CopyInventoryError'; this.code = code; }
}

const fail = code => { throw new CopyInventoryError(code); };
const samePath = (left, right) => process.platform === 'win32'
  ? path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
  : path.normalize(left) === path.normalize(right);

function artifactKind(name) {
  if (name.endsWith('.dump.partial')) return 'partial';
  if (name.endsWith('.dump')) return 'dump';
  if (name.endsWith('.sha256')) return 'checksum';
  return null;
}

function unchanged(before, after) {
  return before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeNs === after.mtimeNs
    && before.ctimeNs === after.ctimeNs && before.nlink === after.nlink;
}

async function inspectArtifact(root, name) {
  const file = path.join(root, name);
  if (!samePath(path.dirname(file), root)) fail('ARTIFACT_OUTSIDE_ROOT');
  const before = await fs.lstat(file, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) fail('ARTIFACT_NOT_REGULAR');
  if (before.nlink !== 1n) fail('ARTIFACT_HAS_MULTIPLE_LINKS');
  if (!samePath(await fs.realpath(file), file)) fail('ARTIFACT_LINK_REFUSED');
  if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) fail('ARTIFACT_SIZE_NOT_EXACT');

  // O_NOFOLLOW is available on Linux. The lstat/realpath/fstat checks also
  // protect platforms without that flag; no archive or checksum is parsed.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0);
  const handle = await fs.open(file, flags);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !unchanged(before, opened)
      || !samePath(await fs.realpath(file), file)) fail('ARTIFACT_CHANGED');
    const hash = crypto.createHash('sha256');
    let bytes = 0n;
    if (opened.size > 0n) {
      // Fix the end offset so a concurrently growing .partial cannot cause an
      // unbounded read. The final stat rejects every observed file change.
      for await (const chunk of handle.createReadStream({ start: 0, end: Number(opened.size) - 1, autoClose: false })) {
        bytes += BigInt(chunk.length);
        hash.update(chunk);
      }
    }
    const after = await handle.stat({ bigint: true });
    const namedAfter = await fs.lstat(file, { bigint: true });
    if (bytes !== opened.size || !unchanged(opened, after)
      || !unchanged(opened, namedAfter) || namedAfter.isSymbolicLink()
      || !samePath(await fs.realpath(file), file)) fail('ARTIFACT_CHANGED');
    return {
      path: file,
      size: Number(opened.size),
      sha256: hash.digest('hex'),
      modifiedAt: new Date(Number(opened.mtimeMs)).toISOString(),
      kind: artifactKind(name),
    };
  } finally { await handle.close(); }
}

/**
 * Read-only, one-level metadata catalogue. allowedRoots is injected only by
 * trusted callers/tests; the CLI has a fixed platform-specific allowlist.
 */
export async function inventoryBackupCopies({ root = DEFAULT_ROOT, allowedRoots = [DEFAULT_ROOT] } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)
    || !Array.isArray(allowedRoots) || !allowedRoots.some(allowed => typeof allowed === 'string'
      && path.isAbsolute(allowed) && samePath(path.resolve(root), path.resolve(allowed)))) fail('ROOT_NOT_ALLOWED');
  const resolved = path.resolve(root);
  const before = await fs.lstat(resolved, { bigint: true });
  if (before.isSymbolicLink() || !before.isDirectory()) fail('ROOT_NOT_DIRECTORY');
  const canonical = await fs.realpath(resolved);
  if (!samePath(canonical, resolved)) fail('ROOT_LINK_REFUSED');
  const names = (await fs.readdir(canonical)).filter(name => artifactKind(name)).sort();
  const artifacts = [];
  for (const name of names) artifacts.push(await inspectArtifact(canonical, name));
  const after = await fs.lstat(resolved, { bigint: true });
  const namesAfter = (await fs.readdir(canonical)).filter(name => artifactKind(name)).sort();
  if (after.isSymbolicLink() || !after.isDirectory() || !unchanged(before, after)
    || !samePath(await fs.realpath(resolved), canonical)
    || JSON.stringify(names) !== JSON.stringify(namesAfter)) fail('ROOT_CHANGED');
  return { revision: 1, root: canonical, generatedAt: new Date().toISOString(), artifacts };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`Usage: node scripts/privacy-copy-inventory.mjs [--root <allowed absolute path>]\nAllowed root on this platform: ${DEFAULT_ROOT}\nRead-only; one directory level; JSON metadata and streamed SHA-256 only.\n`);
    return;
  }
  if (!['win32', 'linux'].includes(process.platform)) fail('PLATFORM_NOT_SUPPORTED');
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--root')) fail('INVALID_ARGUMENTS');
  const result = await inventoryBackupCopies({ root: args.length ? args[1] : DEFAULT_ROOT });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    // Filesystem exceptions can expose unrelated paths; emit only our codes.
    const code = error instanceof CopyInventoryError ? error.code : 'READ_FAILED';
    process.stderr.write(`Backup inventory failed (${code}). No files were changed.\n`);
    process.exitCode = 1;
  });
}
