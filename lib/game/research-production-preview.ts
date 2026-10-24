import { quoteFoundry, type FoundryBuilding, type FoundryRecipeKey } from './foundry';
import { productionMultipliers, RESEARCH_TREE, type ResearchConfig } from './research';
import { buildResearchPlan } from './research-plan';

type Input = {
  researchKey: string;
  catalog: readonly ResearchConfig[];
  completed: readonly string[];
  buildings: readonly FoundryBuilding[];
  selectedBuildingId?: string | null;
};

const RECIPE_TARGETS = new Map<string, FoundryRecipeKey>([
  ['thermal_recovery', 'standard_alloy'],
  ['precision_casting', 'precision_casting'],
  ['industrial_casting', 'industrial_casting'],
]);

/** A new-cycle illustration, never a launch, a supply promise, or a rewrite of paid jobs. */
export function researchProductionPreview(input: Input) {
  const recipe = RECIPE_TARGETS.get(input.researchKey);
  if (!recipe) return null;
  const plan = buildResearchPlan(input.researchKey, input.catalog, input.completed);
  const canonical = buildResearchPlan(input.researchKey, RESEARCH_TREE, []);
  if (!plan || !canonical) return null;
  // An incomplete or modified dependency graph cannot support a hypothetical outcome.
  if (plan.steps.length !== canonical.steps.length || canonical.steps.some((expected, index) => {
    const actual = plan.steps[index];
    return !actual || actual.key !== expected.key || actual.prereqs.length !== expected.prereqs.length
      || actual.prereqs.some((key, position) => key !== expected.prereqs[position]);
  })) return null;

  const completed = new Set(input.completed);
  const done = completed.has(input.researchKey);
  const additionalPrerequisites = done ? [] : plan.steps.filter(item => item.key !== input.researchKey && !completed.has(item.key));
  const beforeCompleted = new Set(completed);
  // For an already applied output bonus show its contribution without pretending to remove it.
  if (done && input.researchKey === 'thermal_recovery') beforeCompleted.delete('thermal_recovery');
  const afterCompleted = done ? completed : new Set([...completed, ...plan.steps.map(item => item.key)]);
  const validFoundries = input.buildings.filter(building => building.type === 'foundry' && building.status === 'active'
    && Number.isInteger(building.level) && building.level >= 1 && building.level <= 15
    && Number.isSafeInteger(building.x) && building.x >= 0 && Number.isSafeInteger(building.y) && building.y >= 0);
  const workshop = validFoundries.find(building => building.id === input.selectedBuildingId) ?? validFoundries[0] ?? null;
  const quote = (key: FoundryRecipeKey, technologies: Set<string>) => workshop ? quoteFoundry({
    level: workshop.level, recipe: key, mode: 'standard', link: 'none', cycles: 1,
    partsMultiplier: productionMultipliers(technologies).foundryParts,
  }) : null;
  return {
    done, recipe, additionalPrerequisites, workshop,
    before: quote('standard_alloy', beforeCompleted), after: quote(recipe, afterCompleted),
  };
}
