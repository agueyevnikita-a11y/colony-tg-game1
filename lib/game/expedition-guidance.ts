import { ARTIFACTS, type ArtifactId } from './expeditions';
import { productionMultipliers } from './research';
import type { ResearchScienceGoal } from './research-supply';

type ScienceRange = [number, number];
const REWARD_KEYS = ['ore', 'parts', 'credits', 'science', 'crystals'] as const;
const COST_KEYS = ['energy', 'parts', 'credits'] as const;
type RewardKey = typeof REWARD_KEYS[number];
type CostKey = typeof COST_KEYS[number];

export type ExpeditionSettlementReceipt = Record<RewardKey, number> & {
  cost: Partial<Record<CostKey, number>>;
  choiceId: string | null;
  artifactId: ArtifactId | null;
  extraArtifactId: ArtifactId | null;
};

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function range(value: unknown): ScienceRange | null {
  return Array.isArray(value) && value.length === 2 && integer(value[0]) && integer(value[1]) && value[0] <= value[1]
    ? [value[0], value[1]] : null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

/** New launches use this bonus once. A travelling or returned run already has its reward fixed. */
export function expeditionScienceRange(value: unknown, completedResearch?: readonly string[]): ScienceRange | null {
  const base = range(value);
  if (!base || !Array.isArray(completedResearch) || completedResearch.some(key => typeof key !== 'string')) return null;
  const multiplier = productionMultipliers(new Set(completedResearch)).expeditionScience;
  const result: ScienceRange = [Math.floor(base[0] * multiplier), Math.floor(base[1] * multiplier)];
  return result.every(integer) ? result : null;
}

/** Compare unclaimed science with current stock; never add a receipt to stock that already contains it. */
export function expeditionScienceComparison({ currentScience, goal, rewardRange }: {
  currentScience: unknown;
  goal: ResearchScienceGoal | null | undefined;
  rewardRange: unknown;
}): { currentGap: number; afterGapRange: ScienceRange; rewardRange: ScienceRange } | null {
  const reward = range(rewardRange);
  const stock = typeof currentScience === 'number' || typeof currentScience === 'string' && currentScience.trim() !== ''
    ? Number(currentScience) : NaN;
  if (!goal || !integer(goal.science) || !reward || !Number.isFinite(stock) || stock < 0 || stock > Number.MAX_SAFE_INTEGER) return null;
  const currentGap = Math.max(0, goal.science - stock);
  return { currentGap, afterGapRange: [Math.max(0, currentGap - reward[1]), Math.max(0, currentGap - reward[0])], rewardRange: reward };
}

/** Only a complete settled server result is a receipt; empty or partial replies require refresh. */
export function expeditionSettlementReceipt(value: unknown): ExpeditionSettlementReceipt | null {
  const response = record(value);
  if (!response || response.ok === false) return null;
  const result = Object.hasOwn(response, 'result') ? record(response.result) : response;
  if (!result || REWARD_KEYS.some(key => !Object.hasOwn(result, key) || !integer(result[key]))) return null;
  const costSource = record(result.cost);
  if (!costSource || Object.keys(costSource).some(key => !COST_KEYS.includes(key as CostKey) || !integer(costSource[key]))) return null;
  if (result.choiceId !== null && (typeof result.choiceId !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(result.choiceId))) return null;
  const artifact = (id: unknown): id is ArtifactId | null => id === null || ARTIFACTS.some(item => item.id === id);
  if (!artifact(result.artifactId) || !artifact(result.extraArtifactId)) return null;
  return {
    ore: result.ore as number, parts: result.parts as number, credits: result.credits as number,
    science: result.science as number, crystals: result.crystals as number,
    cost: { ...costSource } as Partial<Record<CostKey, number>>,
    choiceId: result.choiceId as string | null, artifactId: result.artifactId, extraArtifactId: result.extraArtifactId,
  };
}
