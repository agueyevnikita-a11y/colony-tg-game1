import type { CSSProperties } from 'react';
import { GameIcon } from '@/components/GameIcon';
import '@/app/progression-visuals.css';

type Props = { achievementKey: string; stat?: string; target: number; unlocked: boolean; claimed: boolean };

const FAMILIES: Record<string, { icon: string; color: string }> = {
  buildings_started: { icon: 'build', color: '#d7bb84' },
  foundry_jobs_started: { icon: 'parts', color: '#e5ad86' },
  contracts_completed: { icon: 'market', color: '#d9ce91' },
  qualified_referrals: { icon: 'network', color: '#8bd7ba' },
  market_trades_bought: { icon: 'market', color: '#9bc4e2' },
  research_completed: { icon: 'research', color: '#94d4db' },
  expeditions_completed: { icon: 'rocket', color: '#b9b0e5' },
  unique_artifacts_found: { icon: 'artifact_lens', color: '#c6ace7' },
  max_comfort: { icon: 'comfort', color: '#a0d5aa' },
};

export function AchievementEmblem({ achievementKey, stat, target, unlocked, claimed }: Props) {
  const family = FAMILIES[stat ?? ''] ?? { icon: 'trophy', color: '#b3c8c9' };
  const rank = target >= 100 ? 3 : target >= 10 ? 2 : 1;
  return <span className={`achievementEmblem ${unlocked ? 'isUnlocked' : 'isLocked'} ${claimed ? 'isClaimed' : ''}`}
    data-achievement-emblem={achievementKey} style={{ '--emblem-color': family.color } as CSSProperties} aria-hidden="true">
    <svg className="achievementEmblemFrame" viewBox="0 0 64 72" focusable="false"><path d="m32 3 26 15v35L32 69 6 53V18L32 3Z" fill="var(--emblem-fill,#192d35)" stroke="currentColor" strokeWidth="1.4" /><path d="m32 9 21 12v29L32 63 11 50V21L32 9Z" fill="none" stroke="currentColor" strokeWidth=".7" opacity=".4" /><path d="M7 31h7m36 0h7M7 41h5m40 0h5M24 8l8-5 8 5M24 64l8 5 8-5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m23 51 9 5 9-5" fill="none" stroke="currentColor" strokeWidth="1" opacity=".65" />{Array.from({ length: rank }, (_, index) => <circle key={index} cx={32 + (index - (rank - 1) / 2) * 5} cy="59" r="1.2" fill="currentColor" />)}</svg>
    <span className="achievementEmblemSymbol"><GameIcon name={family.icon} size={25} /></span>
    <span className="achievementEmblemState"><GameIcon name={claimed ? 'check' : unlocked ? 'star' : 'lock'} size={11} /></span>
  </span>;
}
