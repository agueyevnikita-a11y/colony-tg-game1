import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { validateLaunchConfig } from './launch-config.mjs';

// Commands, payment receipts/refunds and write_access_allowed all arrive as message.
export const ALLOWED_UPDATES = ['message', 'pre_checkout_query'];
export const BOT_COMMANDS = [
  { command: 'start', description: 'Открыть COLONY' },
  { command: 'help', description: 'Как играть и связаться с поддержкой' },
  { command: 'paysupport', description: 'Помощь с оплатой Telegram Stars' },
];
const METHODS = new Set(['getMe', 'getWebhookInfo', 'setWebhook', 'setMyCommands', 'getMyCommands', 'setChatMenuButton', 'getChatMenuButton']);

export class LaunchToolError extends Error {}

export function requireLaunchConfig(env) {
  const result = validateLaunchConfig(env);
  if (!result.ok) throw new LaunchToolError(result.issues.map(({ key, message }) => `${key}: ${message}`).join('\n'));
}

export async function telegramCall(token, method, payload = {}, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!METHODS.has(method)) throw new LaunchToolError('Unsupported Telegram setup method.');
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload), signal: controller.signal, redirect: 'error',
        });
        const data = await response.json();
        if (!response.ok || data?.ok !== true) {
          const status = Number.isInteger(data?.error_code) ? data.error_code : response.status;
          throw new LaunchToolError(`Telegram ${method} failed (code ${Number.isInteger(status) ? status : 'unknown'}). Check bot access and configuration.`);
        }
        return data.result;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new LaunchToolError(`Telegram ${method} timed out. Check network connectivity and retry.`));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    // Fetch errors can contain the complete token-bearing URL. Do not forward them.
    if (error instanceof LaunchToolError) throw error;
    throw new LaunchToolError(`Telegram ${method} request failed. Check network connectivity and bot access.`);
  } finally { clearTimeout(timer); }
}

export function verifyBotIdentity(bot, env) {
  if (!bot?.is_bot || typeof bot.username !== 'string' || bot.username.toLowerCase() !== env.BOT_USERNAME.toLowerCase()
    || String(bot.id) !== env.BOT_TOKEN.split(':')[0]) {
    throw new LaunchToolError('BOT_TOKEN belongs to a different bot than BOT_USERNAME / NEXT_PUBLIC_BOT_USERNAME.');
  }
}

export function inspectWebhook(info, appUrl) {
  const issues = [];
  const warnings = [];
  const expected = `${new URL(appUrl).origin}/api/telegram/webhook`;
  if (info?.url !== expected) issues.push('Webhook URL does not match APP_URL. Run telegram:webhook -- --apply after deployment.');
  // An omitted/empty allowed_updates means the Telegram default, which includes both.
  if (info?.allowed_updates?.length && ALLOWED_UPDATES.some((type) => !info.allowed_updates.includes(type))) {
    issues.push('Webhook subscriptions must include message and pre_checkout_query.');
  }
  const pending = Number.isSafeInteger(info?.pending_update_count) ? info.pending_update_count : 0;
  if (pending > 0) warnings.push(`Telegram has ${pending} updates pending delivery.`);
  if (info?.last_error_date && pending > 0) issues.push('Telegram reports a delivery error with pending updates. Check the HTTPS endpoint and server logs.');
  else if (info?.last_error_date) warnings.push('Telegram recorded an earlier delivery error; no updates are currently pending.');
  return { ok: issues.length === 0, issues, warnings };
}

export function setupPlan(env, { webhookOnly = false } = {}) {
  const origin = new URL(env.APP_URL).origin;
  return {
    botUsername: env.BOT_USERNAME,
    webhookUrl: `${origin}/api/telegram/webhook`,
    allowedUpdates: ALLOWED_UPDATES,
    preservePendingUpdates: true,
    ...(!webhookOnly ? { menuButton: { type: 'web_app', text: 'Играть в COLONY', web_app: { url: origin } }, commands: BOT_COMMANDS } : {}),
  };
}

export async function runTelegramSetup({ env = process.env, apply = false, webhookOnly = false, fetchImpl = fetch, timeoutMs } = {}) {
  requireLaunchConfig(env);
  const plan = setupPlan(env, { webhookOnly });
  if (!apply) return { applied: false, plan, warnings: [] };
  const call = (method, payload) => telegramCall(env.BOT_TOKEN, method, payload, { fetchImpl, timeoutMs });
  verifyBotIdentity(await call('getMe'), env);
  if (!webhookOnly) {
    await call('setMyCommands', { commands: plan.commands, scope: { type: 'all_private_chats' }, language_code: '' });
    await call('setChatMenuButton', { menu_button: plan.menuButton });
  }
  await call('setWebhook', {
    url: plan.webhookUrl, secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false,
  });
  const webhook = inspectWebhook(await call('getWebhookInfo'), env.APP_URL);
  if (!webhook.ok) throw new LaunchToolError(webhook.issues.join('\n'));
  if (!webhookOnly) {
    const menu = await call('getChatMenuButton');
    if (menu?.type !== 'web_app' || menu.web_app?.url !== plan.menuButton.web_app.url) throw new LaunchToolError('Telegram menu button verification failed. Rerun telegram:setup -- --apply.');
    const commands = await call('getMyCommands', { scope: { type: 'all_private_chats' }, language_code: '' });
    if (!Array.isArray(commands) || BOT_COMMANDS.some(({ command }) => !commands.some((item) => item.command === command))) {
      throw new LaunchToolError('Telegram bot command verification failed. Rerun telegram:setup -- --apply.');
    }
  }
  return { applied: true, plan, warnings: webhook.warnings };
}

export function schemaRequirements(schema) {
  const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/gi)].map((match) => match[1]);
  const columns = [...schema.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+(\w+)/gi)].map((match) => `${match[1]}.${match[2]}`);
  return { tables: [...new Set(tables)], columns: [...new Set(columns)] };
}

export function inspectSchema(rows, requirements) {
  const tables = new Set(rows.map((row) => row.table_name));
  const columns = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  return [
    ...requirements.tables.filter((table) => !tables.has(table)).map((table) => `Missing table: ${table}`),
    ...requirements.columns.filter((column) => !columns.has(column)).map((column) => `Missing column: ${column}`),
  ];
}

export async function checkDatabase(databaseUrl, { postgresImpl = postgres, timeoutMs = 12000 } = {}) {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  let sql;
  let timer;
  try {
    sql = postgresImpl(databaseUrl, { max: 1, connect_timeout: 5, idle_timeout: 1, connection: { statement_timeout: 5000 } });
    await Promise.race([
      (async () => {
        const rows = await sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`;
        const issues = inspectSchema(rows, schemaRequirements(schema));
        if (issues.length) throw new LaunchToolError(`Database schema is incomplete. Run npm run db:init.\n${issues.join('\n')}`);
        const settings = await sql`SELECT setting_key FROM system_settings WHERE setting_key IN ('maintenance', 'beta_required')`;
        if (settings.length !== 2) throw new LaunchToolError('Database launch settings are missing. Run npm run db:init.');
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new LaunchToolError('PostgreSQL check timed out. Check database connectivity and retry.')), timeoutMs);
      }),
    ]);
    return { ok: true };
  } catch (error) {
    if (error instanceof LaunchToolError) throw error;
    throw new LaunchToolError('PostgreSQL check failed. Check database connectivity, credentials and schema permissions.');
  } finally {
    clearTimeout(timer);
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  }
}

export async function runDoctor({ env = process.env, local = false, fetchImpl = fetch, databaseCheck = checkDatabase } = {}) {
  const config = validateLaunchConfig(env);
  const checks = config.issues.map(({ key, message }) => ({ name: key, ok: false, message }));
  const warnings = [];
  if (!config.ok) return { ok: false, checks, warnings };
  checks.push({ name: 'Production configuration', ok: true });
  if (local) return { ok: true, checks, warnings: ['Offline validation only; database connectivity, bot identity and webhook delivery were not checked.'] };
  try { await databaseCheck(env.DATABASE_URL); checks.push({ name: 'PostgreSQL schema and launch settings', ok: true }); }
  catch (error) { checks.push({ name: 'PostgreSQL', ok: false, message: error instanceof LaunchToolError ? error.message : 'Database check failed.' }); }
  try {
    const bot = await telegramCall(env.BOT_TOKEN, 'getMe', {}, { fetchImpl });
    verifyBotIdentity(bot, env);
    checks.push({ name: 'Telegram bot identity', ok: true });
    if (!bot.has_main_web_app) warnings.push('Configure the Main Mini App in BotFather to enable direct startapp links.');
    const webhook = inspectWebhook(await telegramCall(env.BOT_TOKEN, 'getWebhookInfo', {}, { fetchImpl }), env.APP_URL);
    checks.push({ name: 'Telegram webhook', ok: webhook.ok, message: webhook.issues.join(' ') });
    warnings.push(...webhook.warnings);
  } catch (error) { checks.push({ name: 'Telegram', ok: false, message: error instanceof LaunchToolError ? error.message : 'Telegram check failed.' }); }
  return { ok: checks.every((check) => check.ok), checks, warnings };
}
