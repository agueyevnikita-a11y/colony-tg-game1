import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { restoreArchive } from '../scripts/privacy/lib/restored-copy.mjs';

const DATABASE_URL = 'postgres://synthetic:synthetic@localhost/colony_ci';
const DATABASE = 'colony_privacy_restore_0123456789abcdef';

async function archive(t, size) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'colony-restore-stream-'));
  const filename = path.join(directory, 'synthetic.dump');
  const bytes = Buffer.alloc(size, 0x61);
  await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o600 });
  const handle = await fs.open(filename, 'r');
  t.after(async () => {
    await handle.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^colony-restore-stream-/);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    filename, handle, stat: await handle.stat({ bigint: true }),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function syntheticTool(script) {
  return (binary, args, options) => {
    assert.equal(binary, 'pg_restore');
    return spawn(process.execPath, ['-e', script], options);
  };
}

async function run(fixture, script, stages = []) {
  await restoreArchive(fixture.handle, DATABASE_URL, DATABASE, fixture.sha256, fixture.stat,
    stage => stages.push(stage), syntheticTool(script));
}

for (const size of [1024, 8 * 1024 * 1024]) {
  test(`successful early stdin close preserves the pinned ${size}-byte archive descriptor`, async t => {
    const fixture = await archive(t, size);
    const stages = [];
    await run(fixture, "process.stdin.once('data',()=>process.exit(0));process.stdin.resume();", stages);
    assert.equal(stages.at(-1), 'ARCHIVE_RECHECK');
    assert.equal((await fixture.handle.stat({ bigint: true })).ino, fixture.stat.ino);
    const first = Buffer.alloc(1);
    assert.equal((await fixture.handle.read(first, 0, 1, 0)).bytesRead, 1);
    assert.equal(first[0], 0x61);
  });
}

test('a fully consumed archive succeeds after EOF without closing its descriptor', async t => {
  const fixture = await archive(t, 256 * 1024);
  await run(fixture, "process.stdin.resume();process.stdin.once('end',()=>process.exit(0));");
  assert.equal((await fixture.handle.stat({ bigint: true })).size, fixture.stat.size);
});

test('a nonzero restore exit rejects an early-closed archive and never exposes stderr', async t => {
  const fixture = await archive(t, 8 * 1024 * 1024);
  await assert.rejects(run(fixture, "process.stderr.write('SYNTHETIC_PRIVATE_DIAGNOSTIC');process.stdin.once('data',()=>process.exit(7));process.stdin.resume();"), error => {
    assert.equal(error.pgRestoreExitCode, 7);
    assert.equal(error.message.includes('SYNTHETIC_PRIVATE_DIAGNOSTIC'), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal((await fixture.handle.stat({ bigint: true })).size, fixture.stat.size);
});

test('an in-place change to already-read archive bytes fails after a successful tool exit', async t => {
  const fixture = await archive(t, 8 * 1024 * 1024);
  const filename = JSON.stringify(fixture.filename);
  const script = `process.stdin.once('data',()=>{const fs=require('node:fs');const fd=fs.openSync(${filename},'r+');fs.writeSync(fd,Buffer.from('b'),0,1,0);fs.closeSync(fd);process.exit(0);});process.stdin.resume();`;
  const stages = [];
  await assert.rejects(run(fixture, script, stages), error => {
    assert.equal(error.pgRestoreExitCode, 0);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(stages.at(-1), 'ARCHIVE_RECHECK');
  assert.equal((await fs.readFile(fixture.filename))[0], 0x62);
});
