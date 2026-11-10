import crypto from 'node:crypto';
import { sql } from './db';
import { assertRateLimit } from './rate-limit';

export class SupportOwnershipError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const codeHash = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

export async function issueOwnershipProof(telegramId: number) {
  // This must not use ensurePlayer: support is available during maintenance
  // without creating accounts or updating the game/profile/activity.
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE telegram_id=${telegramId}`;
  if (!user) throw new SupportOwnershipError(404, 'Аккаунт игры не найден. Напишите в поддержку без кода.');
  await assertRateLimit(`support-proof:issue:${user.id}:hour`, 3, 3600);
  await assertRateLimit(`support-proof:issue:${user.id}:day`, 20, 86400);
  const raw = crypto.randomBytes(16).toString('hex').toUpperCase();
  const code = `CG-${raw.match(/.{8}/g)!.join('-')}`;
  const proof = await sql.begin(async tx => {
    // Serialize issuance for the same account, including simultaneous clicks.
    const [existing] = await tx`SELECT id FROM users WHERE id=${user.id} FOR UPDATE`;
    if (!existing) throw new SupportOwnershipError(404, 'Аккаунт игры не найден. Напишите в поддержку без кода.');
    await tx`UPDATE account_ownership_proofs SET revoked_at=now()
      WHERE user_id=${user.id} AND consumed_at IS NULL AND revoked_at IS NULL`;
    const [row] = await tx<{ expires_at: Date }[]>`
      INSERT INTO account_ownership_proofs(user_id,token_hash,expires_at)
      VALUES(${user.id},${codeHash(code)},now()+interval '24 hours') RETURNING expires_at`;
    return row;
  });
  return { code, expiresAt: proof.expires_at.toISOString() };
}

export async function consumeOwnershipProof(telegramId: number, code: string, requestRef: string) {
  await assertRateLimit(`support-proof:verify:${telegramId}`, 30, 3600);
  if (!/^CG-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/.test(code) || !/^[A-Za-z0-9_-]{1,64}$/.test(requestRef)) {
    throw new SupportOwnershipError(400, 'Проверьте код и номер обращения: допустимы латинские буквы, цифры, дефис и подчёркивание.');
  }
  // A single UPDATE makes expiry, revocation and one-time use atomic.
  const [proof] = await sql<{ id: string; user_id: string; colony_name: string | null; issued_at: Date; consumed_at: Date; request_ref: string }[]>`
    UPDATE account_ownership_proofs AS p
    SET consumed_at=now(),verified_by_telegram_id=${telegramId},request_ref=${requestRef}
    FROM users AS u
    WHERE p.user_id=u.id AND p.token_hash=${codeHash(code)}
      AND p.consumed_at IS NULL AND p.revoked_at IS NULL AND p.expires_at>now()
    RETURNING p.id,p.user_id,u.colony_name,p.issued_at,p.consumed_at,p.request_ref`;
  if (!proof) throw new SupportOwnershipError(400, 'Код неверен, истёк, заменён новым или уже использован. Запросите новый код у автора обращения.');
  return {
    id: proof.id, userId: proof.user_id, colonyName: proof.colony_name || 'Колония',
    issuedAt: proof.issued_at.toISOString(), verifiedAt: proof.consumed_at.toISOString(), requestRef: proof.request_ref,
  };
}
