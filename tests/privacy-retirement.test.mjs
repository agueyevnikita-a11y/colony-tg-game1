import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareRetirement, executeRetirement } from '../scripts/privacy/lib/backup-retirement.mjs';

const ids = ['ERASE-001', 'ERASE-002'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'colony-privacy-retirement-'));
  const canonical = await fs.realpath(directory);
  t.after(async () => {
    // Only this named synthetic fixture is ever recursively removed.
    assert.equal(await fs.realpath(directory), canonical);
    assert.match(path.basename(canonical), /^colony-privacy-retirement-/);
    await fs.rm(canonical, { recursive: true, force: true });
  });
  const root = path.join(directory, 'backups');
  await fs.mkdir(root);
  const names = ['old-a.dump', 'old-b.dump.sha256', 'old-c.dump.partial', 'clean.dump', 'clean.dump.sha256', 'clean.dump.privacy.json', 'unlisted.dump'];
  const files = Object.fromEntries(names.map(name => [name, path.join(root, name)]));
  // Whole-second fixture times survive utimes on both Linux and Windows without
  // a fractional-millisecond rounding change masking the hash-only assertion.
  const fixtureTime = new Date('2026-01-01T00:00:00.000Z');
  for (const name of names) {
    await fs.writeFile(files[name], `Synthetic bytes for ${name}`);
    await fs.utimes(files[name], fixtureTime, fixtureTime);
  }
  const metadata = async name => {
    const stat = await fs.stat(files[name], { bigint: true });
    return { path: files[name], size: Number(stat.size), sha256: sha(await fs.readFile(files[name])), modifiedAt: new Date(Number(stat.mtimeMs)).toISOString(),
      kind: name.endsWith('.privacy.json') ? 'privacy' : name.endsWith('.dump.partial') ? 'partial' : name.endsWith('.sha256') ? 'checksum' : 'dump' };
  };
  const inventory = { revision: 1, root, generatedAt: new Date().toISOString(), artifacts: await Promise.all(names.filter(name => name !== 'unlisted.dump').map(metadata)) };
  const clean = await metadata('clean.dump');
  const replacement = { path: clean.path, size: clean.size, sha256: clean.sha256, restoreVerified: true, erasedRequestIds: ['ERASE-000', ...ids], verifiedAt: new Date().toISOString() };
  const plan = prepareRetirement({ inventory, replacement, requiredRequestIds: ids, backupRoot: root });
  const execute = (extra = {}) => executeRetirement({ plan, confirmation: `RETIRE ${plan.digest}`, requiredRequestIds: ids, backupRoot: root, ...extra });
  const retained = async () => { for (const name of names) await fs.access(files[name]); };
  return { directory, root, files, inventory, replacement, plan, execute, retained };
}

test('retirement preserves the verified replacement, its sidecars and unlisted files', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.plan.artifacts.map(x => path.basename(x.path)), ['old-a.dump', 'old-b.dump.sha256', 'old-c.dump.partial']);
  const reordered = prepareRetirement({ inventory: { ...f.inventory, artifacts: [...f.inventory.artifacts].reverse() }, replacement: { ...f.replacement, erasedRequestIds: [...f.replacement.erasedRequestIds].reverse() }, requiredRequestIds: [...ids].reverse(), backupRoot: f.root });
  assert.equal(reordered.digest, f.plan.digest);
  const before = new Map(await Promise.all(['clean.dump', 'clean.dump.sha256', 'clean.dump.privacy.json', 'unlisted.dump'].map(async name => [name, await fs.readFile(f.files[name])])));
  const receipt = await f.execute({ requiredRequestIds: [...ids].reverse() });
  assert.equal(receipt.scope, 'listed-backup-files-only'); assert.equal(receipt.count, 3); assert.equal(receipt.planDigest, f.plan.digest);
  assert.deepEqual(receipt.paths, f.plan.artifacts.map(x => x.path)); assert.ok(Number.isFinite(Date.parse(receipt.completedAt)));
  for (const removed of receipt.paths) await assert.rejects(fs.access(removed), { code: 'ENOENT' });
  for (const [name, content] of before) assert.deepEqual(await fs.readFile(f.files[name]), content);
});

test('confirmation must exactly match the approved plan digest', async t => {
  const f = await fixture(t);
  for (const confirmation of ['RETIRE', `RETIRE ${f.plan.digest} `, `retire ${f.plan.digest}`]) {
    await assert.rejects(f.execute({ confirmation }), error => error.code === 'CONFIRMATION_REQUIRED' && error.completedPaths.length === 0);
  }
  await f.retained();
});

test('plan preparation rejects traversal, sibling-root escape and unknown artifact kinds', async t => {
  const f = await fixture(t);
  for (const badPath of [`${f.root}${path.sep}..${path.sep}outside.dump`, path.join(`${f.root}-other`, 'outside.dump')]) {
    const inventory = copy(f.inventory); inventory.artifacts[0].path = badPath;
    assert.throws(() => prepareRetirement({ inventory, replacement: f.replacement, requiredRequestIds: ids, backupRoot: f.root }));
  }
  const inventory = copy(f.inventory); inventory.artifacts[0].kind = 'arbitrary';
  assert.throws(() => prepareRetirement({ inventory, replacement: f.replacement, requiredRequestIds: ids, backupRoot: f.root }), { code: 'INVALID_ARTIFACT_KIND' });
  await f.retained();
});

test('tampered plans, duplicate paths and duplicate request IDs are rejected', async t => {
  const f = await fixture(t); const tampered = copy(f.plan); tampered.artifacts[0].sha256 = 'a'.repeat(64);
  await assert.rejects(f.execute({ plan: tampered }), error => error.code === 'PLAN_DIGEST_MISMATCH' && error.count === 0);
  const inventory = copy(f.inventory); inventory.artifacts.push(copy(inventory.artifacts[0]));
  assert.throws(() => prepareRetirement({ inventory, replacement: f.replacement, requiredRequestIds: ids, backupRoot: f.root }), { code: 'DUPLICATE_ARTIFACT_PATH' });
  assert.throws(() => prepareRetirement({ inventory: f.inventory, replacement: f.replacement, requiredRequestIds: [...ids, ids[0]], backupRoot: f.root }), { code: 'DUPLICATE_REQUEST_IDS' });
  await f.retained();
});

test('all target hashes are preflighted before any unlink', async t => {
  const f = await fixture(t); const target = f.files['old-c.dump.partial']; const stat = await fs.stat(target); const content = await fs.readFile(target);
  content[0] ^= 1; await fs.writeFile(target, content);
  const originalModifiedAt = f.plan.artifacts.find(artifact => artifact.path === target).modifiedAt;
  await fs.utimes(target, stat.atime, new Date(originalModifiedAt));
  await assert.rejects(f.execute(), error => error.code === 'ARTIFACT_HASH_MISMATCH' && error.count === 0 && error.completedPaths.length === 0);
  await f.retained();
});

test('mtime-only drift invalidates the inventory without deleting files', async t => {
  const f = await fixture(t); const target = f.files['old-a.dump']; const stat = await fs.stat(target);
  await fs.utimes(target, stat.atime, new Date(Date.parse(f.plan.artifacts.find(artifact => artifact.path === target).modifiedAt) + 1000));
  await assert.rejects(f.execute(), error => error.code === 'ARTIFACT_MTIME_MISMATCH' && error.count === 0);
  await f.retained();
});

test('replacement content is checked before retirement', async t => {
  const f = await fixture(t); const content = await fs.readFile(f.files['clean.dump']); content[0] ^= 1; await fs.writeFile(f.files['clean.dump'], content);
  await assert.rejects(f.execute(), error => error.code === 'ARTIFACT_HASH_MISMATCH' && error.count === 0);
  await f.retained();
});

test('a changed erasure request set invalidates the plan without deletion', async t => {
  const f = await fixture(t);
  for (const requiredRequestIds of [[...ids, 'ERASE-003'], [ids[0]]]) {
    await assert.rejects(f.execute({ requiredRequestIds }), error => error.code === 'REQUIRED_REQUESTS_CHANGED' && error.count === 0);
  }
  await f.retained();
});

test('replacement requires restore verification, all requests and valid UTC dates', async t => {
  const f = await fixture(t);
  for (const replacement of [{ ...f.replacement, restoreVerified: false }, { ...f.replacement, erasedRequestIds: [ids[0]] }, { ...f.replacement, verifiedAt: '2026-02-30T00:00:00Z' }]) {
    assert.throws(() => prepareRetirement({ inventory: f.inventory, replacement, requiredRequestIds: ids, backupRoot: f.root }));
  }
  await f.retained();
});

test('missing files fail preflight and preserve every remaining target', async t => {
  const f = await fixture(t); await fs.unlink(f.files['old-c.dump.partial']);
  await assert.rejects(f.execute(), error => error.count === 0);
  await fs.access(f.files['old-a.dump']); await fs.access(f.files['old-b.dump.sha256']); await fs.access(f.files['clean.dump']);
});

test('replacement and its protected sidecars cannot be injected into a plan', async t => {
  const f = await fixture(t); const tampered = copy(f.plan); tampered.artifacts.push(copy(f.inventory.artifacts.find(x => x.path === f.files['clean.dump'])));
  await assert.rejects(f.execute({ plan: tampered }), error => error.code === 'REPLACEMENT_INCLUDED_FOR_RETIREMENT' && error.count === 0);
  await f.retained();
});

test('hard-linked targets are refused when the platform permits fixture links', async t => {
  const f = await fixture(t); const target = f.files['old-a.dump']; const outside = path.join(f.directory, 'outside.bin');
  await fs.copyFile(target, outside); await fs.unlink(target);
  try { await fs.link(outside, target); } catch (error) { if (['EPERM', 'ENOSYS', 'ENOTSUP'].includes(error.code)) { t.skip('Fixture hard links unavailable'); return; } throw error; }
  await assert.rejects(f.execute(), error => error.code === 'UNSAFE_ARTIFACT' && error.count === 0);
  await fs.access(target); await fs.access(outside); await fs.access(f.files['old-b.dump.sha256']);
});

test('symbolic-linked targets are refused when the platform permits fixture links', async t => {
  const f = await fixture(t); const target = f.files['old-a.dump']; const outside = path.join(f.directory, 'outside.bin');
  await fs.copyFile(target, outside); await fs.unlink(target);
  try { await fs.symlink(outside, target, 'file'); } catch (error) { if (['EPERM', 'ENOSYS', 'ENOTSUP'].includes(error.code)) { t.skip('Fixture symbolic links unavailable'); return; } throw error; }
  await assert.rejects(f.execute(), error => error.code === 'UNSAFE_ARTIFACT' && error.count === 0);
  await fs.access(outside); await fs.access(f.files['old-b.dump.sha256']);
});

test('a linked backup root is refused before touching artifacts', async t => {
  const f = await fixture(t); const alias = path.join(f.directory, 'linked-backups');
  try { await fs.symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { if (['EPERM', 'ENOSYS', 'ENOTSUP'].includes(error.code)) { t.skip('Fixture directory links unavailable'); return; } throw error; }
  const inventory = copy(f.inventory); inventory.root = alias; for (const artifact of inventory.artifacts) artifact.path = path.join(alias, path.basename(artifact.path));
  const replacement = { ...f.replacement, path: path.join(alias, 'clean.dump') };
  const plan = prepareRetirement({ inventory, replacement, requiredRequestIds: ids, backupRoot: alias });
  await assert.rejects(executeRetirement({ plan, confirmation: `RETIRE ${plan.digest}`, requiredRequestIds: ids, backupRoot: alias }), error => error.code === 'UNSAFE_BACKUP_ROOT' && error.count === 0);
  await f.retained();
});

test('partial I/O failure reports only completed approved paths and hides raw exceptions', async t => {
  const f = await fixture(t); const original = fs.unlink; const denied = f.files['old-b.dump.sha256'];
  fs.unlink = async file => { if (file === denied) throw new Error('untrusted filesystem diagnostic'); return original(file); };
  try {
    await assert.rejects(f.execute(), error => {
      assert.equal(error.code, 'RETIREMENT_IO_FAILED'); assert.deepEqual(error.completedPaths, [f.files['old-a.dump']]); assert.equal(error.count, 1);
      assert.ok(!error.message.includes('untrusted')); return true;
    });
  } finally { fs.unlink = original; }
  await assert.rejects(fs.access(f.files['old-a.dump']), { code: 'ENOENT' });
  await fs.access(denied); await fs.access(f.files['old-c.dump.partial']); await fs.access(f.files['clean.dump']); await fs.access(f.files['unlisted.dump']);
});
