'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import styles from './AccountClosureControls.module.css';

const CLOSE_CONFIRMATION = 'ЗАКРЫТЬ АККАУНТ';
const CANCEL_CONFIRMATION = 'ОТОЗВАТЬ ЗАПРОС';

const statusText = {
  requested: { label: 'Заявка получена', detail: 'Игровой доступ закрыт. Оператор рассмотрит удаление рабочей базы и копий отдельно.' },
  cancelled: { label: 'Заявка отозвана', detail: 'Для возобновления участия закрой игру и заново открой её из бота.' },
  active_data_erased: { label: 'Рабочая база обработана', detail: 'Игровые данные удалены из рабочей базы. Проверка копий ещё не завершена.' },
  copies_pending: { label: 'Ожидаются действия с копиями', detail: 'Проверка и удаление из резервных и других копий ещё не завершены.' },
  completed: { label: 'Исполнение заявки завершено', detail: 'Подробности выполненных действий и сохраняемых на законном основании сведений можно уточнить у поддержки.' },
} as const;

type ClosureStatus = keyof typeof statusText;
type ClosureRequest = { id: string; status: ClosureStatus; requestedAt: string; updatedAt: string };
type AdminRequest = ClosureRequest & { userId: string };
type DeletionPlan = {
  request: { id: string; status: ClosureStatus };
  counts: Record<string, number>;
  blockers: { code: string; count: number }[];
  categories: string[];
  copiesStatus: 'not_reviewed';
  executable: false;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function validStatus(value: unknown): value is ClosureStatus {
  return typeof value === 'string' && Object.hasOwn(statusText, value);
}

function dateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function parseRequest(value: unknown): ClosureRequest {
  if (!record(value) || !identifier(value.id) || !validStatus(value.status) || !dateString(value.requestedAt) || !dateString(value.updatedAt)) {
    throw new Error('Сервер не подтвердил состояние заявки. Проверь её ещё раз.');
  }
  return { id: value.id, status: value.status, requestedAt: value.requestedAt, updatedAt: value.updatedAt };
}

function parseAdminRequests(value: unknown): AdminRequest[] {
  if (!Array.isArray(value)) throw new Error('Не удалось прочитать список заявок.');
  return value.map(item => {
    if (!record(item) || !identifier(item.userId)) throw new Error('Сервер не подтвердил аккаунт заявки.');
    return { ...parseRequest(item), userId: item.userId };
  });
}

function parsePlan(value: unknown): DeletionPlan {
  if (!record(value) || !record(value.request) || !identifier(value.request.id) || !validStatus(value.request.status)
    || !record(value.counts) || !Object.values(value.counts).every(count => Number.isSafeInteger(count) && Number(count) >= 0)
    || !Array.isArray(value.blockers) || !value.blockers.every(item => record(item) && identifier(item.code) && Number.isSafeInteger(item.count) && Number(item.count) >= 0)
    || !Array.isArray(value.categories) || !value.categories.every(category => typeof category === 'string' && category.length <= 200)
    || value.copiesStatus !== 'not_reviewed' || value.executable !== false) {
    throw new Error('Сервер не подтвердил безопасный план просмотра. Удаление не запускалось.');
  }
  return value as DeletionPlan;
}

function localTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function RequestSummary({ request }: { request: ClosureRequest }) {
  return <div className={styles.result}>
    <strong>{statusText[request.status].label}</strong>
    <p>{statusText[request.status].detail}</p>
    <dl className={styles.facts}>
      <dt>Номер заявки</dt><dd><code>{request.id}</code></dd>
      <dt>Подана</dt><dd>{localTime(request.requestedAt)}</dd>
      <dt>Обновлена</dt><dd>{localTime(request.updatedAt)}</dd>
    </dl>
  </div>;
}

export function AccountClosureControls({ authenticated = false, isAdmin = false }: { authenticated?: boolean; isAdmin?: boolean }) {
  const [request, setRequest] = useState<ClosureRequest | null>();
  const [confirmation, setConfirmation] = useState('');
  const [cancelConfirmation, setCancelConfirmation] = useState('');
  const [requests, setRequests] = useState<AdminRequest[] | null>(null);
  const [plans, setPlans] = useState<Record<string, DeletionPlan>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const closeId = useId();
  const cancelId = useId();
  const errorId = useId();
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; controller.current?.abort(); };
  }, []);

  useEffect(() => {
    generation.current++;
    controller.current?.abort();
    setBusy(null); setError(''); setNotice('');
    if (!authenticated) {
      setRequest(undefined); setConfirmation(''); setCancelConfirmation('');
    }
    if (!authenticated || !isAdmin) { setRequests(null); setPlans({}); }
  }, [authenticated, isAdmin]);

  async function post(path: string, body: object, mutation: boolean) {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) throw new Error('Закрой игру и заново открой её через Telegram-бота.');
    const abort = new AbortController();
    controller.current = abort;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; abort.abort(); }, 15_000);
    try {
      const response = await fetch(path, {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: abort.signal,
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData }, body: JSON.stringify(body),
      });
      if (response.status === 401) throw new Error('Сессия Telegram истекла. Закрой игру и открой её заново из бота.');
      const data: unknown = await response.json();
      if (!response.ok || !record(data) || data.ok !== true) {
        if (response.status < 500 && record(data) && typeof data.error === 'string' && data.error.length <= 300) throw new Error(data.error);
        throw new Error('Сервис заявок временно недоступен. Попробуй позже.');
      }
      return data;
    } catch (caught) {
      if (timedOut) throw new Error(mutation
        ? 'Ответ сервера не получен. Действие могло сохраниться. Сначала нажми «Проверить мою заявку».'
        : 'Ответ сервера не получен. Попробуй проверить состояние ещё раз.');
      if (abort.signal.aborted) throw new Error('Запрос отменён. При необходимости повтори проверку.');
      if (caught instanceof TypeError || caught instanceof SyntaxError) throw new Error('Не удалось связаться с сервером. Проверь соединение и состояние заявки.');
      throw caught;
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === abort) controller.current = null;
    }
  }

  async function run(action: string, work: () => Promise<() => void>) {
    if (!authenticated || inFlight.current) return;
    inFlight.current = true;
    const current = generation.current;
    setBusy(action); setError(''); setNotice('');
    try {
      const apply = await work();
      if (mounted.current && generation.current === current) apply();
    } catch (caught) {
      if (mounted.current && generation.current === current) setError(caught instanceof Error ? caught.message : 'Не удалось выполнить запрос.');
    } finally {
      inFlight.current = false;
      if (mounted.current && generation.current === current) setBusy(null);
    }
  }

  function checkRequest() {
    return run('status', async () => {
      const data = await post('/api/account/closure/status', {}, false);
      const next = data.request === null ? null : parseRequest(data.request);
      return () => { setRequest(next); setConfirmation(''); setCancelConfirmation(''); };
    });
  }

  function requestClosure(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== CLOSE_CONFIRMATION || request === undefined || (request && request.status !== 'cancelled')) return;
    return run('request', async () => {
      const data = await post('/api/account/closure/request', { confirmation: CLOSE_CONFIRMATION }, true);
      const next = parseRequest(data.request);
      if (next.status !== 'requested') throw new Error('Сервер не подтвердил подачу заявки. Проверь её состояние.');
      return () => {
        setRequest(next); setConfirmation(''); setCancelConfirmation('');
        setNotice('Заявка принята, игровой доступ закрыт. Закрой игру и открой её заново из бота. Удаление рабочей базы и копий рассматривается отдельно.');
      };
    });
  }

  function cancelClosure(event: FormEvent) {
    event.preventDefault();
    if (!request || request.status !== 'requested' || cancelConfirmation !== CANCEL_CONFIRMATION) return;
    const requestId = request.id;
    return run('cancel', async () => {
      const data = await post('/api/account/closure/cancel', { requestId, confirmation: CANCEL_CONFIRMATION }, true);
      const next = parseRequest(data.request);
      if (next.status !== 'cancelled') throw new Error('Сервер не подтвердил отзыв заявки. Проверь её состояние.');
      return () => {
        setRequest(next); setConfirmation(''); setCancelConfirmation('');
        setNotice('Заявка отозвана. Для возобновления участия закрой игру и заново открой её из бота.');
      };
    });
  }

  function listRequests() {
    if (!isAdmin) return;
    return run('list', async () => {
      const data = await post('/api/admin/account-closures/list', {}, false);
      const next = parseAdminRequests(data.requests);
      return () => { setRequests(next); setPlans({}); };
    });
  }

  function loadPlan(requestId: string) {
    if (!isAdmin) return;
    return run(`plan:${requestId}`, async () => {
      const data = await post('/api/admin/account-closures/plan', { requestId }, false);
      const next = parsePlan(data.plan);
      if (next.request.id !== requestId) throw new Error('Сервер вернул план другой заявки. Обнови список.');
      return () => setPlans(previous => ({ ...previous, [requestId]: next }));
    });
  }

  if (!authenticated) return null;

  return <div className={styles.controls}>
    <details className={styles.section}>
      <summary>Закрытие аккаунта и удаление данных</summary>
      <div className={styles.content}>
        <p>После подачи заявки игровой доступ остановится. Оператор рассмотрит удаление данных из рабочей базы и резервных копий отдельно. Подтверждение подачи показывает состояние заявки, а не завершение всех действий с данными.</p>
        <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void checkRequest()}>{busy === 'status' ? 'Проверяем заявку…' : 'Проверить мою заявку'}</button>
        {request === undefined && <p className={styles.hint}>Сначала проверь свою заявку. После проверки здесь появится её состояние или форма подачи.</p>}
        {request === null && <p className={styles.hint}>Заявок на закрытие аккаунта пока нет.</p>}
        {request && <RequestSummary request={request} />}
        {(request === null || request?.status === 'cancelled') && <form className={styles.form} onSubmit={event => void requestClosure(event)}>
          <label className={styles.field} htmlFor={closeId}>Для подачи введи точно: {CLOSE_CONFIRMATION}</label>
          <input id={closeId} className={styles.input} value={confirmation} maxLength={40} autoComplete="off" spellCheck={false} disabled={busy !== null} aria-describedby={error ? errorId : undefined} onChange={event => setConfirmation(event.target.value)} />
          <button className={`${styles.button} ${styles.danger}`} type="submit" disabled={busy !== null || confirmation !== CLOSE_CONFIRMATION}>{busy === 'request' ? 'Подаём заявку…' : 'Закрыть аккаунт и подать заявку'}</button>
        </form>}
        {request?.status === 'requested' && <form className={styles.form} onSubmit={event => void cancelClosure(event)}>
          <p className={styles.hint}>Пока заявка ожидает исполнения, её можно отозвать и возобновить участие.</p>
          <label className={styles.field} htmlFor={cancelId}>Для отзыва введи точно: {CANCEL_CONFIRMATION}</label>
          <input id={cancelId} className={styles.input} value={cancelConfirmation} maxLength={40} autoComplete="off" spellCheck={false} disabled={busy !== null} aria-describedby={error ? errorId : undefined} onChange={event => setCancelConfirmation(event.target.value)} />
          <button className={styles.button} type="submit" disabled={busy !== null || cancelConfirmation !== CANCEL_CONFIRMATION}>{busy === 'cancel' ? 'Отзываем заявку…' : 'Отозвать заявку и возобновить участие'}</button>
        </form>}
      </div>
    </details>
    {isAdmin && <details className={styles.section}>
      <summary>Заявки на закрытие</summary>
      <div className={styles.content}>
        <p className={styles.hint}>Здесь доступны список и план просмотра. Исполнение удаления, проверка копий и оформление подтверждений требуют отдельного действия оператора.</p>
        <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void listRequests()}>{busy === 'list' ? 'Загружаем заявки…' : 'Обновить список заявок'}</button>
        {requests?.length === 0 && <p className={styles.hint}>Заявок пока нет.</p>}
        {requests?.map(item => <article className={styles.request} key={item.id}>
          <RequestSummary request={item} />
          <p className={styles.hint}>Аккаунт: <code>{item.userId}</code></p>
          <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void loadPlan(item.id)}>{busy === `plan:${item.id}` ? 'Получаем план…' : 'План удаления'}</button>
          {plans[item.id] && <div className={styles.plan}>
            <strong>План просмотра заявки</strong>
            <p>Копии ещё не проверены. Исполнение удаления из этой формы недоступно.</p>
            <p>Состояние: {statusText[plans[item.id].request.status].label}</p>
            {plans[item.id].categories.length > 0 && <div><b>Категории данных</b><ul>{plans[item.id].categories.map((category, index) => <li key={`${category}:${index}`}>{category}</li>)}</ul></div>}
            {Object.keys(plans[item.id].counts).length > 0 && <div><b>Найденные записи</b><dl className={styles.counts}>{Object.entries(plans[item.id].counts).map(([key, count]) => <div key={key}><dt>{key}</dt><dd>{count}</dd></div>)}</dl></div>}
            {plans[item.id].blockers.length > 0 && <div><b>Требуют отдельного разбора</b><ul>{plans[item.id].blockers.map((blocker, index) => <li key={`${blocker.code}:${index}`}>{blocker.code}: {blocker.count}</li>)}</ul></div>}
          </div>}
        </article>)}
      </div>
    </details>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    {error && <div id={errorId} className={styles.error} role="alert">{error}</div>}
  </div>;
}
