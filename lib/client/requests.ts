export class RequestCancelled extends Error {}
export class RequestInProgress extends Error {}

type RequestOptions = { background?: boolean };
type CoordinatorOptions = {
  headers: () => Record<string, string>;
  onBusy: (busy: boolean) => void;
  isOnline?: () => boolean;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

/** One foreground operation at a time; mutations supersede stale session reads. */
export function createRequestCoordinator(options: CoordinatorOptions) {
  let sequence = 0;
  let active: { id: number; session: boolean; controller: AbortController } | null = null;
  const cancel = () => { sequence++; active?.controller.abort(); active = null; options.onBusy(false); };
  return {
    cancel,
    cancelSession() { if (active?.session) cancel(); },
    async request(path: string, body: object = {}, settings: RequestOptions = {}): Promise<any> {
      const session = path === '/api/session';
      if (active) {
        if (!session && active.session) cancel();
        else throw new RequestInProgress('Дождитесь завершения текущего действия.');
      }
      if (options.isOnline?.() === false) throw new Error('Нет подключения к интернету. Подключитесь и попробуйте снова.');
      const headers = options.headers();
      const id = ++sequence;
      const controller = new AbortController();
      active = { id, session, controller };
      options.onBusy(!settings.background);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 15_000);
      try {
        const res = await (options.fetcher ?? fetch)(path, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        if (id !== sequence) throw new RequestCancelled();
        if (res.status === 401) throw new Error('Сессия Telegram истекла. Закройте Mini App и откройте её снова из бота.');
        if (res.status === 429) throw new Error('Слишком много запросов. Подождите немного и повторите действие.');
        if (res.status >= 500) throw new Error('Сервер временно недоступен. Попробуйте снова чуть позже.');
        let data;
        try { data = await res.json(); } catch { throw new Error('Сервер прислал неполный ответ. Попробуйте снова.'); }
        if (id !== sequence) throw new RequestCancelled();
        if (!res.ok || !data?.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Не удалось выполнить действие.');
        return data;
      } catch (error) {
        if (id !== sequence) throw new RequestCancelled();
        if (timedOut) throw new Error(session ? 'Сервер долго не отвечает. Проверьте подключение и попробуйте снова.' : 'Не удалось дождаться ответа. Действие могло сохраниться — обновите колонию перед повтором.');
        if (error instanceof TypeError) throw new Error('Не удалось связаться с сервером. Проверьте подключение к интернету.');
        throw error;
      } finally {
        clearTimeout(timer);
        if (active?.id === id) { active = null; options.onBusy(false); }
      }
    },
  };
}
