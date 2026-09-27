import crypto from 'node:crypto';
import { sql } from '@/lib/server/db';

function adminIds() {
  return new Set((process.env.ADMIN_TELEGRAM_IDS ?? '').split(',').map((x) => Number(x.trim())).filter(Number.isFinite));
}

export function hashBetaCode(code: string) {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export async function getSystemState(tx: any) {
  const rows = await tx<any[]>`SELECT setting_key,value FROM system_settings WHERE setting_key IN ('maintenance','beta_required')`;
  const map = Object.fromEntries(rows.map((r:any)=>[r.setting_key,r.value ?? {}]));
  return {
    maintenance: { enabled: Boolean(map.maintenance?.enabled), message: String(map.maintenance?.message ?? 'COLONY временно на обслуживании.') },
    betaRequired: Boolean(map.beta_required?.enabled),
  };
}

export async function getAccessState(tx:any,userId:string,telegramId:number) {
  const system = await getSystemState(tx);
  const isAdmin = adminIds().has(Number(telegramId));
  const access = (await tx<any[]>`SELECT granted_at,source FROM beta_access WHERE user_id=${userId}`)[0] ?? null;
  const maintenanceBlocked = system.maintenance.enabled && !isAdmin;
  const betaBlocked = system.betaRequired && !isAdmin && !access;
  return {
    allowed: !maintenanceBlocked && !betaBlocked,
    isAdmin,
    maintenance: system.maintenance,
    betaRequired: system.betaRequired,
    betaAccess: Boolean(access),
    blockReason: maintenanceBlocked ? 'maintenance' : betaBlocked ? 'beta_required' : null,
  };
}

export async function redeemBetaCode(userId:string,code:string) {
  const normalized=code.trim().toUpperCase();
  if(normalized.length<4 || normalized.length>64) throw new Error('Некорректный beta-код');
  const codeHash=hashBetaCode(normalized);
  return sql.begin(async tx=>{
    const existing=(await tx<any[]>`SELECT user_id FROM beta_access WHERE user_id=${userId}`)[0];
    if(existing) return { alreadyGranted:true };
    const rows=await tx<any[]>`
      SELECT * FROM beta_invite_codes
      WHERE code_hash=${codeHash} AND active=true AND (expires_at IS NULL OR expires_at>now())
      FOR UPDATE
    `;
    const invite=rows[0];
    if(!invite || Number(invite.uses)>=Number(invite.max_uses)) throw new Error('Beta-код недействителен или лимит активаций исчерпан');
    const granted=await tx<{ user_id: string }[]>`
      INSERT INTO beta_access(user_id,source,invite_code_hash) VALUES(${userId},'code',${codeHash})
      ON CONFLICT(user_id) DO NOTHING RETURNING user_id
    `;
    if(!granted.length) return { alreadyGranted:true };
    await tx`UPDATE beta_invite_codes SET uses=uses+1 WHERE code_hash=${codeHash}`;
    return { alreadyGranted:false };
  });
}
