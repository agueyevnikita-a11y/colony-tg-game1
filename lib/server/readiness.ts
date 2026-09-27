import { sql } from './db';

// These columns cover the schema additions needed by the launch/session path.
export const REQUIRED_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  users: ['id', 'telegram_id', 'bot_write_allowed', 'colony_name'],
  game_states: ['user_id', 'passive_carry', 'tutorial_step', 'science'],
  buildings: ['id', 'user_id', 'completes_at'],
  purchases: ['invoice_payload', 'telegram_payment_charge_id', 'status'],
  system_settings: ['setting_key', 'value'],
  beta_access: ['user_id'],
  api_rate_limits: ['bucket_key'],
  notification_preferences: ['user_id', 'enabled'],
  notification_jobs: ['processing_at', 'sent_at', 'cancelled_at'],
  player_feedback: ['user_id', 'client_version'],
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
