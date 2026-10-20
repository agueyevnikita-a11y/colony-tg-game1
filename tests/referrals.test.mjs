import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await fs.readFile(new URL('../lib/game/referrals.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { REFERRAL_BONUS, REFERRAL_QUALIFICATION_HQ, referralTelegramId, referralBonusForCount, referralRoadmapStatus } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('referral IDs are canonical positive Telegram IDs and exclude self-invites', () => {
  assert.equal(referralTelegramId('ref_1234567890123', 42), 1234567890123);
  for (const param of [undefined, '', 'ref_42', 'ref_0', 'ref_-1', 'ref_1.5', 'ref_01', 'ref_1e3', 'ref_0x20', 'ref_ 12', 'ref_12\n', 'ref_9007199254740992', 'ref_12?x=1', 'ally_12']) {
    assert.equal(referralTelegramId(param, 42), null, String(param));
  }
});

test('referral reward scales only with actual new receipts and rejects invalid counts', () => {
  assert.equal(REFERRAL_QUALIFICATION_HQ, 3);
  assert.deepEqual(REFERRAL_BONUS, { credits: 500, crystals: 10 });
  assert.deepEqual(referralBonusForCount(0), { credits: 0, crystals: 0 });
  assert.deepEqual(referralBonusForCount(3), { credits: 1500, crystals: 30 });
  for (const count of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => referralBonusForCount(count));
});

test('roadmap distinguishes locked, available achievements and completed automatic rewards', () => {
  const base = { count: 0, target: 3, received: false, requiresClaim: false };
  assert.equal(referralRoadmapStatus(base), 'locked');
  assert.equal(referralRoadmapStatus({ ...base, count: 3 }), 'pending', 'Do not claim an automatic reward was granted without a receipt');
  assert.equal(referralRoadmapStatus({ ...base, count: 3, received: true }), 'received');
  assert.equal(referralRoadmapStatus({ ...base, requiresClaim: true, unlocked: true }), 'available');
  assert.equal(referralRoadmapStatus({ ...base, requiresClaim: true, unlocked: true, received: true }), 'received');
});
