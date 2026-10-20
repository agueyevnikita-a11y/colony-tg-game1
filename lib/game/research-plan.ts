import type { ResearchConfig } from './research';

export type ResearchPlan = {
  target: ResearchConfig;
  steps: ResearchConfig[];
  completedCount: number;
  total: number;
  next: ResearchConfig | null;
  remainingCost: { science: number; ore: number; energy: number; parts: number; credits: number };
  remainingTimeSec: number;
  activeInPlan: boolean;
};

/** Follow prerequisite order, retaining completed steps so progress stays visible. */
export function buildResearchPlan(targetKey: string, catalog: readonly ResearchConfig[], completed: readonly string[], activeKey?: string | null): ResearchPlan | null {
  const byKey = new Map(catalog.map((item) => [item.key as string, item]));
  const target = byKey.get(targetKey);
  if (!target || byKey.size !== catalog.length) return null;

  const visited = new Map<string, 'visiting' | 'done'>();
  const steps: ResearchConfig[] = [];
  function visit(key: string): boolean {
    if (visited.get(key) === 'visiting') return false;
    if (visited.get(key) === 'done') return true;
    const item = byKey.get(key);
    if (!item || !Array.isArray(item.prereqs)) return false;
    visited.set(key, 'visiting');
    for (const prerequisite of item.prereqs) if (!visit(prerequisite)) return false;
    visited.set(key, 'done');
    steps.push(item);
    return true;
  }
  if (!visit(targetKey)) return null;

  const completedKeys = new Set(completed);
  const remainingCost = { science: 0, ore: 0, energy: 0, parts: 0, credits: 0 };
  let remainingTimeSec = 0;
  for (const item of steps) {
    if (completedKeys.has(item.key) || item.key === activeKey) continue;
    remainingCost.science += item.science;
    remainingCost.ore += item.cost.ore ?? 0;
    remainingCost.energy += item.cost.energy ?? 0;
    remainingCost.parts += item.cost.parts ?? 0;
    remainingCost.credits += item.cost.credits ?? 0;
    remainingTimeSec += item.timeSec;
  }
  return {
    target,
    steps,
    completedCount: steps.filter((item) => completedKeys.has(item.key)).length,
    total: steps.length,
    next: steps.find((item) => !completedKeys.has(item.key)) ?? null,
    remainingCost,
    remainingTimeSec,
    activeInPlan: !!activeKey && steps.some((item) => item.key === activeKey),
  };
}

export type ResearchBlocker = {
  kind: 'completed' | 'researching' | 'hq' | 'lab_missing' | 'lab_busy' | 'lab_level' | 'prerequisite' | 'busy' | 'resources' | 'ready';
  missingPrereq?: string;
  shortages?: Record<string, number>;
};

type ResearchState = {
  hqLevel: number;
  labLevel: number;
  labStatus: string;
  activeKey?: string | null;
  completed: readonly string[];
  resources: Record<string, unknown>;
};

/** Explain the first requirement that currently prevents starting this research. */
export function researchBlocker(item: ResearchConfig, state: ResearchState): ResearchBlocker {
  const completed = new Set(state.completed);
  if (completed.has(item.key)) return { kind: 'completed' };
  if (state.activeKey === item.key) return { kind: 'researching' };
  if (!Number.isFinite(state.hqLevel) || state.hqLevel < item.unlockHq) return { kind: 'hq' };
  if (state.labStatus === 'building' || state.labStatus === 'upgrading') return { kind: 'lab_busy' };
  if (state.labStatus !== 'active') return { kind: 'lab_missing' };
  if (!Number.isFinite(state.labLevel) || state.labLevel < item.labLevel) return { kind: 'lab_level' };
  const missingPrereq = item.prereqs.find((key) => !completed.has(key));
  if (missingPrereq) return { kind: 'prerequisite', missingPrereq };
  if (state.activeKey) return { kind: 'busy' };

  const costs = { science: item.science, ore: item.cost.ore ?? 0, energy: item.cost.energy ?? 0, parts: item.cost.parts ?? 0, credits: item.cost.credits ?? 0 };
  const shortages: Record<string, number> = {};
  for (const [resource, cost] of Object.entries(costs)) {
    const raw = state.resources[resource];
    const parsed = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : 0;
    const available = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    if (available < cost) shortages[resource] = cost - available;
  }
  return Object.keys(shortages).length ? { kind: 'resources', shortages } : { kind: 'ready' };
}
