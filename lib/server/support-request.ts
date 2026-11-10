import { NextResponse } from 'next/server';
import { validateTelegramInitData, TelegramAuthError } from './telegram-auth';
import { RateLimitError } from './rate-limit';
import { SupportOwnershipError } from './support-ownership';

export const supportHeaders = { 'Cache-Control': 'no-store, private', 'Pragma': 'no-cache' };

export function supportAuth(request: Request) {
  const auth = validateTelegramInitData(request.headers.get('x-telegram-init-data') || '', 300);
  // Signed headers are still required when Origin is absent (e.g. native clients).
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(process.env.APP_URL || request.url).origin) {
    throw new SupportOwnershipError(403, 'Откройте игру через её Telegram-бота.');
  }
  return auth;
}

export async function supportBody(request: Request, allowedKeys: readonly string[]) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new SupportOwnershipError(400, 'Не удалось прочитать запрос. Попробуйте снова.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SupportOwnershipError(400, 'Не удалось прочитать запрос.');
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) { await reader.cancel(); throw new SupportOwnershipError(400, 'Запрос слишком большой.'); }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowedKeys.includes(key))) {
      throw new SupportOwnershipError(400, 'Запрос содержит неподдерживаемые поля.');
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SupportOwnershipError) throw error;
    throw new SupportOwnershipError(400, 'Не удалось прочитать запрос.');
  } finally { reader.releaseLock(); }
}

export function supportError(error: unknown) {
  if (error instanceof TelegramAuthError) return NextResponse.json({ ok: false, error: 'Закройте игру и заново откройте её через Telegram, затем повторите действие.' }, { status: 401, headers: supportHeaders });
  if (error instanceof RateLimitError) return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: { ...supportHeaders, 'Retry-After': String(error.retryAfterSec) } });
  if (error instanceof SupportOwnershipError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status, headers: supportHeaders });
  // Never log initData, codes, bodies or database exceptions here.
  return NextResponse.json({ ok: false, error: 'Подтверждение временно недоступно. Попробуйте позже или напишите в поддержку без кода.' }, { status: 503, headers: supportHeaders });
}
