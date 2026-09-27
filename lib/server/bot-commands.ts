export type BotCommand = 'start' | 'help' | 'paysupport';
type Payment = { invoice_payload: string; currency: string; total_amount: number; telegram_payment_charge_id: string };
export type BotUpdate =
  | { kind: 'ignore' }
  | { kind: 'command'; command: BotCommand; argument?: string; chatId: number; privateChat: boolean }
  | { kind: 'write_access_allowed'; userId: number }
  | { kind: 'pre_checkout'; query: { id: string; invoice_payload: string; currency: string; total_amount: number; userId: number } }
  | { kind: 'payment'; payment: Payment; userId: number }
  | { kind: 'refund'; payment: Payment };

export class InvalidTelegramUpdate extends Error {
  constructor() { super('Invalid Telegram update'); }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function integer(value: unknown, positive = true): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (positive ? value > 0 : value !== 0);
}
function nonempty(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new InvalidTelegramUpdate();
}
function userId(value: unknown) {
  requireValid(record(value) && integer(value.id) && value.is_bot !== true);
  return value.id;
}
function paymentFields(value: unknown): Omit<Payment, 'telegram_payment_charge_id'> {
  requireValid(record(value));
  requireValid(nonempty(value.invoice_payload, 128) && typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency) && integer(value.total_amount));
  return { invoice_payload: value.invoice_payload, currency: value.currency, total_amount: value.total_amount };
}
function payment(value: unknown): Payment {
  const fields = paymentFields(value);
  requireValid(record(value) && nonempty(value.telegram_payment_charge_id, 512));
  return { ...fields, telegram_payment_charge_id: value.telegram_payment_charge_id };
}

export function botUsername(env: NodeJS.ProcessEnv = process.env) {
  const value = env.BOT_USERNAME || env.NEXT_PUBLIC_BOT_USERNAME || '';
  return /^[A-Za-z][A-Za-z0-9_]{1,28}bot$/i.test(value) ? value : undefined;
}

export function parseBotCommand(text: string, username?: string): { command: BotCommand; argument?: string } | undefined {
  const match = /^\/(start|help|paysupport)(?:@([A-Za-z0-9_]+))?(?:\s+([^\r\n]*))?$/i.exec(text.trim());
  if (!match || (match[2] && (!username || match[2].toLowerCase() !== username.toLowerCase()))) return;
  return { command: match[1].toLowerCase() as BotCommand, argument: match[3]?.trim() || undefined };
}

// Validate actionable envelopes before any database access. Unknown update kinds are acknowledged.
export function parseBotUpdate(value: unknown, username?: string): BotUpdate {
  requireValid(record(value) && Number.isSafeInteger(value.update_id) && Number(value.update_id) >= 0);
  requireValid(!(value.pre_checkout_query !== undefined && value.message !== undefined));
  if (value.pre_checkout_query !== undefined) {
    const query = value.pre_checkout_query;
    const fields = paymentFields(query);
    requireValid(record(query) && nonempty(query.id, 256));
    return { kind: 'pre_checkout', query: { ...fields, id: query.id, userId: userId(query.from) } };
  }
  if (value.message === undefined) return { kind: 'ignore' };
  const message = value.message;
  requireValid(record(message) && integer(message.message_id) && record(message.chat) && integer(message.chat.id, false));
  requireValid(['private', 'group', 'supergroup', 'channel'].includes(String(message.chat.type)));
  const privateChat = message.chat.type === 'private';
  requireValid([message.successful_payment, message.refunded_payment, message.write_access_allowed, message.text].filter(item => item !== undefined).length <= 1);
  if (message.successful_payment !== undefined) {
    const id = userId(message.from);
    requireValid(privateChat && message.chat.id === id);
    return { kind: 'payment', payment: payment(message.successful_payment), userId: id };
  }
  if (message.refunded_payment !== undefined) {
    requireValid(privateChat);
    return { kind: 'refund', payment: payment(message.refunded_payment) };
  }
  if (message.write_access_allowed !== undefined) {
    const id = userId(message.from);
    const grant = message.write_access_allowed;
    requireValid(record(grant));
    requireValid(grant.from_request === undefined || typeof grant.from_request === 'boolean');
    requireValid(grant.from_attachment_menu === undefined || typeof grant.from_attachment_menu === 'boolean');
    requireValid(grant.web_app_name === undefined || nonempty(grant.web_app_name, 256));
    requireValid(privateChat && message.chat.id === id);
    return { kind: 'write_access_allowed', userId: id };
  }
  if (message.text === undefined) return { kind: 'ignore' };
  requireValid(typeof message.text === 'string' && message.text.length <= 4096);
  if (message.chat.type === 'channel' || (record(message.from) && message.from.is_bot === true)) return { kind: 'ignore' };
  const command = parseBotCommand(message.text, username);
  if (!command) return { kind: 'ignore' };
  const id = userId(message.from);
  requireValid(!privateChat || message.chat.id === id);
  return { kind: 'command', ...command, chatId: message.chat.id, privateChat };
}

function publicHttpsUrl(raw: string | undefined, originOnly = false) {
  if (!raw || raw !== raw.trim()) return;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return;
    if (!url.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url.hostname)
      || /\.(?:localhost|example|invalid|test|local)$/.test(url.hostname) || /^example\.(com|org|net)$/.test(url.hostname)) return;
    if (originOnly && (url.pathname !== '/' || url.search)) return;
    if (originOnly && !['', '80', '88', '8443'].includes(url.port)) return;
    return url;
  } catch { return; }
}

type Button = { text: string; web_app: { url: string } } | { text: string; url: string };
export function buildBotReply(update: Extract<BotUpdate, { kind: 'command' }>, env: NodeJS.ProcessEnv = process.env) {
  const username = botUsername(env);
  if (!update.privateChat) {
    return {
      chat_id: update.chatId,
      text: 'Откройте личный чат с ботом COLONY: там можно запустить игру и обратиться в поддержку.',
      ...(username ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть бота', url: `https://t.me/${username}?start=launch` }]] } } : {}),
    };
  }
  const appUrl = publicHttpsUrl(env.APP_URL, true);
  if (!appUrl) throw new Error('APP_URL must be a public HTTPS origin');
  // Preserve referral and invitation arguments when /start opens the Mini App.
  if (update.command === 'start' && update.argument && /^[A-Za-z0-9_-]{1,512}$/.test(update.argument) && username) {
    const url = `https://t.me/${username}?startapp=${encodeURIComponent(update.argument)}`;
    return { chat_id: update.chatId, text: welcomeText, reply_markup: { inline_keyboard: [[{ text: 'Открыть COLONY', url }]] } };
  }
  const buttons: Button[][] = [[{ text: 'Открыть COLONY', web_app: { url: appUrl.toString() } }]];
  let text = update.command === 'start' ? welcomeText :
    'COLONY — игра о развитии колонии. Стройте здания, собирайте ресурсы, изучайте технологии и отправляйте экспедиции.\n\nНажмите «Открыть COLONY». Прогресс привязан к вашему Telegram-аккаунту. Уведомления включаются в настройках игры.\n\n/start — открыть игру\n/help — помощь\n/paysupport — помощь с покупками Stars';
  if (update.command === 'paysupport') {
    const supportUrl = publicHttpsUrl(env.SUPPORT_URL);
    if (env.SUPPORT_URL && !supportUrl) throw new Error('SUPPORT_URL must be a public HTTPS URL');
    text = 'Помощь с покупками Telegram Stars\n\nЕсли оплата прошла, а покупка не появилась, откройте магазин и нажмите «Проверить покупки». Если это не помогло, обратитесь в поддержку: укажите дату, товар и идентификатор платежа из чека Telegram.';
    if (supportUrl) buttons.push([{ text: 'Поддержка покупок', url: supportUrl.toString() }]);
    else text += '\n\nВ игре откройте «Обратная связь», выберите категорию «Платёж» и отправьте описание проблемы.';
  }
  return { chat_id: update.chatId, text, reply_markup: { inline_keyboard: buttons } };
}

const welcomeText = 'Добро пожаловать в COLONY!\n\nПостройте свою колонию, развивайте производство и исследуйте новые территории. Начните с короткого обучения — прогресс сохраняется в вашем Telegram-аккаунте.\n\nНажмите «Открыть COLONY», чтобы начать.\n/help — помощь · /paysupport — поддержка покупок';
