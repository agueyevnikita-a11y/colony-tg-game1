import crypto from 'node:crypto';

export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
};

export class TelegramAuthError extends Error {
  readonly code: 'TELEGRAM_AUTH_REQUIRED' | 'TELEGRAM_AUTH_INVALID' | 'TELEGRAM_AUTH_EXPIRED';
  constructor(code: TelegramAuthError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'TelegramAuthError';
  }
}

export type ValidatedInitData = {
  user: TelegramUser;
  startParam?: string;
  authDate: number;
};

function safeEqualHex(a: string, b: string) {
  if (!/^[a-f\d]{64}$/i.test(a) || !/^[a-f\d]{64}$/i.test(b)) return false;
  try {
    const aa = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

export function validateTelegramInitData(raw: string, maxAgeSeconds = 3600): ValidatedInitData {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) throw new Error('BOT_TOKEN is not configured');
  if (!raw) throw new TelegramAuthError('TELEGRAM_AUTH_REQUIRED', 'Missing Telegram initData');

  const params = new URLSearchParams(raw);
  if (new Set(params.keys()).size !== [...params.keys()].length) throw new TelegramAuthError('TELEGRAM_AUTH_INVALID', 'Duplicate initData fields');
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new TelegramAuthError('TELEGRAM_AUTH_INVALID', 'Missing initData hash');

  const entries = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!safeEqualHex(receivedHash, calculatedHash)) throw new TelegramAuthError('TELEGRAM_AUTH_INVALID', 'Invalid Telegram initData signature');

  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) throw new TelegramAuthError('TELEGRAM_AUTH_INVALID', 'Invalid auth_date');
  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 30 || now - authDate > maxAgeSeconds) throw new TelegramAuthError('TELEGRAM_AUTH_EXPIRED', 'Telegram initData expired');

  const userJson = params.get('user');
  if (!userJson) throw new TelegramAuthError('TELEGRAM_AUTH_INVALID', 'Missing Telegram user');
  let user: TelegramUser;
  try { user = JSON.parse(userJson) as TelegramUser; }
  catch { throw new TelegramAuthError('TELEGRAM_AUTH_INVALID', 'Invalid Telegram user'); }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string'
    || (user.allows_write_to_pm !== undefined && typeof user.allows_write_to_pm !== 'boolean')) {
    throw new TelegramAuthError('TELEGRAM_AUTH_INVALID', 'Invalid Telegram user');
  }

  return {
    user,
    authDate,
    startParam: params.get('start_param') ?? undefined,
  };
}

export function getInitDataFromRequest(request: Request) {
  const raw = request.headers.get('x-telegram-init-data') ?? '';
  if (raw) return validateTelegramInitData(raw);

  if (process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_AUTH === 'true') {
    const devId = Number(request.headers.get('x-dev-user-id') ?? '10001');
    if (!Number.isSafeInteger(devId) || devId <= 0) throw new TelegramAuthError('TELEGRAM_AUTH_INVALID', 'Invalid development user ID');
    return {
      user: { id: devId, first_name: 'Dev', username: `dev_${devId}` },
      authDate: Math.floor(Date.now() / 1000),
      startParam: request.headers.get('x-dev-start-param') ?? undefined,
    } satisfies ValidatedInitData;
  }
  throw new TelegramAuthError('TELEGRAM_AUTH_REQUIRED', 'Unauthorized');
}
