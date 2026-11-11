import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { runPrivacyOperation } from '../scripts/privacy-operator.mjs';
import { accountKey, newAccountCase, readAccountCase, saveAccountCase } from '../scripts/privacy/lib/case-store.mjs';
import { digest, writeOperation } from '../scripts/privacy/lib/operator-files.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const REVIEW = 'request-authority-retention-and-deadline';
const ENVIRONMENT = ['PRIVACY_OPERATIONS_DIR','PRIVACY_TEST_BACKUP_DIR','PRIVACY_OPERATOR_LOCKED','PRIVACY_OPERATOR_APP_STOPPED','PRIVACY_OPERATOR_IMAGE_ID'];

/** Full operator exercise, confined to synthetic PostgreSQL and temporary files. */
export async function runPrivacyOperatorIntegration({ t, sql, privacy }) {
  assert.equal(process.env.COLONY_TEST_DATABASE,'1');
  const originalUrl = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(originalUrl.hostname));
  assert.match(originalUrl.pathname,/^\/colony_(ci|test)$/);
  assert.ok(privacy && /^[a-f0-9]{64}$/.test(privacy.secret || ''));
  assert.ok(process.env.ACCOUNT_ERASURE_SECRET===privacy.secret,'The operator must use the same isolated test ledger secret');
  assert.equal(path.resolve(process.env.ACCOUNT_CLOSURE_DIR || ''),path.resolve(privacy.directory));
  const privacyRelative=path.relative(path.resolve(os.tmpdir()),path.resolve(privacy.directory));
  assert.ok(privacyRelative && privacyRelative!=='..' && !privacyRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(privacyRelative),'Production privacy directories are forbidden');
  const [role]=await sql`SELECT r.rolsuper OR r.rolcreatedb AS can_create_database,
    current_user=pg_get_userbyid(d.datdba) AS owns_source_database
    FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`;
  assert.equal(role.can_create_database,true,'The isolated operator test needs CREATEDB to verify restoration');
  assert.equal(role.owns_source_database,true,'Sanitized restoration requires the isolated source database owner, not only a superuser connection');
  const originalSettings=await sql`SELECT setting_key,value FROM system_settings WHERE setting_key IN ('maintenance','beta_required')`;
  const originalFlags=await sql`SELECT flag_key,enabled,rollout_percent FROM feature_flags WHERE flag_key IN ('notifications','stars_shop')`;
  assert.equal(originalFlags.length,2);
  assert.equal(originalSettings.length,2);

  const root=await fs.mkdtemp(path.join(os.tmpdir(),'colony-privacy-operator-'));
  const canonical=await fs.realpath(root);
  assert.match(path.basename(canonical),/^colony-privacy-operator-/);
  const operations=path.join(canonical,'operations');
  const backups=path.join(canonical,'backups');
  await fs.mkdir(operations,{mode:0o700});await fs.mkdir(backups,{mode:0o700});
  const savedEnvironment=Object.fromEntries(ENVIRONMENT.map(name=>[name,process.env[name]]));
  Object.assign(process.env,{
    PRIVACY_OPERATIONS_DIR:operations,PRIVACY_TEST_BACKUP_DIR:backups,
    PRIVACY_OPERATOR_LOCKED:'1',PRIVACY_OPERATOR_APP_STOPPED:'1',
    PRIVACY_OPERATOR_IMAGE_ID:'sha256:'+'a'.repeat(64),
  });
  const fixtures=[];
  const quarantineDatabases=[];
  let target,other,record,planResult,oldBackup,cleanBackup,retirement,retired,template;
  let otherState;

  async function fixture() {
    const telegramId=crypto.randomInt(760_000_000_000,769_999_999_999);
    const suffix=crypto.randomBytes(6).toString('hex');
    const [user]=await sql`INSERT INTO users(telegram_id,first_name,username,colony_name,profile_bio,bot_write_allowed)
      VALUES(${telegramId},'Synthetic operator fixture',${`operator_${suffix}`},${`Op_${suffix}`},${`private_${suffix}`},false) RETURNING id`;
    const result={id:user.id,telegramId};fixtures.push(result);
    await sql`INSERT INTO game_states(user_id,credits,crystals,last_tick_at) VALUES(${user.id},12007,87,now()+interval '1 day')`;
    await sql`INSERT INTO notification_preferences(user_id,enabled) VALUES(${user.id},false)`;
    return result;
  }
  async function privateDocument(filename) {
    assert.equal(path.dirname(path.resolve(filename)),operations);
    const envelope=JSON.parse(await fs.readFile(filename,'utf8'));
    assert.equal(envelope.value.version,1);
    return envelope.value;
  }
  async function snapshot(fixtureUser) {
    return plain({user:await sql`SELECT * FROM users WHERE id=${fixtureUser.id}`,
      state:await sql`SELECT * FROM game_states WHERE user_id=${fixtureUser.id}`,
      preferences:await sql`SELECT * FROM notification_preferences WHERE user_id=${fixtureUser.id}`});
  }
  const operation = (...args) => runPrivacyOperation(args);
  async function exists(filename) {try {await fs.access(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
  async function backupSnapshot() {
    const result={};
    for(const name of (await fs.readdir(backups)).sort()) {
      const bytes=await fs.readFile(path.join(backups,name));
      result[name]={size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    }
    return result;
  }
  function quarantineName(name) {
    assert.equal(typeof name,'string');
    assert.match(name,/^colony_privacy_(?:restore|quarantine)_[a-f0-9]{8,32}$/);
    assert.notEqual(name,originalUrl.pathname.slice(1));
    return '"'+name+'"';
  }

  try {
    await sql`UPDATE system_settings SET value='{"enabled":true,"message":"Synthetic operator integration"}'::jsonb WHERE setting_key='maintenance'`;
    await sql`UPDATE feature_flags SET enabled=false WHERE flag_key IN ('notifications','stars_shop')`;
    assert.equal(Number((await sql`SELECT count(*) AS n FROM feature_flag_overrides WHERE enabled=true AND flag_key IN ('notifications','stars_shop')`)[0].n),0,'No enabled sensitive override may be hidden by the test');
    target=await fixture();other=await fixture();
    await sql`INSERT INTO account_ownership_proofs(user_id,token_hash,expires_at)
      VALUES(${other.id},${crypto.randomBytes(32).toString('hex')},now()+interval '1 day')`;
    otherState=plain((await sql`SELECT * FROM game_states WHERE user_id=${other.id}`)[0]);
    record=await saveAccountCase(newAccountCase(accountKey(target.telegramId),target.id),'self_closure_requested',{
      authentication:'fresh_signed_telegram',instruction:'close_account_and_request_erasure',synthetic:true,
    });

    await t.test('operator planning is non-destructive and unreviewed or stale confirmations cannot erase an account',async()=>{
      const before=await snapshot(target);
      planResult=await operation('plan','--request',record.id,'--deadline',new Date(Date.now()+2*86400_000).toISOString());
      assert.equal(planResult.ok,true);assert.equal(planResult.destructive,false);
      assert.deepEqual(planResult.blockers,[]);
      const planned=(await privateDocument(planResult.plan)).content;
      assert.equal(planned.requestId,record.id);assert.equal(planned.inspection.exists,true);
      assert.equal(typeof planResult.planDigest,'string');
      process.env.PRIVACY_OPERATOR_LOCKED='0';
      try {await assert.rejects(operation('plan','--request',record.id));}
      finally {process.env.PRIVACY_OPERATOR_LOCKED='1';}
      await assert.rejects(operation('erase-active','--plan',planResult.plan,'--confirm','ERASE ACTIVE WRONG','--reviewed',REVIEW));
      await assert.rejects(operation('erase-active','--plan',planResult.plan,'--confirm',`ERASE ACTIVE ${planResult.planDigest}`,'--reviewed','not-reviewed'));
      const unclassified=await operation('plan','--request',record.id);
      await assert.rejects(operation('erase-active','--plan',unclassified.plan,'--confirm',`ERASE ACTIVE ${unclassified.planDigest}`,'--reviewed',REVIEW));
      process.env.PRIVACY_OPERATOR_IMAGE_ID='sha256:'+'b'.repeat(64);
      try {await assert.rejects(operation('erase-active','--plan',planResult.plan,'--confirm',`ERASE ACTIVE ${planResult.planDigest}`,'--reviewed',REVIEW));}
      finally {process.env.PRIVACY_OPERATOR_IMAGE_ID='sha256:'+'a'.repeat(64);}
      process.env.PRIVACY_OPERATOR_APP_STOPPED='0';
      try {await assert.rejects(operation('erase-active','--plan',planResult.plan,'--confirm',`ERASE ACTIVE ${planResult.planDigest}`,'--reviewed',REVIEW));}
      finally {process.env.PRIVACY_OPERATOR_APP_STOPPED='1';}
      assert.deepEqual(await snapshot(target),before);
      assert.equal((await readAccountCase(record.accountKey)).status,'requested');
    });

    await t.test('an interrupted erasure blocks every copy operation without touching archives, databases or active player data',async()=>{
      const beforeBackups=await backupSnapshot();
      const beforeOperations=(await fs.readdir(operations)).sort();
      const beforeDatabases=plain(await sql`SELECT datname FROM pg_database WHERE datname LIKE 'colony_privacy_%' ORDER BY datname`);
      const beforeTarget=await snapshot(target);
      const beforeOther=await snapshot(other);
      const interrupted=await saveAccountCase({
        ...newAccountCase(accountKey(other.telegramId),other.id),executionStartedAt:new Date().toISOString(),
      },'active_erasure_started',{synthetic:true,simulatedInterruptedExecution:true});
      try {
        const rejection=/Interrupted account erasure requires operator reconciliation before copy operations/;
        await assert.rejects(operation('backup'),rejection);
        await assert.rejects(operation('restore-sanitized','--archive',path.join(backups,'never-created.dump'),'--sha256','0'.repeat(64)),rejection);
        await assert.rejects(operation('retirement-plan','--replacement',path.join(operations,'never-created-verification.json')),rejection);
        await assert.rejects(operation('retire-backups','--plan',path.join(operations,'never-created-plan.json'),'--confirm','RETIRE synthetic'),rejection);
        assert.deepEqual(await backupSnapshot(),beforeBackups);
        assert.deepEqual((await fs.readdir(operations)).sort(),beforeOperations);
        assert.deepEqual(plain(await sql`SELECT datname FROM pg_database WHERE datname LIKE 'colony_privacy_%' ORDER BY datname`),beforeDatabases);
        assert.deepEqual(await snapshot(target),beforeTarget);
        assert.deepEqual(await snapshot(other),beforeOther);
        assert.equal((await readAccountCase(interrupted.accountKey)).executionStartedAt,interrupted.executionStartedAt);
      } finally {
        // Synthetic fixture only: record the deliberate reconciliation, retaining
        // the interruption event and signed journal history. Production requires
        // an operator to establish whether the database commit actually happened.
        const reconciled=await saveAccountCase({...interrupted,status:'cancelled',executionStartedAt:undefined},
          'synthetic_interruption_reconciled',{synthetic:true,activeDataUnchanged:true});
        assert.ok(reconciled.events.some(event=>event.action==='active_erasure_started'));
        assert.equal((await readAccountCase(interrupted.accountKey)).status,'cancelled');
      }
    });

    await t.test('a pre-erasure PostgreSQL backup is fully restored and verified before it becomes the dirty historical fixture',async()=>{
      assert.equal((await sql`SELECT 1 FROM users WHERE id=${target.id}`).length,1);
      oldBackup=await operation('backup');
      assert.equal(oldBackup.ok,true);assert.equal(oldBackup.restoreVerified,true);
      assert.equal(path.dirname(oldBackup.backup),backups);
      const proof=(await privateDocument(oldBackup.verification)).content;
      assert.equal(proof.restoreVerified,true);
      assert.equal(proof.erasedRequestIds.includes(record.id),false);
      assert.ok(proof.tables.users.count>=2);
      assert.ok(await exists(oldBackup.backup));
      assert.ok(await exists(oldBackup.backup+'.sha256'));
      assert.equal((await sql`SELECT 1 FROM users WHERE id=${target.id}`).length,1);
    });

    await t.test('reviewed active erasure records its pending-copy stage and creates unsigned evidence without changing another player',async()=>{
      const erased=await operation('erase-active','--plan',planResult.plan,'--confirm',`ERASE ACTIVE ${planResult.planDigest}`,'--reviewed',REVIEW);
      assert.equal(erased.ok,true);assert.equal(erased.status,'copies_pending');assert.equal(erased.copiesCompleted,false);
      assert.equal((await sql`SELECT 1 FROM users WHERE id=${target.id}`).length,0);
      assert.equal((await sql`SELECT 1 FROM game_states WHERE user_id=${target.id}`).length,0);
      assert.deepEqual(plain((await sql`SELECT * FROM game_states WHERE user_id=${other.id}`)[0]),otherState);
      record=await readAccountCase(record.accountKey);
      assert.equal(record.status,'copies_pending');
      assert.ok(record.events.some(event=>event.action==='active_data_erased'));
      const exported=(await privateDocument(erased.eventExport)).content;
      assert.equal(exported.requestId,record.id);assert.equal(exported.status,'copies_pending');
      assert.ok(exported.events.some(event=>event.action==='active_data_erased'));
      assert.equal(JSON.stringify(exported).includes(String(target.telegramId)),false);
      assert.match(await fs.readFile(erased.actDraft,'utf8'),/НЕ ПОДПИСАН/);
      assert.ok(await exists(oldBackup.backup),'Active SQL erasure must not silently remove historical backups');
    });

    await t.test('restoring the historical archive sanitizes the closed identity into a new quarantined database and never activates it',async()=>{
      const proof=(await privateDocument(oldBackup.verification)).content;
      const restored=await operation('restore-sanitized','--archive',oldBackup.backup,'--sha256',proof.sha256);
      assert.equal(restored.ok,true);assert.equal(restored.activated,false);
      quarantineName(restored.database);
      quarantineDatabases.push(restored.database);
      const copyUrl=new URL(originalUrl);copyUrl.pathname='/'+restored.database;
      const copied=postgres(copyUrl.toString(),{max:1,connect_timeout:5,onnotice(){}});
      try {
        assert.equal((await copied`SELECT 1 FROM users WHERE id=${target.id} OR telegram_id=${target.telegramId}`).length,0);
        assert.deepEqual(plain((await copied`SELECT * FROM game_states WHERE user_id=${other.id}`)[0]),otherState);
        assert.equal((await copied`SELECT revoked_at FROM account_ownership_proofs WHERE user_id=${other.id}`)[0]?.revoked_at instanceof Date,true,'The restored active support proof must be revoked before any activation');
        assert.equal((await copied`SELECT value->>'enabled' AS enabled FROM system_settings WHERE setting_key='maintenance'`)[0].enabled,'true');
        assert.equal(Number((await copied`SELECT count(*) AS n FROM feature_flags WHERE flag_key IN ('notifications','stars_shop') AND enabled=false`)[0].n),2);
        assert.equal(Number((await copied`SELECT count(*) AS n FROM feature_flag_overrides WHERE enabled=true AND flag_key IN ('notifications','stars_shop')`)[0].n),0);
      } finally {await copied.end({timeout:2});}
      const report=(await privateDocument(restored.report)).content;
      assert.equal(report.database,restored.database);
      assert.ok(report.replayedRequests.includes(record.id),'The historical snapshot must actually replay this erased identity');
      assert.ok(await exists(oldBackup.backup),'Sanitizing a restored copy must not silently retire its source');
      assert.equal((await sql`SELECT 1 FROM users WHERE id=${other.id}`).length,1);
    });

    await t.test('a clean fully restored replacement covers the erased case and a bad retirement confirmation changes no archive',async()=>{
      cleanBackup=await operation('backup');
      const proof=(await privateDocument(cleanBackup.verification)).content;
      assert.equal(proof.restoreVerified,true);assert.ok(proof.erasedRequestIds.includes(record.id));
      assert.equal(proof.tables.users.count,(await privateDocument(oldBackup.verification)).content.tables.users.count-1);
      retirement=await operation('retirement-plan','--replacement',cleanBackup.verification);
      assert.equal(retirement.ok,true);assert.equal(retirement.destructive,false);
      assert.equal(retirement.replacement,cleanBackup.backup);
      assert.ok(retirement.files.some(item=>item.path===oldBackup.backup));
      assert.equal(retirement.files.some(item=>item.path===cleanBackup.backup),false);
      const before=await backupSnapshot();
      await assert.rejects(operation('retire-backups','--plan',retirement.plan,'--confirm','RETIRE WRONG'));
      assert.deepEqual(await backupSnapshot(),before);
      assert.equal((await readAccountCase(record.accountKey)).status,'copies_pending');
    });

    await t.test('an exact reviewed retirement removes only listed generated archives and keeps the replacement and unlisted file',async()=>{
      const unlisted=path.join(backups,'unlisted-synthetic-fixture.dump');
      const bytes=Buffer.from('Synthetic unlisted bytes, never a real database');
      await fs.writeFile(unlisted,bytes,{flag:'wx',mode:0o600});
      retired=await operation('retire-backups','--plan',retirement.plan,'--confirm',retirement.confirmation);
      assert.equal(retired.ok,true);assert.equal(retired.otherCopiesCompleted,false);
      assert.equal(retired.count,retirement.files.length);
      for(const item of retirement.files) assert.equal(await exists(item.path),false);
      assert.ok(await exists(cleanBackup.backup));assert.ok(await exists(cleanBackup.backup+'.sha256'));
      assert.deepEqual(await fs.readFile(unlisted),bytes);
      const receipt=(await privateDocument(retired.receipt)).content;
      assert.equal(receipt.scope,'listed-backup-files-only');
      assert.equal(receipt.count,retirement.files.length);
      assert.equal((await readAccountCase(record.accountKey)).status,'copies_pending');
    });

    await t.test('a completion template, unresolved copy scope or missing signature review cannot claim complete erasure',async()=>{
      template=await operation('completion-template','--request',record.id);
      assert.equal(template.ok,true);assert.equal(template.completed,false);
      const draft=(await privateDocument(template.template)).content;
      assert.equal(draft.signatureReviewedByOperator,false);
      assert.ok(draft.scopes.every(scope=>scope.status==='NOT_REVIEWED'));
      await assert.rejects(operation('complete','--review',template.template,'--confirm',`COMPLETE ${record.id}`));
      const unsignedReview={...plain(draft),scopes:draft.scopes.map(scope=>({
        ...scope,status:'verified_absent',evidenceRef:scope.kind==='server_backups'?retired.receipt:'synthetic-review-only',
      })),signatureReviewedByOperator:false};
      const unsignedPath=path.join(operations,`unsigned-review-${crypto.randomUUID()}.json`);
      await fs.writeFile(unsignedPath,JSON.stringify(unsignedReview),{flag:'wx',mode:0o600});
      await assert.rejects(operation('complete','--review',unsignedPath,'--confirm',`COMPLETE ${record.id}`));
      const unresolvedReview={...plain(unsignedReview),signatureReviewedByOperator:true,
        scopes:unsignedReview.scopes.map(scope=>scope.kind==='local_dumps'?{...scope,status:'NOT_REVIEWED'}:scope)};
      const unresolvedPath=path.join(operations,`unresolved-review-${crypto.randomUUID()}.json`);
      await fs.writeFile(unresolvedPath,JSON.stringify(unresolvedReview),{flag:'wx',mode:0o600});
      await assert.rejects(operation('complete','--review',unresolvedPath,'--confirm',`COMPLETE ${record.id}`));
      const missingActPath=path.join(operations,`missing-act-review-${crypto.randomUUID()}.json`);
      await fs.writeFile(missingActPath,JSON.stringify({...plain(unsignedReview),signatureReviewedByOperator:true}),{flag:'wx',mode:0o600});
      await assert.rejects(operation('complete','--review',missingActPath,'--confirm',`COMPLETE ${record.id}`));
      assert.equal((await readAccountCase(record.accountKey)).status,'copies_pending');
      assert.deepEqual(plain((await sql`SELECT * FROM game_states WHERE user_id=${other.id}`)[0]),otherState);
    });

    await t.test('completion rejects missing, malformed or earlier signed retirement times and missing erasure chronology',async()=>{
      const sourceReceipt=(await privateDocument(retired.receipt)).content;
      const draft=(await privateDocument(template.template)).content;
      const originalErasedAt=record.activeDataErasedAt;
      async function rejectedReview(current,receiptPath) {
        const review={...plain(draft),caseDigest:digest(current),signatureReviewedByOperator:true,
          scopes:draft.scopes.map(scope=>({...scope,status:'verified_absent',
            evidenceRef:scope.kind==='server_backups'?receiptPath:'synthetic-reviewed-scope'}))};
        const reviewPath=path.join(operations,`invalid-chronology-review-${crypto.randomUUID()}.json`);
        await fs.writeFile(reviewPath,JSON.stringify(review),{flag:'wx',mode:0o600});
        await assert.rejects(operation('complete','--review',reviewPath,'--confirm',`COMPLETE ${current.id}`),/Backup retirement does not cover this erasure/);
        assert.equal((await readAccountCase(current.accountKey)).status,'copies_pending');
      }
      for(const completedAt of [undefined,'not-a-date','2026-02-30T12:00:00.000Z',new Date(Date.parse(originalErasedAt)-1).toISOString()]) {
        const invalidReceipt=await writeOperation('retirement-receipt',{...sourceReceipt,completedAt});
        await rejectedReview(record,invalidReceipt.filename);
      }
      try {
        for(const activeDataErasedAt of [undefined,'not-a-date']) {
          record=await saveAccountCase({...record,activeDataErasedAt},'synthetic_invalid_chronology',{synthetic:true});
          await rejectedReview(record,retired.receipt);
        }
      } finally {
        record=await saveAccountCase({...record,activeDataErasedAt:originalErasedAt},'synthetic_chronology_reconciled',{synthetic:true});
      }
      assert.equal((await readAccountCase(record.accountKey)).activeDataErasedAt,originalErasedAt);
      assert.deepEqual(plain((await sql`SELECT * FROM game_states WHERE user_id=${other.id}`)[0]),otherState);
    });
  } finally {
    const cleanupFailures=[];
    for(const name of quarantineDatabases) {
      // Only a freshly returned name from this test's restore call is eligible.
      try {await sql.unsafe(`DROP DATABASE ${quarantineName(name)}`);} catch {cleanupFailures.push('quarantine database');}
    }
    try {if(fixtures.length) await sql`DELETE FROM users WHERE telegram_id=ANY(${sql.array(fixtures.map(item=>item.telegramId))}::bigint[])`;} catch {cleanupFailures.push('synthetic users');}
    for(const setting of originalSettings) {
      try {await sql`UPDATE system_settings SET value=${sql.json(setting.value)} WHERE setting_key=${setting.setting_key}`;} catch {cleanupFailures.push('system setting');}
    }
    for(const flag of originalFlags) {
      try {await sql`UPDATE feature_flags SET enabled=${flag.enabled},rollout_percent=${flag.rollout_percent} WHERE flag_key=${flag.flag_key}`;} catch {cleanupFailures.push('feature flag');}
    }
    for(const name of ENVIRONMENT) {
      if(savedEnvironment[name]===undefined)delete process.env[name];else process.env[name]=savedEnvironment[name];
    }
    // The ledger remains in the parent's unique test store until its app stops.
    // This private subtree contains only operation files and synthetic backups.
    assert.equal(await fs.realpath(root),canonical);
    assert.match(path.basename(canonical),/^colony-privacy-operator-/);
    await fs.rm(canonical,{recursive:true,force:true});
    assert.equal(cleanupFailures.length,0,'Operator integration cleanup needs review');
  }
}
