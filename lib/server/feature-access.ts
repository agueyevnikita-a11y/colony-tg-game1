import { completedResearchKeys } from './research';
import { colonyUnlocks, type ColonyFeature } from '@/lib/game/unlocks';

export async function getColonyUnlocks(tx: any, userId: string, completed?: Set<string>) {
  const researched = completed ?? await completedResearchKeys(tx, userId);
  const grants = await tx<{ feature_key: string }[]>`SELECT feature_key FROM colony_feature_access WHERE user_id=${userId}`;
  return colonyUnlocks(researched, grants.map((row: { feature_key: string }) => row.feature_key));
}

export async function requireColonyFeature(tx: any, userId: string, feature: ColonyFeature) {
  const access = (await getColonyUnlocks(tx, userId))[feature];
  if (!access.unlocked) throw new Error(`Сначала изучи «${access.name}» в разделе исследований.`);
}
