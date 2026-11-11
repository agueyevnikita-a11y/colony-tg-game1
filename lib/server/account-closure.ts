import { sql } from './db';
import { assertAdminTelegramId } from './admin';
import { assertRateLimit } from './rate-limit';
import { SupportOwnershipError } from './support-ownership';
import { accountKey, readAccountCase, listAccountCases, saveAccountCase, newAccountCase, publicCase, isClosedCase, type ClosureCase } from '../../scripts/privacy/lib/case-store.mjs';

export class AccountClosedError extends Error {
  constructor(readonly request: ReturnType<typeof publicCase>,readonly telegramId:number) { super('Account closed by its owner'); }
}

export async function lockAccountIdentity(tx:any, telegramId:number) {
  const key = accountKey(telegramId);
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy:${key}`},0))`;
  return key;
}

export async function assertAccountOpen(tx:any, telegramId:number) {
  const key = await lockAccountIdentity(tx, telegramId);
  const record = await readAccountCase(key);
  if (isClosedCase(record)) throw new AccountClosedError(publicCase(record),telegramId);
}

export async function ownClosureStatus(telegramId:number) {
  return publicCase(await readAccountCase(accountKey(telegramId)));
}

export async function requestAccountClosure(telegramId:number) {
  try { assertAdminTelegramId(telegramId); throw new SupportOwnershipError(409,'Для административного аккаунта требуется отдельный разбор: сначала нужно сохранить возможность управления проектом. Напишите в поддержку.'); }
  catch (error) { if (error instanceof SupportOwnershipError) throw error; }
  await assertRateLimit(`privacy-request:${accountKey(telegramId)}`,3,86400);
  return sql.begin(async tx => {
    const key = await lockAccountIdentity(tx,telegramId);
    const previous = await readAccountCase(key);
    if (isClosedCase(previous)) return publicCase(previous);
    const [user] = await tx`SELECT id FROM users WHERE telegram_id=${telegramId} FOR UPDATE`;
    if (!user) throw new SupportOwnershipError(404,'Аккаунт не найден. Напишите в поддержку без создания нового профиля.');
    const record = await saveAccountCase(newAccountCase(key,user.id),'self_closure_requested',{authentication:'fresh_signed_telegram',instruction:'close_account_and_request_erasure'});
    await tx`UPDATE notification_preferences SET enabled=false,updated_at=now() WHERE user_id=${user.id}`;
    await tx`UPDATE users SET bot_write_allowed=false WHERE id=${user.id}`;
    await tx`UPDATE notification_jobs SET cancelled_at=now(),processing_at=NULL,error_text='account_closure_requested' WHERE user_id=${user.id} AND sent_at IS NULL AND cancelled_at IS NULL`;
    return publicCase(record);
  });
}

export async function cancelAccountClosure(telegramId:number, requestId:string) {
  return sql.begin(async tx => {
    const key = await lockAccountIdentity(tx,telegramId);
    const record = await readAccountCase(key);
    if (!record || record.id !== requestId) throw new SupportOwnershipError(404,'Заявка не найдена.');
    if ((record.status !== 'requested' && record.status !== 'cancelled') || record.executionStartedAt) throw new SupportOwnershipError(409,'Удаление уже началось. Напишите в поддержку; данные автоматически не восстанавливаются.');
    if (record.status === 'cancelled') return publicCase(record);
    const updated = await saveAccountCase({...record,status:'cancelled'},'self_closure_cancelled',{instruction:'withdraw_request_and_resume_participation'});
    // Notification permission is not re-enabled when the request is withdrawn.
    return publicCase(updated);
  });
}

export async function adminClosureList() {
  return (await listAccountCases()).map(record=>({...publicCase(record),userId:record.userId}));
}

export async function findClosureCase(id:string):Promise<ClosureCase> {
  const record = (await listAccountCases()).find(item=>item.id===id);
  if (!record) throw new SupportOwnershipError(404,'Заявка не найдена.');
  return record;
}
