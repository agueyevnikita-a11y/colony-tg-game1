'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import styles from './SupportContact.module.css';
import { AccountClosureControls } from './AccountClosureControls';

const SUPPORT_EMAIL = 'colonygamehelpdesk@yandex.com';
const SUPPORT_SUBJECT = encodeURIComponent('COLONY: поддержка и персональные данные');

type Proof = { code: string; expiresAt: string };
type Verification = { id: string; userId: string; colonyName: string | null; issuedAt: string; verifiedAt: string; requestRef: string };
type Action = 'issue' | 'verify';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function localTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SupportContact({ authenticated = false, isAdmin = false }: { authenticated?: boolean; isAdmin?: boolean }) {
  const [proof, setProof] = useState<Proof | null>(null);
  const [expired, setExpired] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const [issueError, setIssueError] = useState('');
  const [busy, setBusy] = useState<Action | null>(null);
  const [code, setCode] = useState('');
  const [requestRef, setRequestRef] = useState('');
  const [verification, setVerification] = useState<Verification | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!authenticated) {
      controller.current?.abort();
      setProof(null); setExpired(false); setCopyNotice(''); setIssueError('');
    }
    if (!authenticated || !isAdmin) {
      setCode(''); setRequestRef(''); setVerification(null); setVerifyError('');
    }
  }, [authenticated, isAdmin]);

  useEffect(() => {
    if (!proof) return;
    const remaining = new Date(proof.expiresAt).getTime() - Date.now();
    setExpired(remaining <= 0);
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [proof]);

  async function post(path: string, body: object, action: Action) {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) throw new Error('Открой COLONY заново из Telegram, чтобы подтвердить доступ к аккаунту.');
    const abort = new AbortController();
    controller.current = abort;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; abort.abort(); }, 15_000);
    try {
      const response = await fetch(path, {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: abort.signal,
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(body),
      });
      if (response.status === 401) throw new Error('Сессия Telegram истекла. Закрой игру и открой её заново из бота.');
      const data: unknown = await response.json();
      if (!response.ok || !record(data) || data.ok !== true) {
        if (response.status < 500 && record(data) && typeof data.error === 'string' && data.error.length <= 300) throw new Error(data.error);
        throw new Error('Не удалось выполнить запрос. Попробуй ещё раз немного позже.');
      }
      return data;
    } catch (error) {
      if (timedOut) throw new Error(action === 'verify'
        ? 'Ответ сервера не получен. Проверка могла выполниться; повторный ввод кода не является новым подтверждением.'
        : 'Ответ сервера не получен. Код мог быть выпущен; попробуй получить новый код.');
      if (abort.signal.aborted) throw new Error('Запрос отменён. При необходимости повтори его.');
      if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('Не удалось связаться с сервером. Проверь соединение и попробуй ещё раз.');
      throw error;
    } finally {
      window.clearTimeout(timer);
      if (controller.current === abort) controller.current = null;
    }
  }

  async function issueProof() {
    if (!authenticated || inFlight.current) return;
    inFlight.current = true;
    setBusy('issue'); setIssueError(''); setCopyNotice(''); setProof(null); setExpired(false);
    try {
      const data = await post('/api/support/ownership-proof', {}, 'issue');
      if (typeof data.code !== 'string' || !data.code || typeof data.expiresAt !== 'string' || !Number.isFinite(new Date(data.expiresAt).getTime())) {
        throw new Error('Сервер не подтвердил выдачу кода. Попробуй получить новый код.');
      }
      if (mounted.current) setProof({ code: data.code, expiresAt: data.expiresAt });
    } catch (error) {
      if (mounted.current) setIssueError(error instanceof Error ? error.message : 'Не удалось получить код.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  async function copyProof() {
    if (!proof || expired) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(proof.code);
      if (mounted.current) setCopyNotice('Код скопирован. Вставь его в письмо поддержке.');
    } catch {
      if (mounted.current) setCopyNotice('Не удалось скопировать автоматически. Выдели код и скопируй вручную.');
    }
  }

  async function verifyProof(event: FormEvent) {
    event.preventDefault();
    if (!authenticated || !isAdmin || !code.trim() || !requestRef.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy('verify'); setVerifyError(''); setVerification(null);
    try {
      const data = await post('/api/admin/support/ownership-proof', { code: code.trim(), requestRef: requestRef.trim() }, 'verify');
      const result = data.verification;
      if (!record(result) || !['id', 'userId', 'issuedAt', 'verifiedAt', 'requestRef'].every(key => typeof result[key] === 'string' && result[key])
        || (result.colonyName !== null && typeof result.colonyName !== 'string')
        || !Number.isFinite(new Date(String(result.issuedAt)).getTime()) || !Number.isFinite(new Date(String(result.verifiedAt)).getTime())) {
        throw new Error('Ответ проверки не подтверждён. Не считай обращение проверенным по этому ответу.');
      }
      if (mounted.current) {
        setVerification({
          id: String(result.id), userId: String(result.userId), colonyName: typeof result.colonyName === 'string' ? result.colonyName : null,
          issuedAt: String(result.issuedAt), verifiedAt: String(result.verifiedAt), requestRef: String(result.requestRef),
        });
        setCode('');
      }
    } catch (error) {
      if (mounted.current) setVerifyError(error instanceof Error ? error.message : 'Не удалось проверить код.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  return <div className={styles.contact}>
    <span className={styles.label}>Поддержка и вопросы о персональных данных</span>
    <a className={styles.address} href={`mailto:${SUPPORT_EMAIL}?subject=${SUPPORT_SUBJECT}`}>{SUPPORT_EMAIL}</a>
    <AccountClosureControls authenticated={authenticated} isAdmin={isAdmin} />
    {authenticated && <div className={styles.proof}>
      <p className={styles.hint}>Код поможет связать письмо с твоим существующим аккаунтом. Он подтверждает доступ к аккаунту и не разрешает удаление или выдачу данных. Отправь его только на почту поддержки.</p>
      <p className={styles.hint}>Новый код отменяет предыдущий, если его ещё не проверили.</p>
      <button type="button" className={styles.button} disabled={busy !== null} onClick={() => void issueProof()}>{busy === 'issue' ? 'Получаем код…' : 'Получить код для обращения'}</button>
      {proof && <div className={styles.issued}>
        <span className={styles.label}>Код для письма поддержке</span>
        <code className={styles.proofCode} tabIndex={0}>{proof.code}</code>
        <span className={styles.hint}>{expired ? 'Срок действия кода истёк. Получи новый код.' : `Действует до ${localTime(proof.expiresAt)} по времени устройства.`}</span>
        <button type="button" className={styles.button} disabled={expired || busy !== null} onClick={() => void copyProof()}>Скопировать код</button>
      </div>}
      {copyNotice && <div className={styles.notice} role="status">{copyNotice}</div>}
      {issueError && <div className={styles.error} role="alert">{issueError}</div>}
    </div>}
    {isAdmin && <details className={styles.admin}>
      <summary>Проверить код обращения</summary>
      <form className={styles.form} onSubmit={event => void verifyProof(event)}>
        <label className={styles.field}>Код из письма<input type="text" value={code} maxLength={128} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy !== null || !authenticated} onChange={event => { setCode(event.target.value); setVerifyError(''); setVerification(null); }} /></label>
        <label className={styles.field}>Номер обращения<input type="text" value={requestRef} maxLength={64} pattern="[A-Za-z0-9_-]{1,64}" title="До 64 латинских букв, цифр, дефисов или знаков подчёркивания" placeholder="COLONY-20261110-001" autoComplete="off" spellCheck={false} disabled={busy !== null || !authenticated} onChange={event => { setRequestRef(event.target.value); setVerifyError(''); setVerification(null); }} /></label>
        <p className={styles.hint}>Укажи номер из журнала без ФИО и других персональных данных. Проверка одноразовая: после успешного подтверждения код использовать повторно нельзя.</p>
        <p className={styles.hint}>Проверка подтверждает доступ к аккаунту для этого обращения. Она не разрешает выгрузку или удаление данных и не выполняет эти действия.</p>
        <button type="submit" className={styles.button} disabled={busy !== null || !authenticated || !code.trim() || !requestRef.trim()}>{busy === 'verify' ? 'Проверяем код…' : 'Проверить и погасить код'}</button>
        {verifyError && <div className={styles.error} role="alert">{verifyError}</div>}
        {verification && <div className={styles.result} role="status">
          <strong>Доступ к аккаунту подтверждён для обращения. Код погашен.</strong>
          <dl>
            <dt>Обращение</dt><dd>{verification.requestRef}</dd>
            <dt>Аккаунт</dt><dd>{verification.userId}</dd>
            <dt>Колония</dt><dd>{verification.colonyName || 'Без названия'}</dd>
            <dt>Код выдан</dt><dd>{localTime(verification.issuedAt)}</dd>
            <dt>Проверен</dt><dd>{localTime(verification.verifiedAt)}</dd>
            <dt>Подтверждение</dt><dd>{verification.id}</dd>
          </dl>
          <span>Удаление и выгрузка данных не выполнялись.</span>
        </div>}
      </form>
    </details>}
  </div>;
}
