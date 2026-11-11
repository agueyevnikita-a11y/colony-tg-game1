/**
 * Conservative active-database erasure kernel. Callers own authorization,
 * identity locking, closure records, evidence, copies and the transaction.
 * This module neither opens a connection nor declares all copies erased.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only these reviewed identifiers may be interpolated as SQL identifiers.
const REFERENCES = {
  users: [['referred_by', 'a']],
  game_states: [['user_id', 'c']], buildings: [['user_id', 'c']], foundry_jobs: [['user_id', 'c']],
  user_cosmetics: [['user_id', 'c']], purchases: [['user_id', 'c']], daily_quests: [['user_id', 'c']],
  referral_rewards: [['user_id', 'c']], npc_contracts: [['user_id', 'c']], player_stats: [['user_id', 'c']],
  weekly_quests: [['user_id', 'c']], user_achievements: [['user_id', 'c']], analytics_events: [['user_id', 'n']],
  market_orders: [['user_id', 'c']], market_trades: [['seller_user_id', 'r'], ['buyer_user_id', 'r']],
  season_progress: [['user_id', 'c']], season_claims: [['user_id', 'c']], economy_daily_snapshots: [['user_id', 'c']],
  alliances: [['owner_user_id', 'c']], alliance_members: [['user_id', 'c']], alliance_contributions: [['user_id', 'c']],
  alliance_daily_goal_members: [['user_id', 'c']], city_decor: [['user_id', 'c']], user_research: [['user_id', 'c']],
  user_artifacts: [['user_id', 'c']], expeditions: [['user_id', 'c']], notification_preferences: [['user_id', 'c']],
  notification_jobs: [['user_id', 'c']], tutorial_claims: [['user_id', 'c']], daily_login_streaks: [['user_id', 'c']],
  daily_login_rewards: [['user_id', 'c']], game_inbox: [['user_id', 'c']], feature_flag_overrides: [['user_id', 'c']],
  error_events: [['user_id', 'n']], beta_invite_codes: [['created_by', 'n']], beta_access: [['user_id', 'c']],
  player_feedback: [['user_id', 'c']], payment_recovery_runs: [['user_id', 'c']], colony_events: [['user_id', 'c']],
  referral_bonus_claims: [['user_id', 'c'], ['invited_user_id', 'c']], colony_feature_access: [['user_id', 'c']],
  alliance_competition_bindings: [['user_id', 'c']], alliance_competition_entries: [['user_id', 'c']],
  alliance_competition_awards: [['user_id', 'c']], alliance_cooperation_contributions: [['user_id', 'c']],
  alliance_cooperation_requests: [['user_id', 'c']], supply_project_progress: [['user_id', 'c']],
  supply_project_requests: [['user_id', 'c']], account_ownership_proofs: [['user_id', 'c']],
};

const EXTRA_REFERENCES = [
  ['buildings','foundry_jobs',['building_id'],['id'],'c'],
  ['market_orders','market_trades',['order_id'],['id'],'r'],
  ['beta_invite_codes','beta_access',['invite_code_hash'],['code_hash'],'n'],
  ['alliances','alliance_members',['alliance_id'],['id'],'c'],
  ['alliances','alliance_projects',['alliance_id'],['id'],'c'],
  ['alliances','alliance_season_points',['alliance_id'],['id'],'c'],
  ['alliances','alliance_daily_goals',['alliance_id'],['id'],'c'],
  ['alliances','alliance_daily_goal_members',['alliance_id'],['id'],'c'],
  ['alliances','alliance_cooperation_progress',['alliance_id'],['id'],'c'],
  ['alliance_projects','alliance_contributions',['project_id'],['id'],'c'],
  ['alliance_daily_goals','alliance_daily_goal_members',['alliance_id','goal_date','goal_key'],['alliance_id','goal_date','goal_key'],'c'],
];
const REVIEWED_TABLES = [...new Set([...Object.keys(REFERENCES), ...EXTRA_REFERENCES.flatMap(([parent,child]) => [parent,child])])];

const GROUPS = {
  profile: ['users'],
  gameplay: ['game_states', 'buildings', 'foundry_jobs', 'user_cosmetics', 'daily_quests', 'referral_rewards', 'npc_contracts', 'player_stats', 'weekly_quests', 'user_achievements', 'season_progress', 'season_claims', 'economy_daily_snapshots', 'city_decor', 'user_research', 'user_artifacts', 'expeditions', 'tutorial_claims', 'daily_login_streaks', 'daily_login_rewards', 'colony_events', 'colony_feature_access', 'supply_project_progress', 'supply_project_requests'],
  support: ['player_feedback', 'game_inbox', 'notification_preferences', 'notification_jobs', 'feature_flag_overrides', 'beta_access', 'beta_invite_codes'],
  analytics: ['analytics_events', 'error_events', 'analytics_references', 'api_rate_limits'],
  social: ['referrer_links', 'alliances', 'alliance_members', 'alliance_projects', 'alliance_season_points', 'alliance_daily_goals', 'alliance_cooperation_progress', 'alliance_contributions', 'alliance_daily_goal_members', 'referral_bonus_claims', 'alliance_competition_bindings', 'alliance_competition_entries', 'alliance_competition_awards', 'personal_competition_standings', 'alliance_cooperation_contributions', 'alliance_cooperation_requests', 'market_orders'],
  verification: ['account_ownership_proofs'],
};

export class AccountErasureBlockedError extends Error {
  constructor(inspection) {
    super('Перед удалением данных требуется ручная проверка.');
    this.name = 'AccountErasureBlockedError';
    this.blockers = inspection.blockers;
    this.inspection = inspection;
  }
}

function identifier(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid account identifier');
  return value.toLowerCase();
}

function countOf(row) {
  const result = Number(row?.count ?? 0);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Unsafe erasure count');
  return result;
}

function rateKeys(userId, telegramId) {
  return [
    `global:${userId}`, `feedback:${userId}`, `beta_redeem:${userId}`, `payment_recovery:${userId}`,
    `support-proof:issue:${userId}:hour`, `support-proof:issue:${userId}:day`, `support-proof:verify:${telegramId}`,
  ];
}

async function schemaReviewCount(tx) {
  const rows = await tx`
    SELECT n.nspname AS schema_name,r.relname AS table_name,p.relname AS parent_name,c.confdeltype AS action,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord) AS referenced_columns
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
    WHERE c.contype='f' AND pn.nspname='public' AND p.relname=ANY(${tx.array(REVIEWED_TABLES)}::text[])`;
  const expected = new Set([
    ...Object.entries(REFERENCES).flatMap(([table, refs]) => refs.map(([column, action]) => `users:${table}:${column}:id:${action}`)),
    ...EXTRA_REFERENCES.map(([parent,table,columns,referenced,action]) => `${parent}:${table}:${columns.join(',')}:${referenced.join(',')}:${action}`),
  ]);
  let mismatches = 0;
  for (const row of rows) {
    const key = `${row.parent_name}:${row.table_name}:${row.columns.join(',')}:${row.referenced_columns.join(',')}:${row.action}`;
    if (row.schema_name !== 'public' || !expected.delete(key)) mismatches++;
  }
  mismatches += expected.size;
  const [special] = await tx`
    SELECT count(*)::bigint AS count FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname='public' AND r.relname=ANY(${tx.array(REVIEWED_TABLES)}::text[])
      AND (r.relrowsecurity OR r.relforcerowsecurity OR r.relkind<>'r' OR r.relhassubclass
        OR EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal AND t.tgenabled<>'D'))`;
  return mismatches + countOf(special);
}

async function linkedCount(tx, table, columns, userId) {
  // table/column values only originate in REFERENCES, never in request/catalog data.
  if (columns.length === 1) return countOf((await tx`SELECT count(*)::bigint AS count FROM ${tx(`public.${table}`)} WHERE ${tx(columns[0])}=${userId}`)[0]);
  return countOf((await tx`SELECT count(*)::bigint AS count FROM ${tx(`public.${table}`)} WHERE ${tx(columns[0])}=${userId} OR ${tx(columns[1])}=${userId}`)[0]);
}

/** Read-only active-database plan; counts contain no player names or identifiers. */
export async function inspectAccountErasure(tx, inputUserId, adminTelegramIds = []) {
  const userId = identifier(inputUserId);
  if (!Array.isArray(adminTelegramIds) || adminTelegramIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid administrator configuration');
  const [user] = await tx`SELECT id,telegram_id,username,colony_name,profile_bio FROM public.users WHERE id=${userId}`;
  const result = { userId, exists: Boolean(user), counts: { users: user ? 1 : 0 }, blockers: [], categories: [] };
  if (!user) return result;
  const addBlocker = (code, count) => { if (count > 0) result.blockers.push({ code, count }); };
  const schemaCount = await schemaReviewCount(tx);
  result.counts.schema_review = schemaCount;
  addBlocker('SCHEMA_REVIEW_REQUIRED', schemaCount);
  if (schemaCount) { result.categories = ['profile']; return result; }
  addBlocker('ADMIN_ACCOUNT', adminTelegramIds.some(id => String(id) === String(user.telegram_id)) ? 1 : 0);
  for (const [table, references] of Object.entries(REFERENCES)) {
    const key = table === 'users' ? 'referrer_links' : table;
    result.counts[key] = await linkedCount(tx, table, references.map(([column]) => column), userId);
  }
  result.counts.market_trades = countOf((await tx`SELECT count(*)::bigint AS count FROM public.market_trades
    WHERE seller_user_id=${userId} OR buyer_user_id=${userId}
      OR order_id IN (SELECT id FROM public.market_orders WHERE user_id=${userId})`)[0]);
  for (const table of ['alliance_projects','alliance_season_points','alliance_daily_goals','alliance_cooperation_progress']) {
    result.counts[table] = countOf((await tx`SELECT count(*)::bigint AS count FROM ${tx(`public.${table}`)}
      WHERE alliance_id IN (SELECT id FROM public.alliances WHERE owner_user_id=${userId})`)[0]);
  }
  const ids = [userId, String(user.telegram_id)];
  const needles = [...new Set([...ids, user.username, user.colony_name, user.profile_bio]
    .filter(value => typeof value === 'string' && value.trim()).map(value => value.toLowerCase()))];
  result.counts.analytics_references = countOf((await tx`
    SELECT count(*)::bigint AS count FROM public.analytics_events
    WHERE user_id IS DISTINCT FROM ${userId}::uuid
      AND (lower(payload->>'referral_user_id')=ANY(${tx.array(ids)}::text[]) OR lower(payload->>'target_user_id')=ANY(${tx.array(ids)}::text[]))`)[0]);
  result.counts.third_party_analytics = countOf((await tx`
    SELECT count(*)::bigint AS count FROM public.analytics_events
    WHERE user_id IS DISTINCT FROM ${userId}::uuid
      AND NOT(coalesce(lower(payload->>'referral_user_id')=ANY(${tx.array(ids)}::text[]),false)
        OR coalesce(lower(payload->>'target_user_id')=ANY(${tx.array(ids)}::text[]),false))
      AND EXISTS(SELECT 1 FROM unnest(${tx.array(needles)}::text[]) needle
        WHERE strpos(lower(concat_ws(' ',event_name,payload::text)),needle)>0)`)[0]);
  result.counts.third_party_feedback = countOf((await tx`
    SELECT count(*)::bigint AS count FROM public.player_feedback WHERE user_id<>${userId}
      AND EXISTS(SELECT 1 FROM unnest(${tx.array(needles)}::text[]) needle
        WHERE strpos(lower(concat_ws(' ',message,context::text)),needle)>0)`)[0]);
  result.counts.third_party_errors = countOf((await tx`
    SELECT count(*)::bigint AS count FROM public.error_events WHERE user_id IS DISTINCT FROM ${userId}::uuid
      AND EXISTS(SELECT 1 FROM unnest(${tx.array(needles)}::text[]) needle
        WHERE strpos(lower(concat_ws(' ',message,stack,context::text)),needle)>0)`)[0]);
  result.counts.personal_competition_standings = countOf((await tx`SELECT count(*)::bigint AS count FROM public.alliance_competition_standings WHERE kind='personal' AND entity_id=${userId}`)[0]);
  result.counts.api_rate_limits = countOf((await tx`SELECT count(*)::bigint AS count FROM public.api_rate_limits WHERE bucket_key=ANY(${tx.array(rateKeys(userId,user.telegram_id))}::text[])`)[0]);
  result.counts.owned_alliance_members = countOf((await tx`
    SELECT count(*)::bigint AS count FROM public.alliance_members m JOIN public.alliances a ON a.id=m.alliance_id
    WHERE a.owner_user_id=${userId} AND m.user_id<>${userId}`)[0]);
  result.counts.active_cooperation = countOf((await tx`
    SELECT count(*)::bigint AS count FROM public.alliance_cooperation_contributions c
    JOIN public.alliance_cooperation_operations o ON o.id=c.operation_id WHERE c.user_id=${userId} AND o.status='active'`)[0]);
  result.counts.active_notification_delivery = countOf((await tx`
    SELECT count(*)::bigint AS count FROM public.notification_jobs WHERE user_id=${userId}
      AND processing_at IS NOT NULL AND sent_at IS NULL AND cancelled_at IS NULL`)[0]);
  result.counts.verification_actor_history = countOf((await tx`
    SELECT count(*)::bigint AS count FROM public.account_ownership_proofs
    WHERE user_id<>${userId} AND verified_by_telegram_id=${user.telegram_id}`)[0]);
  result.counts.alliance_role_anomalies = countOf((await tx`
    SELECT count(*)::bigint AS count FROM public.alliance_members m JOIN public.alliances a ON a.id=m.alliance_id
    WHERE m.user_id=${userId} AND ((m.role='owner') IS DISTINCT FROM (a.owner_user_id=${userId}))`)[0])
    + Math.max(0, result.counts.alliances-1);
  result.counts.owned_alliance_shared_history = countOf((await tx`
    WITH owned AS (SELECT id FROM public.alliances WHERE owner_user_id=${userId}), history AS (
      SELECT id FROM public.alliance_cooperation_operations WHERE alliance_id IN (SELECT id FROM owned)
      UNION ALL SELECT entity_id FROM public.alliance_competition_standings WHERE kind='alliance' AND entity_id IN (SELECT id FROM owned)
      UNION ALL SELECT user_id FROM public.alliance_competition_bindings WHERE user_id<>${userId} AND alliance_id IN (SELECT id FROM owned)
      UNION ALL SELECT user_id FROM public.alliance_competition_entries WHERE user_id<>${userId} AND alliance_id IN (SELECT id FROM owned)
      UNION ALL SELECT user_id FROM public.alliance_competition_awards WHERE user_id<>${userId} AND alliance_name IN (SELECT name FROM public.alliances WHERE id IN (SELECT id FROM owned))
      UNION ALL SELECT user_id FROM public.alliance_contributions WHERE user_id<>${userId} AND project_id IN (SELECT id FROM public.alliance_projects WHERE alliance_id IN (SELECT id FROM owned))
      UNION ALL SELECT user_id FROM public.alliance_daily_goal_members WHERE user_id<>${userId} AND alliance_id IN (SELECT id FROM owned)
    ) SELECT count(*)::bigint AS count FROM history`)[0]);
  for (const [code,key] of [
    ['PURCHASE_RECORDS','purchases'], ['MARKET_HISTORY','market_trades'], ['OWNED_ALLIANCE_MEMBERS','owned_alliance_members'],
    ['ACTIVE_COOPERATION','active_cooperation'], ['ACTIVE_NOTIFICATION_DELIVERY','active_notification_delivery'],
    ['THIRD_PARTY_FEEDBACK','third_party_feedback'], ['THIRD_PARTY_ERRORS','third_party_errors'],
    ['THIRD_PARTY_ANALYTICS','third_party_analytics'], ['VERIFICATION_ACTOR_HISTORY','verification_actor_history'],
    ['ALLIANCE_ROLE_ANOMALY','alliance_role_anomalies'], ['OWNED_ALLIANCE_SHARED_HISTORY','owned_alliance_shared_history'],
    ['BETA_CODE_CREATOR_HISTORY','beta_invite_codes'],
  ]) addBlocker(code,result.counts[key]);
  result.categories = Object.entries(GROUPS).filter(([,tables]) => tables.some(table => result.counts[table] > 0)).map(([category]) => category);
  return result;
}

/** Erases reviewed active-DB records only, within the caller's transaction. */
export async function eraseAccountData(tx, inputUserId, adminTelegramIds = []) {
  const userId = identifier(inputUserId);
  if (typeof tx.savepoint !== 'function') throw new Error('Account erasure requires a transaction');
  // Keep the reviewed schema and cross-account text sources stable during purge.
  // No network, file or mailbox work is performed while these locks are held.
  await tx`LOCK TABLE public.users,public.analytics_events,public.error_events,public.player_feedback,public.api_rate_limits IN SHARE ROW EXCLUSIVE MODE`;
  const [user] = await tx`SELECT id,telegram_id FROM public.users WHERE id=${userId} FOR UPDATE`;
  await tx`SELECT id FROM public.alliances WHERE owner_user_id=${userId} ORDER BY id FOR UPDATE`;
  const plan = await inspectAccountErasure(tx,userId,adminTelegramIds);
  if (plan.blockers.length) throw new AccountErasureBlockedError(plan);
  if (!user) return { counts: plan.counts, categories: plan.categories };
  const ids = [userId,String(user.telegram_id)];
  await tx`DELETE FROM public.analytics_events WHERE user_id=${userId}
    OR lower(payload->>'referral_user_id')=ANY(${tx.array(ids)}::text[]) OR lower(payload->>'target_user_id')=ANY(${tx.array(ids)}::text[])`;
  await tx`DELETE FROM public.error_events WHERE user_id=${userId}`;
  await tx`DELETE FROM public.alliance_competition_standings WHERE kind='personal' AND entity_id=${userId}`;
  await tx`DELETE FROM public.api_rate_limits WHERE bucket_key=ANY(${tx.array(rateKeys(userId,user.telegram_id))}::text[])`;
  await tx`UPDATE public.users SET referred_by=NULL WHERE referred_by=${userId}`;
  // Payments, trades and non-empty owned alliances are excluded by the plan.
  // Reviewed CASCADEs remove own game data. Shared balances are never updated.
  const deleted = await tx`DELETE FROM public.users WHERE id=${userId} RETURNING id`;
  if (deleted.length !== 1) throw new Error('Account erasure did not remove the expected account');
  return { counts: plan.counts, categories: plan.categories };
}
