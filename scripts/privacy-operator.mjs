import './env.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { pathToFileURL } from 'node:url';
import { accountKey, initPrivacyStore, assertPrivacyStoreReady, privacyConfig, listAccountCases, readAccountCase, saveAccountCase } from './privacy/lib/case-store.mjs';
import { inspectAccountErasure, eraseAccountData } from './privacy/lib/account-erasure-data.mjs';
import { operationsDirectory, writeOperation, readOperation, digest, hashFile } from './privacy/lib/operator-files.mjs';
import { createVerifiedBackup } from './privacy/lib/verified-backup.mjs';
import { restoreSanitizedCopy } from './privacy/lib/restored-copy.mjs';
import { inventoryBackupCopies } from './privacy-copy-inventory.mjs';
import { prepareRetirement, executeRetirement } from './privacy/lib/backup-retirement.mjs';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ERASED=new Set(['active_data_erased','copies_pending','completed']);
const REQUIRED_SCOPES=['server_backups','local_dumps','restored_databases','railway','provider_copies_and_wal','support_and_diagnostics'];
function options(args) {
  const result={};
  for(let i=0;i<args.length;i+=2){if(!/^--[a-z][a-z0-9-]*$/.test(args[i])||args[i+1]===undefined||args[i+1].startsWith('--')||result[args[i]])throw new Error('Invalid operator arguments');result[args[i]]=args[i+1];}
  return result;
}
function requireOptions(opts,allowed) {if(Object.keys(opts).some(key=>!allowed.includes(key)))throw new Error('Unsupported operator option');}
function isoMillis(value) {
  const time=typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString()===value?time:NaN;
}
function connection() {
  const raw=process.env.DATABASE_URL||'';const url=new URL(raw);
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Invalid database');
  const test=process.env.COLONY_TEST_DATABASE==='1'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&/^\/colony_(ci|test)$/.test(url.pathname);
  if(!test&&(url.pathname!=='/colony'||decodeURIComponent(url.username)!=='colony'))throw new Error('Use the reviewed database-owner connection');
  return {raw,test,sql:postgres(raw,{max:1,connect_timeout:10,onnotice(){}})};
}
async function caseById(id) {if(!UUID.test(id||''))throw new Error('Invalid request identifier');const item=(await listAccountCases()).find(item=>item.id===id);if(!item)throw new Error('Closure request not found');return item;}
const admins=()=> (process.env.ADMIN_TELEGRAM_IDS||'').split(',').map(Number).filter(id=>Number.isSafeInteger(id)&&id>0);
async function erasedCases() {
  const cases=await listAccountCases();
  // The database commit and durable case update cannot be one transaction.
  // Never interpret an interrupted execution as an identity safe to restore.
  if(cases.some(item=>item.status==='requested'&&item.executionStartedAt))throw new Error('Interrupted account erasure requires operator reconciliation before copy operations');
  return cases.filter(item=>ERASED.has(item.status));
}
const erasedIds=async()=> (await erasedCases()).map(item=>item.id).sort();
function backupRoot(test) {
  if(test&&process.env.PRIVACY_TEST_BACKUP_DIR){const target=path.resolve(process.env.PRIVACY_TEST_BACKUP_DIR);return target;}
  return '/var/backups/colony';
}
async function requireStoppedAndClosed(sql) {
  if(process.env.PRIVACY_OPERATOR_APP_STOPPED!=='1')throw new Error('Use the host operator wrapper to stop the application before erasure');
  const rows=await sql`SELECT setting_key,value FROM system_settings WHERE setting_key IN ('maintenance','beta_required')`;
  if(rows.find(row=>row.setting_key==='maintenance')?.value?.enabled!==true)throw new Error('Reviewed maintenance window required');
  const flags=await sql`SELECT flag_key,enabled FROM feature_flags WHERE flag_key IN ('notifications','stars_shop')`;
  if(flags.length!==2||flags.some(row=>row.enabled!==false))throw new Error('Payments and notification delivery must be disabled');
  const [overrides]=await sql`SELECT count(*)::int AS n FROM feature_flag_overrides WHERE enabled=true AND flag_key IN ('notifications','stars_shop')`;
  if(overrides.n!==0)throw new Error('Sensitive feature overrides require review');
  const [active]=await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND usename='colony_app' AND state<>'idle' AND pid<>pg_backend_pid()`;
  if(active.n!==0)throw new Error('Application database operations have not drained');
}
async function validateCaseIdentity(sql,record) {
  const [user]=await sql`SELECT telegram_id FROM users WHERE id=${record.userId}`;
  if(user&&accountKey(Number(user.telegram_id))!==record.accountKey)throw new Error('Account and closure identity differ');
}
async function inspect(sql,record) {
  await validateCaseIdentity(sql,record);
  return sql.begin(async tx=>inspectAccountErasure(tx,record.userId,admins()));
}
async function writeEvidence(record) {
  const events=record.events.filter(event=>event.requestId===record.id);
  const exported=await writeOperation('event-export',{system:'COLONY',requestId:record.id,userId:record.userId,status:record.status,events,exportedAt:new Date().toISOString()});
  const directory=await operationsDirectory();
  const filename=path.join(directory,`act-draft-${exported.document.id}.md`);
  const text=`# ПРОЕКТ АКТА — НЕ ПОДПИСАН\n\nОператор: [ФИО и адрес]\nИсполнитель: [ФИО]\nИнформационная система: COLONY\nЗаявка: ${record.id}\nИдентификатор субъекта: ${record.userId}\nПричина: заявка участника о закрытии аккаунта и удалении данных.\n\nТекущий этап: ${record.status}.\nДата выгрузки: ${new Date().toISOString()}\n\nПриложена выгрузка системного журнала: ${path.basename(exported.filename)}. Категории, даты и способы фактически выполненных действий указаны в событиях.\n\nЭтот файл не подтверждает уничтожение всех копий. Перечень проверенных мест, фактический способ уничтожения и сохраняемый законный минимум оператор заполняет по результатам исполнения. Подпись на бумаге либо электронная подпись по законодательству об ЭП обязательна для готового акта.\n\nПодпись: [подпись и дата]\n`;
  await fs.writeFile(filename,text,{flag:'wx',mode:0o600});
  return {eventExport:exported.filename,actDraft:filename};
}

async function completionReview(filename) {
  const directory=await operationsDirectory();
  if(!path.isAbsolute(filename)||path.dirname(path.resolve(filename))!==directory)throw new Error('Completion review must stay in the private operations directory');
  const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>500_000)throw new Error('Invalid completion review file');
  const raw=JSON.parse(await fs.readFile(filename,'utf8'));
  // This is an operator-edited attestation, not an automatically verified claim.
  return raw.value?.kind==='completion-review'?raw.value.content:raw;
}
async function checkSignedAct(document) {
  const directory=await operationsDirectory();const filename=document?.filename;
  if(typeof filename!=='string'||!path.isAbsolute(filename)||path.dirname(path.resolve(filename))!==directory||!/^[a-f0-9]{64}$/.test(document.sha256||''))throw new Error('Signed act evidence required');
  const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size===0)throw new Error('Invalid signed act file');
  if((await hashFile(filename)).sha256!==document.sha256)throw new Error('Signed act file changed');
}

export async function runPrivacyOperation(args) {
  const [command,...rest]=args;const opts=options(rest);
  if(process.env.PRIVACY_OPERATOR_LOCKED!=='1')throw new Error('Use deploy/privacy-operator.sh; deployment and backup locks are required');
  if(command==='init') {
    requireOptions(opts,[]);const dir=process.env.PRIVACY_OPERATIONS_DIR||'';
    if(!path.isAbsolute(dir))throw new Error('Private operations directory required');
    await fs.mkdir(dir,{recursive:true,mode:0o700});await operationsDirectory();
    try {await assertPrivacyStoreReady();} catch {await initPrivacyStore();}
    return {ok:true,initialized:true};
  }
  await assertPrivacyStoreReady();
  const db=connection();
  try {
    if(command==='plan') {
      requireOptions(opts,['--request','--deadline']);const record=await caseById(opts['--request']);
      if(opts['--deadline']&&!Number.isFinite(Date.parse(opts['--deadline'])))throw new Error('Invalid reviewed statutory deadline');
      const inspection=await inspect(db.sql,record);
      const document={requestId:record.id,userId:record.userId,caseRevision:record.revision,caseDigest:digest(record),imageId:process.env.PRIVACY_OPERATOR_IMAGE_ID||null,inspection,deadlineAt:opts['--deadline']||null,copiesStatus:'not_reviewed',requiredReview:['request_authority','statutory_deadline','lawful_retained_subset','all_copy_locations']};
      const saved=await writeOperation('erasure-plan',document);
      return {ok:true,plan:saved.filename,planDigest:digest(document),blockers:inspection.blockers,destructive:false};
    }
    if(command==='erase-active') {
      requireOptions(opts,['--plan','--confirm','--reviewed']);
      const plan=(await readOperation(opts['--plan'],'erasure-plan')).content;
      if(opts['--confirm']!==`ERASE ACTIVE ${digest(plan)}`||opts['--reviewed']!=='request-authority-retention-and-deadline')throw new Error('Explicit reviewed plan confirmation required');
      if(!plan.deadlineAt||!Number.isFinite(Date.parse(plan.deadlineAt)))throw new Error('Classify and record the statutory deadline before execution');
      if(!plan.imageId||plan.imageId!==process.env.PRIVACY_OPERATOR_IMAGE_ID)throw new Error('The reviewed application image changed');
      await requireStoppedAndClosed(db.sql);
      let record=await caseById(plan.requestId);
      if(record.status!=='requested'||record.executionStartedAt||record.revision!==plan.caseRevision||digest(record)!==plan.caseDigest)throw new Error('Closure request changed; prepare a new plan');
      if(!record.events.some(event=>event.requestId===record.id&&event.action==='self_closure_requested'&&event.details?.instruction==='close_account_and_request_erasure'))throw new Error('A verified explicit subject instruction is required');
      const current=await inspect(db.sql,record);
      if(digest(current)!==digest(plan.inspection)||current.blockers.length||!current.exists)throw new Error('Plan changed or has blockers; manual review required');
      record=await saveAccountCase({...record,executionStartedAt:new Date().toISOString()},'active_erasure_started',{planDigest:digest(plan),operatorReview:'request-authority-retention-and-deadline'});
      const result=await db.sql.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy:${record.accountKey}`},0))`;
        await validateCaseIdentity(tx,record);
        const result=await eraseAccountData(tx,record.userId,admins());
        await tx`DELETE FROM api_rate_limits WHERE bucket_key=${`privacy-request:${record.accountKey}`}`;
        return result;
      });
      record=await saveAccountCase({...record,status:'copies_pending',activeDataErasedAt:new Date().toISOString()},'active_data_erased',{...result,method:'reviewed_transactional_SQL_erasure',copies:'pending'});
      const evidence=await writeEvidence(record);
      return {ok:true,status:record.status,...evidence,copiesCompleted:false};
    }
    if(command==='backup') {
      requireOptions(opts,[]);
      const replacement=await createVerifiedBackup({sql:db.sql,databaseUrl:db.raw,backupRoot:backupRoot(db.test),erasedCases:await erasedCases()});
      const saved=await writeOperation('verified-backup',replacement);
      return {ok:true,verification:saved.filename,backup:replacement.path,restoreVerified:true};
    }
    if(command==='retirement-plan') {
      requireOptions(opts,['--replacement']);const ids=await erasedIds();
      if(!ids.length)throw new Error('No executed erasure requires backup retirement');
      const verified=(await readOperation(opts['--replacement'],'verified-backup')).content;
      const replacement=Object.fromEntries(['path','sha256','size','restoreVerified','erasedRequestIds','verifiedAt'].map(key=>[key,verified[key]]));
      const root=backupRoot(db.test);const inventory=await inventoryBackupCopies({root,allowedRoots:[root]});
      const plan=prepareRetirement({inventory,replacement,requiredRequestIds:ids,backupRoot:root});
      const saved=await writeOperation('backup-retirement',{plan,imageId:process.env.PRIVACY_OPERATOR_IMAGE_ID||null});
      return {ok:true,plan:saved.filename,confirmation:`RETIRE ${plan.digest}`,files:plan.artifacts.map(item=>({path:item.path,size:item.size})),replacement:replacement.path,destructive:false};
    }
    if(command==='retire-backups') {
      requireOptions(opts,['--plan','--confirm']);
      const ids=await erasedIds();if(!ids.length)throw new Error('No active erasure requires retirement');
      const approved=(await readOperation(opts['--plan'],'backup-retirement')).content;
      if(!approved.imageId||approved.imageId!==process.env.PRIVACY_OPERATOR_IMAGE_ID)throw new Error('The reviewed backup worker image changed');
      const plan=approved.plan;
      if(opts['--confirm']!==`RETIRE ${plan.digest}`)throw new Error('Exact backup retirement confirmation required');
      const intent=await writeOperation('retirement-intent',{planDigest:plan.digest,artifacts:plan.artifacts,replacement:plan.replacement,requestIds:ids});
      try {
        const receipt=await executeRetirement({plan,confirmation:opts['--confirm'],requiredRequestIds:ids,backupRoot:backupRoot(db.test)});
        const saved=await writeOperation('retirement-receipt',{...receipt,intent:intent.filename});
        return {ok:true,receipt:saved.filename,count:receipt.count,otherCopiesCompleted:false};
      } catch(error) {
        await writeOperation('retirement-failure',{intent:intent.filename,completedPaths:error.completedPaths||[],code:error.code||'RETIREMENT_FAILED'});
        throw new Error('Backup retirement did not complete; inspect the protected partial receipt');
      }
    }
    if(command==='evidence') {requireOptions(opts,['--request']);return {ok:true,...await writeEvidence(await caseById(opts['--request']))};}
    if(command==='restore-sanitized') {
      requireOptions(opts,['--archive','--sha256']);
      const result=await restoreSanitizedCopy({databaseUrl:db.raw,archive:opts['--archive'],expectedSha256:opts['--sha256'],erasedCases:await erasedCases(),adminTelegramIds:admins(),backupRoot:backupRoot(db.test)});
      const saved=await writeOperation('sanitized-restore',result);
      return {ok:true,report:saved.filename,database:result.database,activated:false};
    }
    if(command==='completion-template') {
      requireOptions(opts,['--request']);const record=await caseById(opts['--request']);
      const saved=await writeOperation('completion-review',{requestId:record.id,caseDigest:digest(record),scopes:REQUIRED_SCOPES.map(kind=>({kind,status:'NOT_REVIEWED',evidenceRef:''})),signatureReviewedByOperator:false,signedAct:{filename:'',sha256:''},lawfulRetained:[{category:'erasure_evidence',basis:'RKN_Order_179',period:'3_years_from_destruction'}]});
      return {ok:true,template:saved.filename,completed:false,note:'Prepare a separately reviewed completion attestation; template is not approval'};
    }
    if(command==='complete') {
      requireOptions(opts,['--review','--confirm']);const review=await completionReview(opts['--review']);
      let record=await caseById(review.requestId);
      if(opts['--confirm']!==`COMPLETE ${record.id}`||record.status!=='copies_pending'||review.caseDigest!==digest(record))throw new Error('Exact current completion attestation required');
      if(review.signatureReviewedByOperator!==true||!Array.isArray(review.scopes)||review.scopes.length!==REQUIRED_SCOPES.length)throw new Error('All copy locations and the act signature require review');
      for(const kind of REQUIRED_SCOPES){
        const entries=review.scopes.filter(item=>item.kind===kind);
        if(entries.length!==1||!['verified_clean','destroyed','verified_absent'].includes(entries[0].status)||typeof entries[0].evidenceRef!=='string'||entries[0].evidenceRef.length<8)throw new Error('A copy location remains unresolved');
      }
      const serverReview=review.scopes.find(item=>item.kind==='server_backups');
      const receipt=(await readOperation(serverReview.evidenceRef,'retirement-receipt')).content;
      const intent=(await readOperation(receipt.intent,'retirement-intent')).content;
      const retiredAt=isoMillis(receipt.completedAt),erasedAt=isoMillis(record.activeDataErasedAt);
      if(!Array.isArray(intent.requestIds)||!intent.requestIds.includes(record.id)||!Number.isFinite(retiredAt)||!Number.isFinite(erasedAt)||retiredAt<erasedAt)throw new Error('Backup retirement does not cover this erasure');
      await checkSignedAct(review.signedAct);
      const saved=await writeOperation('completion-attestation',review);
      record=await saveAccountCase({...record,status:'completed',completedAt:new Date().toISOString()},'operator_completion_attested',{attestation:path.basename(saved.filename),attestationDigest:digest(review),retained:'minimal_erasure_evidence_for_3_years',source:'operator_review_not_automatic_provider_verification'});
      return {ok:true,status:record.status,...await writeEvidence(record)};
    }
    throw new Error('Supported commands: init, plan, erase-active, backup, retirement-plan, retire-backups, evidence, restore-sanitized, completion-template, complete');
  } finally {await db.sql.end({timeout:3});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  runPrivacyOperation(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Privacy operation stopped. No full-erasure result is claimed; inspect the protected plan and stage before retrying.');process.exitCode=1;});
}
