import { sql } from './db';

// These columns cover the schema additions needed by the launch/session path.
export const REQUIRED_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  users: ['id', 'telegram_id', 'bot_write_allowed', 'colony_name'],
  game_states: ['user_id', 'passive_carry', 'tutorial_step', 'science'],
  buildings: ['id', 'user_id', 'completes_at'],
  foundry_jobs: ['id', 'recipe_key'],
  colony_events: ['id', 'user_id', 'event_key', 'status', 'event_json', 'choice_id', 'created_at', 'resolved_at', 'result_json'],
  city_decor: ['id', 'user_id', 'type', 'x', 'y'],
  player_stats: ['user_id', 'max_comfort'],
  referral_bonus_claims: ['user_id', 'invited_user_id', 'credit_reward', 'crystal_reward', 'created_at'],
  colony_feature_access: ['user_id', 'feature_key'],
  colony_migrations: ['migration_key'],
  purchases: ['invoice_payload', 'telegram_payment_charge_id', 'status'],
  system_settings: ['setting_key', 'value'],
  beta_access: ['user_id'],
  api_rate_limits: ['bucket_key'],
  notification_preferences: ['user_id', 'enabled'],
  notification_jobs: ['processing_at', 'sent_at', 'cancelled_at'],
  player_feedback: ['user_id', 'client_version'],
  alliance_cooperation_progress: ['alliance_id', 'shared_science', 'drilling_level', 'analysis_level'],
  alliance_cooperation_operations: ['id', 'ends_at', 'settled_at', 'team_bonus_percent'],
  alliance_cooperation_contributions: ['id', 'user_id', 'cost_json', 'reward_json', 'claimed_at'],
  alliance_cooperation_requests: ['user_id', 'request_id', 'fingerprint', 'result_json'],
  alliance_competition_periods: ['id', 'ends_at', 'finalized_at'],
  alliance_competition_bindings: ['period_id', 'user_id', 'alliance_id'],
  alliance_competition_entries: ['source_id', 'period_id', 'user_id', 'points'],
  alliance_competition_standings: ['period_id', 'kind', 'entity_id', 'rank'],
  alliance_competition_awards: ['period_id', 'user_id', 'kind', 'crystals', 'claimed_at'],
};

export function schemaIsReady(columns: { table_name: string; column_name: string }[]) {
  const found = new Set(columns.map(({ table_name, column_name }) => `${table_name}.${column_name}`));
  return Object.entries(REQUIRED_SCHEMA).every(([table, names]) => names.every((name) => found.has(`${table}.${name}`)));
}

export async function databaseReadiness(): Promise<{ database: 'ok' | 'error'; schema: 'ok' | 'error' }> {
  try {
    const columns = await sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema=current_schema()
    `;
    return { database: 'ok', schema: schemaIsReady(columns) ? 'ok' : 'error' };
  } catch {
    return { database: 'error', schema: 'error' };
  }
}
