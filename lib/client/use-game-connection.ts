'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createRequestCoordinator, RequestCancelled, RequestInProgress } from './requests';
import { retryTelegramScript, telegramHeaders, waitForTelegram } from './telegram';
import { localProfileHeaders, selectedLocalProfile } from './local-profile';

const development = process.env.NODE_ENV === 'development';
const localSandbox = development && process.env.NEXT_PUBLIC_LOCAL_DEV === 'true';
export type LaunchPhase = 'loading' | 'ready' | 'outside' | 'sdk-error';

export function useGameConnection() {
  const [game, setGame] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [phase, setPhase] = useState<LaunchPhase>('loading');
  const [attempt, setAttempt] = useState(0);
  const localPreparation = useRef<{ controller: AbortController; promise: Promise<boolean> } | null>(null);
  const coordinator = useRef<ReturnType<typeof createRequestCoordinator> | null>(null);
  if (!coordinator.current) coordinator.current = createRequestCoordinator({
    headers: () => localProfileHeaders(telegramHeaders(window.Telegram?.WebApp?.initData ?? '', development), window.location.search, localSandbox),
    onBusy: setBusy,
    isOnline: () => navigator.onLine,
  });

  const api = useCallback(async (path: string, body: object = {}, background = false) => {
    if (!background) setMessage('');
    try {
      const data = await coordinator.current!.request(path, body, { background });
      setConnectionError('');
      if (path === '/api/session') setGame(data);
      else if (data.state) setGame((old: any) => ({ ...(old ?? {}), ...data }));
      return data;
    } catch (error) {
      if (!(error instanceof RequestCancelled) && !(error instanceof RequestInProgress && background)) {
        const text = error instanceof Error ? error.message : 'Не удалось выполнить действие.';
        if (path === '/api/session') setConnectionError(text);
        if (!background) setMessage(text);
      }
      throw error;
    }
  }, []);

  const prepareLocalProfile = useCallback((): Promise<boolean> => {
    if (!localSandbox) return Promise.resolve(true);
    if (localPreparation.current) return localPreparation.current.promise;
    const preparation = { controller: new AbortController(), promise: Promise.resolve(false) };
    localPreparation.current = preparation;
    preparation.promise = (async () => {
      const timeout = window.setTimeout(() => preparation.controller.abort(), 15000);
      let prepared = false;
      try {
        const profile = selectedLocalProfile(window.location.search);
        const response = await fetch('/api/local/profiles', {
          method: 'POST', signal: preparation.controller.signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: profile.key }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok || result.profile?.id !== profile.id || result.profile?.key !== profile.key) throw new Error('Local profile preparation failed');
        prepared = true;
        return true;
      } catch {
        if (localPreparation.current === preparation) setConnectionError('Не удалось подготовить тестовый город. Проверь локальный сервер и попробуй снова.');
        return false;
      } finally {
        window.clearTimeout(timeout);
        if (!prepared && localPreparation.current === preparation) localPreparation.current = null;
      }
    })();
    return preparation.promise;
  }, []);

  const refresh = useCallback(async (background = false) => {
    try {
      if (!await prepareLocalProfile()) return null;
      return await api('/api/session', {}, background);
    } catch { return null; }
  }, [api, prepareLocalProfile]);

  useEffect(() => {
    let stopped = false;
    let polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let app: Window['Telegram'];
    const visible = () => document.visibilityState !== 'hidden' && navigator.onLine && app?.WebApp.isActive !== false;
    const poll = async () => {
      clearTimeout(timer);
      if (stopped || polling) return;
      polling = true;
      if (visible()) await refresh(true);
      polling = false;
      clearTimeout(timer);
      if (!stopped && visible()) timer = setTimeout(poll, 30_000);
    };
    const wake = () => {
      if (stopped) return;
      if (visible()) { clearTimeout(timer); timer = setTimeout(poll, 0); }
      else { clearTimeout(timer); coordinator.current?.cancelSession(); }
    };
    const offline = () => { setConnectionError('Нет подключения к интернету. Колония обновится после восстановления связи.'); wake(); };
    void (async () => {
      setPhase('loading');
      setMessage('');
      const sdk = development ? window.Telegram?.WebApp : await waitForTelegram(controller.signal);
      if (stopped) return;
      if (!sdk && !development) { setPhase('sdk-error'); return; }
      if (sdk) {
        app = { WebApp: sdk };
        try { sdk.ready(); sdk.expand(); } catch { /* Keep the launch gate usable in older clients. */ }
      }
      if (!sdk?.initData && !development) { setPhase('outside'); return; }
      setPhase('ready');
      document.addEventListener('visibilitychange', wake);
      window.addEventListener('online', wake);
      window.addEventListener('offline', offline);
      sdk?.onEvent?.('activated', wake);
      sdk?.onEvent?.('deactivated', wake);
      if (!navigator.onLine) offline();
      await poll();
    })();
    return () => {
      stopped = true;
      controller.abort();
      const preparation = localPreparation.current;
      localPreparation.current = null;
      preparation?.controller.abort();
      clearTimeout(timer);
      coordinator.current?.cancel();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', offline);
      app?.WebApp.offEvent?.('activated', wake);
      app?.WebApp.offEvent?.('deactivated', wake);
    };
  }, [attempt, refresh]);

  const retry = () => { retryTelegramScript(); setAttempt((value) => value + 1); };
  return { game, setGame, busy, message, setMessage, phase, retry, api, refresh, connectionError };
}
