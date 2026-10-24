import type { ResearchConfig } from './research';
import { buildResearchPlan } from './research-plan';
import type { SupplyProjectState } from './supply-projects';

export type ResearchScienceGoal = { key: string; name: string; science: number };
export type ScienceSupplyStage = {
  projectKey: string; projectName: string; stageIndex: number; stageName: string; science: number; ready: boolean;
};

/** Only the current unclaimed stage can fund a next step; later rewards stay out of the estimate. */
export function currentScienceSupply(projects: readonly SupplyProjectState[], preferredProjectKey?: string | null): ScienceSupplyStage | null {
  const stages = projects.flatMap(project => {
    if (project.completed || !Number.isSafeInteger(project.stageIndex) || project.stageIndex < 0) return [];
    const stage = project.stages[project.stageIndex];
    if (!stage || !Number.isSafeInteger(stage.reward.science) || stage.reward.science <= 0) return [];
    return [{ projectKey: project.id, projectName: project.name, stageIndex: project.stageIndex,
      stageName: stage.name, science: stage.reward.science, ready: project.ready }];
  });
  return stages.find(stage => stage.projectKey === preferredProjectKey) ?? stages.find(stage => stage.ready) ?? stages[0] ?? null;
}

/** A running technology is already paid. Do not request its science again or skip ahead in its plan. */
export function nextResearchScienceGoal(catalog: readonly ResearchConfig[], completed: readonly string[], targetKey?: string | null, activeKey?: string | null): ResearchScienceGoal | null {
  const next = targetKey ? buildResearchPlan(targetKey, catalog, completed, activeKey)?.next : null;
  if (!next || next.key === activeKey || !Number.isSafeInteger(next.science) || next.science < 0) return null;
  return { key: next.key, name: next.name, science: next.science };
}

/** Expected reward is shown separately and never becomes spendable stock in this calculation. */
export function scienceSupplyComparison({ currentScience, requiredScience, rewardScience }: {
  currentScience: unknown; requiredScience: number; rewardScience: number;
}) {
  const stock = typeof currentScience === 'number' || typeof currentScience === 'string' && currentScience.trim() !== '' ? Number(currentScience) : NaN;
  if (!Number.isFinite(stock) || stock < 0 || !Number.isSafeInteger(requiredScience) || requiredScience < 0
    || !Number.isSafeInteger(rewardScience) || rewardScience < 0) return null;
  const currentGap = Math.max(0, requiredScience - stock);
  return { currentGap, afterGap: Math.max(0, currentGap - rewardScience), rewardScience };
}
