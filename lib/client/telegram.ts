export type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { id: number; first_name: string } };
  version?: string;
  isActive?: boolean;
  viewportStableHeight?: number;
  ready: () => void;
  expand: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
  openInvoice?: (url: string, cb?: (status: string) => void) => void;
  openTelegramLink?: (url: string) => void;
  requestWriteAccess?: (cb?: (granted: boolean) => void) => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  HapticFeedback?: { impactOccurred: (style: string) => void };
};

declare global {
  interface Window { Telegram?: { WebApp: TelegramWebApp } }
}

export function telegramHeaders(initData: string, development: boolean): Record<string, string> {
  if (!initData && !development) throw new Error('Откройте COLONY из Telegram, чтобы войти в колонию.');
  return { 'content-type': 'application/json', ...(initData ? { 'x-telegram-init-data': initData } : { 'x-dev-user-id': '10001' }) };
}

export function botAppLink(username: string | undefined, startParam?: string): string | null {
  const bot = username?.trim().replace(/^@/, '') ?? '';
  if (!/^[a-z][a-z\d_]{4,31}$/i.test(bot) || !/bot$/i.test(bot) || /replace[_-]?me|replace[_-]?with|change[_-]?me|placeholder|your[_-]|example/i.test(bot)) return null;
  if (startParam !== undefined && !/^[a-zA-Z0-9_-]{1,512}$/.test(startParam)) return null;
  return `https://t.me/${bot}?startapp=${startParam ? encodeURIComponent(startParam) : ''}`;
}

export function playerStartParam(kind: 'ref' | 'city', id: unknown): string | undefined {
  const value = Number(id);
  return Number.isSafeInteger(value) && value > 0 ? `${kind}_${value}` : undefined;
}

export function supportsTelegram(app: TelegramWebApp | undefined, minimumVersion: string): boolean {
  if (!app?.initData) return false;
  if (app.isVersionAtLeast) return app.isVersionAtLeast(minimumVersion);
  const actual = (app.version ?? '0').split('.').map(Number);
  const wanted = minimumVersion.split('.').map(Number);
  for (let i = 0; i < Math.max(actual.length, wanted.length); i++) {
    if ((actual[i] ?? 0) !== (wanted[i] ?? 0)) return (actual[i] ?? 0) > (wanted[i] ?? 0);
  }
  return true;
}

/** Resolve even when the SDK CDN is unavailable; the launch gate can retry it. */
export function waitForTelegram(signal: AbortSignal, timeoutMs = 8_000, read = () => window.Telegram?.WebApp): Promise<TelegramWebApp | undefined> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const finish = (app?: TelegramWebApp) => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); resolve(app); };
    const onAbort = () => finish();
    const check = () => {
      if (signal.aborted) return finish();
      const app = read();
      if (app || Date.now() - started >= timeoutMs) return finish(app);
      timer = setTimeout(check, 100);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    check();
  });
}

export function retryTelegramScript() {
  if (window.Telegram?.WebApp) return;
  document.getElementById('telegram-sdk-retry')?.remove();
  const script = document.createElement('script');
  script.id = 'telegram-sdk-retry';
  script.src = 'https://telegram.org/js/telegram-web-app.js?63';
  script.async = true;
  document.head.append(script);
}

export async function shareTelegramLink(link: string, text: string, app: TelegramWebApp | undefined, browser: Pick<Navigator, 'share' | 'clipboard'>): Promise<'shared' | 'copied' | 'cancelled' | 'manual'> {
  if (supportsTelegram(app, '6.1') && app?.openTelegramLink) {
    try { app.openTelegramLink(`https://t.me/share/url?${new URLSearchParams({ url: link, text })}`); return 'shared'; } catch { /* Try browser sharing below. */ }
  }
  if (browser.share) {
    try { await browser.share({ text, url: link }); return 'shared'; }
    catch (error) { if (error instanceof Error && error.name === 'AbortError') return 'cancelled'; }
  }
  try {
    if (!browser.clipboard?.writeText) return 'manual';
    await browser.clipboard.writeText(link);
    return 'copied';
  } catch { return 'manual'; }
}
