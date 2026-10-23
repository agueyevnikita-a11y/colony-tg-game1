'use client';

import { useEffect, useState } from 'react';
import { GameIcon } from '@/components/GameIcon';
import { durationText } from '@/lib/game/format';

export function ConstructionStatus({ building, busy, onRefresh }: { building: {
  status: string; completes_at?: string | null; updated_at?: string; created_at?: string; target_level?: number;
}; busy: boolean; onRefresh: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [building.completes_at]);
  const end = Date.parse(building.completes_at ?? '');
  if (building.status === 'active' || !Number.isFinite(end)) return null;
  const start = Date.parse(building.updated_at ?? building.created_at ?? '');
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  const progress = Number.isFinite(start) ? Math.max(0, Math.min(100, (now - start) / Math.max(1, end - start) * 100)) : null;
  const time = durationText(seconds);
  return <div className="constructionStatus">
    <div><GameIcon name="clock" size={20} /><strong>{seconds ? building.status === 'upgrading' ? 'Улучшение идёт' : 'Строительство идёт' : 'Время строительства вышло'}</strong><span>{seconds ? time : 'Обнови город'}</span></div>
    {progress !== null && <div className="constructionProgress" role="progressbar" aria-label="Готовность здания" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }} /></div>}
    <p>{seconds ? 'Работы продолжатся, даже если закрыть игру.' : 'Проверь результат, чтобы здание начало работать.'}</p>
    {!seconds && <button type="button" className="miniButton" disabled={busy} onClick={onRefresh}>Проверить готовность</button>}
  </div>;
}
