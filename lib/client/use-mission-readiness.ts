'use client';

import { useEffect, useMemo, useState } from 'react';
import { missionReadiness, type MissionReadinessSnapshot, type MissionReadyCounts } from '../game/mission-readiness';

const MAX_TIMEOUT = 2_147_483_647;

/** Refresh badges at period boundaries and on return to the app, without a page-wide ticking clock. */
export function useMissionReadiness(game: MissionReadinessSnapshot | null | undefined): MissionReadyCounts {
  const [revision, setRevision] = useState(0);
  const readiness = useMemo(() => missionReadiness(game, Date.now()), [game, revision]);

  useEffect(() => {
    if (readiness.nextChangeAt === null) return;
    const delay = Math.min(MAX_TIMEOUT, Math.max(1, readiness.nextChangeAt - Date.now()));
    const timer = window.setTimeout(() => setRevision(value => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [readiness]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  return readiness.counts;
}
