import { createHash, timingSafeEqual } from 'node:crypto';

export function matchesWebhookSecret(received: string | null, expected: string) {
  if (!received || !expected) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

export class TelegramApiError extends Error {
  readonly method: string;
  readonly status?: number;
  constructor(method: string, status?: number, timedOut = false) {
    super(`Telegram ${method} ${timedOut ? 'timed out' : 'failed'}${status ? ` (${status})` : ''}`);
    this.method = method;
    this.status = status;
    this.name = 'TelegramApiError';
  }
}

// Never retain fetch errors or Telegram descriptions: they may contain the bot token or user data.
export async function callTelegramApi<T = unknown>(
  token: string,
  method: 'sendMessage' | 'answerPreCheckoutQuery',
  body: object,
  timeoutMs = 4000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) throw new TelegramApiError(method, response.status);
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
      throw new TelegramApiError(method, response.status);
    }
    return ('result' in result ? result.result : undefined) as T;
  } catch (error) {
    if (error instanceof TelegramApiError) throw error;
    throw new TelegramApiError(method, undefined, controller.signal.aborted);
  } finally {
    clearTimeout(timer);
  }
}

export async function withDeadline<T>(pending: PromiseLike<T> & { cancel?: () => void }, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(pending),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Telegram purchase verification timed out'));
          try { pending.cancel?.(); } catch { /* Deadline still applies if cancellation fails. */ }
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
