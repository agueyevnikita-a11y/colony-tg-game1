'use client';

import { useEffect, useRef, useState } from 'react';
import { selectedLocalProfile } from '../lib/client/local-profile';
import { LOCAL_PROFILES, localProfileByKey, type LocalProfile, type LocalProfileKey } from '../lib/game/local-profiles';

function isProfile(value: unknown): value is LocalProfile {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const expected = localProfileByKey(item.key);
  return expected !== null && item.id === expected.id && item.label === expected.label && item.description === expected.description;
}

function errorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object') return fallback;
  const message = (body as Record<string, unknown>).error;
  return typeof message === 'string' && message.length > 0 && message.length < 500 ? message : fallback;
}

/** Mounted only by the development sandbox layout. No local accounts in production. */
export function LocalDevPanel() {
  const [selected, setSelected] = useState<LocalProfileKey>('personal');
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<LocalProfileKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    setSelected(selectedLocalProfile(window.location.search).key);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch('/api/local/profiles', { cache: 'no-store', signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) throw new Error(errorMessage(body, 'Не удалось загрузить тестовые города. Повтори попытку.'));
        if (!Array.isArray(body.profiles) || body.profiles.length !== LOCAL_PROFILES.length || !body.profiles.every(isProfile)
          || new Set(body.profiles.map((item: LocalProfile) => item.key)).size !== LOCAL_PROFILES.length) throw new Error('Список тестовых городов недоступен. Повтори загрузку.');
        if (active) setProfiles(body.profiles);
      } catch (cause) {
        if (active && (!controller.signal.aborted || timedOut)) setError(timedOut ? 'Список городов долго загружается. Повтори попытку.' : cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Не удалось загрузить тестовые города. Проверь локальный сервер и повтори попытку.');
      } finally { window.clearTimeout(timer); if (active) setLoading(false); }
    })();
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [retry]);

  async function select(profile: LocalProfile) {
    if (guard.current || loading || pending || profile.key === selected) return;
    guard.current = true;
    setPending(profile.key);
    setError(null);
    try {
      const response = await fetch('/api/local/profiles', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: profile.key }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(errorMessage(body, 'Не удалось подготовить город. Попробуй ещё раз.'));
      if (!isProfile(body.profile) || body.profile.key !== profile.key) throw new Error('Город не подтверждён сервером. Попробуй ещё раз.');
      const next = new URL(window.location.href);
      if (profile.key === 'personal') next.searchParams.delete('local_profile');
      else next.searchParams.set('local_profile', profile.key);
      // A full navigation discards old polls, pending actions and tab-local UI.
      // The profile parameter belongs to this tab and never changes another tab.
      window.location.assign(next.href);
    } catch (cause) {
      const aborted = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      setError(aborted ? 'Сервер долго готовит город. Повтори попытку — сохранённый город не сбросится.' : cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Не удалось открыть город. Проверь локальный сервер и попробуй ещё раз.');
      guard.current = false;
      setPending(null);
    }
  }

  const selectedLabel = localProfileByKey(selected)?.label ?? LOCAL_PROFILES[0].label;
  return <aside className="localDevBanner" data-local-dev-panel aria-label="Локальный тестовый стенд">
    <strong>COLONY · локальный стенд</strong>
    <span>Тестовые сохранения на этом компьютере. Stars и отправка сообщений боту отключены.</span>
    <details className="localDevProfiles">
      <summary><strong>Тестовые города</strong><span data-local-current-profile={selected}>{selectedLabel}</span></summary>
      <p>У каждого города свои сохранения. Переключение не сбрасывает прогресс.</p>
      {loading && <p className="localDevFeedback" role="status">Загружаем тестовые города…</p>}
      {!loading && profiles.length > 0 && <div className="localDevProfileList" role="group" aria-label="Выбрать тестовый город" aria-busy={pending !== null}>{profiles.map(profile => <button key={profile.key} type="button" className={`localDevProfile${profile.key === selected ? ' isSelected' : ''}`}
        data-local-profile={profile.key} aria-pressed={profile.key === selected} disabled={loading || pending !== null || profile.key === selected} onClick={() => void select(profile)}>
        <strong>{profile.label}</strong><span>{profile.description}</span><small>{pending === profile.key ? 'Подготавливаем город…' : profile.key === selected ? 'Сейчас открыт' : 'Открыть город'}</small>
      </button>)}</div>}
      {pending && <p className="localDevFeedback" data-local-profile-feedback role="status">Подготавливаем город и открываем его сохранение…</p>}
      {error && <div className="localDevFeedback isError" data-local-profile-error role="alert"><span>{error}</span>{profiles.length === 0 && <button type="button" disabled={loading || pending !== null} onClick={() => setRetry(value => value + 1)}>Повторить загрузку</button>}</div>}
    </details>
  </aside>;
}
